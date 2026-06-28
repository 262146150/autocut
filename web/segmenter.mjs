import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { FFMPEG, probeDuration, run } from "../poc/pipeline.mjs";
import { loadTransNetV2Provider } from "./transnetv2_detector.mjs";
import { loadSherpaVadProvider, protectCutsWithSpeech } from "./sherpa_vad.mjs";

function safeName(value, fallback = "clip") {
  const cleaned = String(value || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return Array.from(cleaned || fallback).slice(0, 36).join("") || fallback;
}

async function fingerprint(file) {
  const info = await stat(file);
  return {
    path: file,
    size: info.size,
    mtimeMs: Math.round(info.mtimeMs),
  };
}

function libraryKey(items, options = {}) {
  const hash = createHash("sha1");
  hash.update(`scene:${options.engine ?? ""}:${options.modelKey ?? ""}:${options.vadKey ?? ""}:${options.speechProtection ?? ""}:${options.threshold ?? ""}:${options.minDurationSec ?? ""}:${options.targetSegmentSec ?? ""}:${options.maxSegmentSec ?? ""}:${options.detectFps ?? ""}:${options.cutPaddingSec ?? ""}`);
  hash.update("\n");
  for (const item of items) {
    hash.update(item.path);
    hash.update(":");
    hash.update(String(item.size));
    hash.update(":");
    hash.update(String(item.mtimeMs));
    hash.update("\n");
  }
  return hash.digest("hex").slice(0, 16);
}

function parseSceneTimes(output) {
  const times = [];
  const re = /pts_time:([0-9.]+)/g;
  let match;
  while ((match = re.exec(output))) {
    const time = Number(match[1]);
    if (Number.isFinite(time) && time > 0) times.push(time);
  }
  return Array.from(new Set(times.map((time) => Number(time.toFixed(3))))).sort((a, b) => a - b);
}

async function detectSceneCuts(file, threshold) {
  const output = await run(FFMPEG, [
    "-hide_banner",
    "-i", file,
    "-vf", `select='gt(scene,${threshold})',showinfo`,
    "-an",
    "-f", "null",
    "-",
  ]);
  return parseSceneTimes(output);
}

function uniqueCuts(cuts, durationSec, minGapSec = 0.35) {
  const total = Math.max(0, Number(durationSec) || 0);
  const sorted = Array.from(new Set((cuts ?? [])
    .map((cut) => Number(cut.toFixed ? cut.toFixed(3) : Number(cut).toFixed(3)))
    .filter((cut) => Number.isFinite(cut) && cut > 0.2 && (!total || cut < total - 0.2))))
    .sort((a, b) => a - b);
  const out = [];
  for (const cut of sorted) {
    if (!out.length || cut - out[out.length - 1] >= minGapSec) out.push(cut);
  }
  return out;
}

function speechBoundaryCandidates(speechSegments, durationSec) {
  const cuts = [];
  for (const segment of speechSegments ?? []) {
    cuts.push(segment.startSec, segment.endSec);
  }
  return uniqueCuts(cuts, durationSec, 0.25);
}

function enforceSegmentDuration(cuts, speechSegments, durationSec, options = {}) {
  const total = Math.max(0, Number(durationSec) || 0);
  if (!total) return [];
  const minDuration = Math.max(0.4, Number(options.minDurationSec) || 1.2);
  const targetValue = Number(options.targetSegmentSec);
  const maxValue = Number(options.maxSegmentSec);
  const target = Math.max(minDuration, Number.isFinite(targetValue) && targetValue > 0 ? targetValue : 12);
  const maxDuration = Math.max(target, Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 25);
  if (total <= maxDuration) return uniqueCuts(cuts, total);
  const safeCandidates = uniqueCuts([
    ...(cuts ?? []),
    ...speechBoundaryCandidates(speechSegments, total),
  ], total, 0.25);
  const result = [];
  const baseCuts = uniqueCuts(cuts, total, minDuration);
  let cursor = 0;
  const chooseCut = (rangeEnd) => {
    const minCut = cursor + minDuration;
    const maxCut = Math.min(cursor + maxDuration, rangeEnd - minDuration);
    if (maxCut <= minCut) return 0;
    const desired = Math.min(cursor + target, maxCut);
    const candidates = safeCandidates
      .filter((cut) => cut > minCut && cut < maxCut)
      .sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired));
    return candidates[0] ?? Number(desired.toFixed(3));
  };

  for (const baseCut of [...baseCuts, total]) {
    while (baseCut - cursor > maxDuration) {
      const forced = chooseCut(baseCut);
      if (!forced || forced <= cursor + 0.1) break;
      result.push(forced);
      cursor = forced;
    }
    if (baseCut < total) {
      if (baseCut - cursor >= minDuration) {
        result.push(baseCut);
        cursor = baseCut;
      }
    }
  }
  return uniqueCuts(result, total, minDuration);
}

function buildRanges(duration, cuts, minDurationSec, cutPaddingSec = 0.35) {
  const total = Math.max(0, Number(duration) || 0);
  if (!total) return [];
  const minDuration = Math.max(0.4, Number(minDurationSec) || 1.2);
  const padding = Math.max(0, Math.min(2, Number(cutPaddingSec) || 0));
  const points = [0, ...uniqueCuts(cuts, total, minDuration), total];
  const ranges = [];
  let start = points[0];
  for (let i = 1; i < points.length; i++) {
    const end = points[i];
    if (end - start < minDuration && i < points.length - 1) continue;
    if (end - start >= 0.35) {
      const paddedStart = Math.max(0, start - padding);
      const paddedEnd = Math.min(total, end + padding);
      ranges.push({ startSec: paddedStart, endSec: paddedEnd, durationSec: paddedEnd - paddedStart });
    }
    start = end;
  }
  return ranges.length ? ranges : [{ startSec: 0, endSec: total, durationSec: total }];
}

async function cutSegment(source, output, range, sourceDurationSec) {
  const isWholeClip = range.startSec <= 0.05 && Math.abs((sourceDurationSec || 0) - range.endSec) <= 0.15;
  if (isWholeClip) {
    await run(FFMPEG, [
      "-y",
      "-i", source,
      "-map", "0:v:0",
      "-map", "0:a?",
      "-c", "copy",
      "-movflags", "+faststart",
      output,
    ]);
    return;
  }
  await run(FFMPEG, [
    "-y",
    "-ss", range.startSec.toFixed(3),
    "-i", source,
    "-t", range.durationSec.toFixed(3),
    "-map", "0:v:0",
    "-map", "0:a?",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    output,
  ]);
}

function cacheComplete(manifest) {
  return Array.isArray(manifest?.segments)
    && manifest.segments.length > 0
    && manifest.segments.every((segment) => segment.path && existsSync(segment.path));
}

export async function buildSegmentLibrary(clips, options = {}) {
  const cacheDir = options.cacheDir || path.join(process.cwd(), "_cache", "segments");
  const threshold = Math.max(0.05, Math.min(0.9, Number(options.threshold ?? 0.35)));
  const minDurationSec = Math.max(0.4, Number(options.minDurationSec ?? 1.2));
  const targetValue = Number(options.targetSegmentSec);
  const maxValue = Number(options.maxSegmentSec);
  const targetSegmentSec = Math.max(minDurationSec, Number.isFinite(targetValue) && targetValue > 0 ? targetValue : 12);
  const maxSegmentSec = Math.max(targetSegmentSec, Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 25);
  const detectFps = Math.max(0, Number(options.detectFps ?? 12));
  const cutPaddingSec = Math.max(0, Math.min(2, Number(options.cutPaddingSec ?? 0.35)));
  const speechProtection = options.speechProtection !== false;
  const speechPadSec = Math.max(0, Math.min(1.5, Number(options.speechPadSec ?? 0.2)));
  const speechMaxShiftSec = Math.max(0.2, Math.min(5, Number(options.speechMaxShiftSec ?? 1.5)));
  const force = Boolean(options.force);
  const transnet = await loadTransNetV2Provider({ root: options.root || process.cwd() });
  const vad = speechProtection ? await loadSherpaVadProvider({ root: options.root || process.cwd() }) : { available: false, reason: "语音保护未启用" };
  const engine = transnet.available ? transnet.engine : "ffmpeg-scene-fallback";
  if (transnet.available) {
    options.onEvent?.({ type: "segment_log", msg: `TransNetV2：已加载 ${transnet.engine}` });
  } else {
    options.onEvent?.({ type: "segment_log", msg: `TransNetV2：${transnet.reason}，临时使用 FFmpeg scene fallback` });
  }
  if (speechProtection) {
    if (vad.available) options.onEvent?.({ type: "segment_log", msg: `语音保护：已加载 ${vad.engine}` });
    else options.onEvent?.({ type: "segment_log", msg: `语音保护：${vad.reason}` });
  }
  const fingerprints = [];
  for (const clip of clips) {
    try {
      fingerprints.push(await fingerprint(clip));
    } catch {
      // Ignore files that disappeared after collection.
    }
  }
  if (!fingerprints.length) throw new Error("没有可分割的视频素材");
  const key = libraryKey(fingerprints, {
    threshold,
    minDurationSec,
    targetSegmentSec,
    maxSegmentSec,
    detectFps,
    cutPaddingSec,
    speechProtection,
    engine,
    modelKey: transnet.modelKey || "",
    vadKey: vad.modelKey || "",
  });
  const dir = options.libraryDir ? path.resolve(options.libraryDir) : path.join(cacheDir, key);
  const segmentsDir = path.join(dir, "clips");
  const manifestPath = path.join(dir, "manifest.json");
  await mkdir(segmentsDir, { recursive: true });

  if (!force && existsSync(manifestPath)) {
    try {
      const cached = JSON.parse(await readFile(manifestPath, "utf8"));
      if (cached.version === 1 && cacheComplete(cached)) {
        return { ...cached, reused: true, path: manifestPath };
      }
    } catch {
      // Rebuild invalid cache.
    }
  }

  const segments = [];
  options.onEvent?.({ type: "segment_log", msg: `智能分割：开始分析 ${fingerprints.length} 个视频` });
  for (let clipIndex = 0; clipIndex < fingerprints.length; clipIndex++) {
    const item = fingerprints[clipIndex];
    const durationSec = await probeDuration(item.path);
    options.onEvent?.({
      type: "segment_file",
      index: clipIndex + 1,
      total: fingerprints.length,
      name: path.basename(item.path),
      durationSec,
    });
    let cuts = [];
    if (transnet.available) {
      const result = await transnet.detectCuts(item.path, { threshold, minDurationSec, detectFps });
      cuts = result.cuts;
      options.onEvent?.({
        type: "segment_log",
        msg: `TransNetV2：${path.basename(item.path)} ${result.fps.toFixed(1)}fps 检测到 ${cuts.length} 个边界`,
      });
    } else {
      try {
        cuts = await detectSceneCuts(item.path, threshold);
      } catch (err) {
        options.onEvent?.({ type: "segment_log", msg: `镜头检测降级：${path.basename(item.path)} ${err.message}` });
      }
    }
    let speechSegments = [];
    if (speechProtection && vad.available) {
      try {
        speechSegments = await vad.detectSpeech(item.path, { durationSec, padSec: speechPadSec });
        const beforeCount = cuts.length;
        cuts = protectCutsWithSpeech(cuts, speechSegments, {
          durationSec,
          maxShiftSec: speechMaxShiftSec,
        });
        options.onEvent?.({
          type: "segment_log",
          msg: `语音保护：${path.basename(item.path)} 检测到 ${speechSegments.length} 段人声，切点 ${beforeCount} -> ${cuts.length}`,
        });
      } catch (error) {
        options.onEvent?.({
          type: "segment_log",
          msg: `语音保护跳过：${path.basename(item.path)} ${error.message}`,
        });
      }
    }
    cuts = enforceSegmentDuration(cuts, speechSegments, durationSec, {
      minDurationSec,
      targetSegmentSec,
      maxSegmentSec,
    });
    const ranges = buildRanges(durationSec, cuts, minDurationSec, cutPaddingSec);
    const sourceBase = safeName(path.basename(item.path, path.extname(item.path)), `素材${clipIndex + 1}`);
    for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex++) {
      const range = ranges[rangeIndex];
      const fileName = `${String(clipIndex + 1).padStart(3, "0")}_${sourceBase}_${String(rangeIndex + 1).padStart(3, "0")}.mp4`;
      const output = path.join(segmentsDir, fileName);
      if (!existsSync(output)) await cutSegment(item.path, output, range, durationSec);
      const segment = {
        id: `${clipIndex + 1}-${rangeIndex + 1}`,
        name: fileName,
        path: output,
        sourcePath: item.path,
        sourceName: path.basename(item.path),
        startSec: Number(range.startSec.toFixed(3)),
        endSec: Number(range.endSec.toFixed(3)),
        durationSec: Number(range.durationSec.toFixed(3)),
        speechProtected: Boolean(speechProtection && vad.available),
      };
      segments.push(segment);
      options.onEvent?.({
        type: "segment_done",
        index: segments.length,
        name: fileName,
        sourceName: segment.sourceName,
        startSec: segment.startSec,
        endSec: segment.endSec,
        durationSec: segment.durationSec,
        path: output,
      });
    }
  }

  const manifest = {
    version: 1,
    engine,
    targetEngine: "transnetv2-onnx",
    detector: transnet.available ? {
      manifestPath: transnet.manifestPath,
      modelKey: transnet.modelKey,
    } : {
      reason: transnet.reason,
    },
    speechProtection: speechProtection ? {
      enabled: true,
      engine: vad.available ? vad.engine : "unavailable",
      manifestPath: vad.manifestPath || "",
      modelKey: vad.modelKey || "",
      reason: vad.available ? "" : vad.reason,
      speechPadSec,
      speechMaxShiftSec,
    } : {
      enabled: false,
    },
    createdAt: new Date().toISOString(),
    key,
    settings: { threshold, minDurationSec, targetSegmentSec, maxSegmentSec, detectFps, cutPaddingSec, speechProtection, speechPadSec, speechMaxShiftSec },
    source: {
      files: fingerprints.map((item) => ({ path: item.path, size: item.size, mtimeMs: item.mtimeMs })),
    },
    segments,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { ...manifest, reused: false, path: manifestPath };
}
