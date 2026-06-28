// pipeline.mjs — 混剪核心管线（CLI 与 Web 后端共用的唯一真源）
import { spawn } from "node:child_process";
import { mkdir, writeFile, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildClipFilterComplex, subtitleGraph } from "./filters.mjs";
import { sampleDedupParams } from "./dedup.mjs";
import { resolveSubtitleForClip } from "./subtitles.mjs";

const BUNDLED = "/Applications/ECutAuto.app/Contents/Resources/Resources/FFmpeg/macOS/arm64";
export const FFMPEG = existsSync(`${BUNDLED}/ffmpeg`) ? `${BUNDLED}/ffmpeg` : "ffmpeg";
export const FFPROBE = existsSync(`${BUNDLED}/ffprobe`) ? `${BUNDLED}/ffprobe` : "ffprobe";

export function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) =>
      code === 0 ? resolve(err) : reject(new Error(`${path.basename(bin)} exit ${code}\n${err.slice(-600)}`))
    );
  });
}

export function runOutput(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${path.basename(bin)} exit ${code}\n${err.slice(-600)}`))
    );
  });
}

export async function hasAudioStream(file) {
  try {
    const out = await runOutput(FFPROBE, ["-v", "error", "-select_streams", "a",
      "-show_entries", "stream=index", "-of", "csv=p=0", file]);
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

export async function probeDuration(file) {
  try {
    const out = await runOutput(FFPROBE, ["-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", file]);
    const duration = Number(out.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

export async function probeVideoSize(file) {
  try {
    const out = await runOutput(FFPROBE, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height:stream_tags=rotate:stream_side_data=rotation",
      "-of", "json",
      file,
    ]);
    const data = JSON.parse(out);
    const stream = data.streams?.[0] ?? {};
    let width = Number(stream.width);
    let height = Number(stream.height);
    const tagRotate = Number(stream.tags?.rotate ?? 0);
    const sideRotate = Number(stream.side_data_list?.find((item) => item.rotation !== undefined)?.rotation ?? 0);
    const rotate = Number.isFinite(tagRotate) && tagRotate !== 0 ? tagRotate : sideRotate;
    if (Math.abs(rotate) % 180 === 90) [width, height] = [height, width];
    return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
      ? { width, height }
      : null;
  } catch {
    return null;
  }
}

function videoEncodeArgs(quality = "high") {
  const presets = {
    standard: { preset: "veryfast", crf: "23" },
    high: { preset: "fast", crf: "20" },
    best: { preset: "medium", crf: "18" },
  };
  const resolved = presets[quality] ?? presets.high;
  return ["-c:v", "libx264", "-preset", resolved.preset, "-crf", resolved.crf];
}

/** 没素材时用 lavfi 造测试片，便于 demo。 */
export async function makeTestClips(dir) {
  await mkdir(dir, { recursive: true });
  const specs = [
    { name: "clipA.mp4", src: "testsrc2=size=1280x720:rate=30:duration=3", tone: 220 },
    { name: "clipB.mp4", src: "smptebars=size=720x1280:rate=30:duration=3", tone: 330 },
    { name: "clipC.mp4", src: "testsrc=size=1920x1080:rate=30:duration=3", tone: 440 },
  ];
  const files = [];
  for (const s of specs) {
    const out = path.join(dir, s.name);
    await run(FFMPEG, ["-y", "-f", "lavfi", "-i", s.src, "-f", "lavfi", "-i",
      `sine=frequency=${s.tone}:duration=3`, "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-shortest", out]);
    files.push(out);
  }
  return files;
}

async function processSegment(input, segOut, params, w, h, fps, options = {}) {
  const sourceHasAudio = await hasAudioStream(input);
  const watermarkOverlay = options.videoProcessing?.watermarkOverlay ?? {};
  const watermarkPath = watermarkOverlay.enabled && watermarkOverlay.path ? String(watermarkOverlay.path) : "";
  const hasWatermark = Boolean(watermarkPath && existsSync(watermarkPath));
  const watermarkInputIndex = 1 + (sourceHasAudio ? 0 : 1);
  const subtitle = await resolveSubtitleForClip(input, { ...options, ffmpegBin: FFMPEG });
  const filterOptions = {
    ...options,
    subtitle,
    audioInputLabel: sourceHasAudio ? "0:a" : "1:a",
    bgmInputLabel: null,
    watermarkInputLabel: hasWatermark ? `${watermarkInputIndex}:v` : null,
  };
  const { filter, vmap, amap } = buildClipFilterComplex(params, w, h, fps, true, filterOptions);
  const args = ["-y"];
  const start = Math.max(0, Number(options.clipStartSec ?? 0));
  const end = Math.max(0, Number(options.clipEndSec ?? 0));
  if (start > 0) args.push("-ss", String(start));
  if (end > start) args.push("-t", String(end - start));
  else if (start === 0 && end > 0) args.push("-t", String(end));
  args.push("-i", input);
  if (!sourceHasAudio) {
    const silentDuration = end > start ? end - start : 3600;
    args.push("-f", "lavfi", "-t", String(silentDuration), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  }
  if (hasWatermark) {
    if (watermarkOverlay.mediaType === "video") args.push("-stream_loop", "-1", "-i", watermarkPath);
    else args.push("-loop", "1", "-i", watermarkPath);
  }
  args.push("-filter_complex", filter, "-map", vmap);
  if (amap) args.push("-map", amap);
  args.push(...videoEncodeArgs(options.exportQuality),
    "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000", "-shortest", "-f", "mpegts", segOut);
  await run(FFMPEG, args);
  return filter;
}

async function mixContinuousBgm(input, output, options = {}) {
  const bgmPath = String(options.bgmPath || "");
  const bgmVolume = Math.max(0, Number(options.bgmVolume ?? 30) / 100);
  const filter = [
    "[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[maina]",
    `[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${bgmVolume.toFixed(3)},asetpts=PTS-STARTPTS[bgma]`,
    "[maina][bgma]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]",
  ].join(";");
  await run(FFMPEG, ["-y", "-i", input, "-stream_loop", "-1", "-i", bgmPath,
    "-filter_complex", filter, "-map", "0:v", "-map", "[aout]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000",
    "-movflags", "+faststart", "-shortest", output]);
}

async function muxVoiceover(input, output, options = {}) {
  const voiceoverPath = String(options.voiceoverPath || "");
  const bgmPath = String(options.bgmPath || "");
  const voiceVolume = Math.max(0, Number(options.voiceVolume ?? 100) / 100);
  const bgmVolume = Math.max(0, Number(options.bgmVolume ?? 30) / 100);
  if (options.bgmEnabled && bgmPath) {
    const filter = [
      `[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${voiceVolume.toFixed(3)},asetpts=PTS-STARTPTS[voicea]`,
      `[2:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${bgmVolume.toFixed(3)},asetpts=PTS-STARTPTS[bgma]`,
      "[voicea][bgma]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]",
    ].join(";");
    await run(FFMPEG, ["-y", "-i", input, "-i", voiceoverPath, "-stream_loop", "-1", "-i", bgmPath,
      "-filter_complex", filter, "-map", "0:v", "-map", "[aout]",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000",
      "-movflags", "+faststart", "-shortest", output]);
    return;
  }
  const filter = `[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
    `volume=${voiceVolume.toFixed(3)},asetpts=PTS-STARTPTS[aout]`;
  await run(FFMPEG, ["-y", "-i", input, "-i", voiceoverPath,
    "-filter_complex", filter, "-map", "0:v", "-map", "[aout]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000",
    "-movflags", "+faststart", "-shortest", output]);
}

async function applyFinalSubtitle(input, output, subtitle, w, h, fps, options = {}) {
  const filter = subtitleGraph("0:v", "outv", { ...subtitle, canvasW: w, canvasH: h });
  await run(FFMPEG, ["-y", "-i", input,
    "-filter_complex", filter, "-map", "[outv]", "-map", "0:a?",
    ...videoEncodeArgs(options.exportQuality),
    "-c:a", "copy", "-movflags", "+faststart", output]);
}

function shuffled(items) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function rotated(items, offset) {
  if (!items.length) return [];
  const start = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

function resolveMaterialCount(materialCount, total) {
  const n = Math.floor(Number(materialCount ?? 0));
  if (!Number.isFinite(n) || n <= 0) return total;
  return Math.max(1, n);
}

function repeatPick(source, count, shuffleClips) {
  const base = shuffleClips ? shuffled(source) : [...source];
  const picked = base.slice(0, Math.min(count, base.length));
  while (picked.length < count) {
    const pool = shuffleClips ? shuffled(source) : source;
    picked.push(pool[picked.length % pool.length]);
  }
  return picked;
}

async function effectiveClipDuration(file, options = {}, cache = new Map()) {
  const start = Math.max(0, Number(options.clipStartSec ?? 0));
  const end = Math.max(0, Number(options.clipEndSec ?? 0));
  if (end > start) return Math.max(0.1, end - start);
  if (start === 0 && end > 0) return Math.max(0.1, end);
  if (!cache.has(file)) cache.set(file, probeDuration(file));
  const duration = await cache.get(file);
  return Math.max(0.1, (duration || 3) - start);
}

async function pickForDuration(source, targetDuration, options, durationCache) {
  const picked = [];
  const target = Math.max(0.5, Number(targetDuration) || 0);
  let total = 0;
  let pool = options.shuffleClips ? shuffled(source) : [...source];
  let cursor = 0;
  while (total < target + 0.25) {
    if (!pool.length) break;
    if (cursor >= pool.length) {
      if (!options.allowReuse) break;
      pool = options.shuffleClips ? shuffled(source) : [...source];
      cursor = 0;
    }
    const clip = pool[cursor++];
    picked.push(clip);
    total += await effectiveClipDuration(clip, options, durationCache);
  }
  if (total < target) {
    throw new Error("素材总时长不足：请开启允许素材重复，或增加素材数量");
  }
  return picked;
}

/**
 * 跑一次批量混剪。通过 onEvent 推送进度（CLI 打日志 / Web 转 SSE 通用）。
 * @returns {Promise<string[]>} 成片路径数组
 */
export async function runMix({
  clips,
  w,
  h,
  out,
  fps,
  outDir,
  workDir,
  shuffleClips = false,
  materialCount = 0,
  allowReuse = true,
  clipStartSec = 0,
  clipEndSec = 0,
  videoVolume = 100,
  bgmEnabled = false,
  bgmPath = "",
  bgmVolume = 30,
  fillMode = "blur",
  subtitleMode = "off",
  subtitleStyle = null,
  subtitle = null,
  finalSubtitle = null,
  textOverlays = [],
  videoProcessing = null,
  targetDurationSec = 0,
  voiceoverPath = "",
  voiceVolume = 100,
  fixedFirstEnabled = false,
  fixedFirstPath = "",
  fixedFirstStartSec = 0,
  fixedFirstEndSec = 0,
  fixedLastEnabled = false,
  fixedLastPath = "",
  fixedLastStartSec = 0,
  fixedLastEndSec = 0,
  outputPrefix = "mix",
  outputStartIndex = 1,
  rotateClipOrder = false,
  exportQuality = "high",
  asrCacheDir = null,
  onEvent = () => {},
}) {
  await mkdir(outDir, { recursive: true });
  if (bgmEnabled && (!bgmPath || !existsSync(bgmPath))) {
    throw new Error("背景音乐文件不存在");
  }
  const watermarkPath = videoProcessing?.watermarkOverlay?.enabled ? String(videoProcessing.watermarkOverlay.path || "") : "";
  if (watermarkPath && !existsSync(watermarkPath)) {
    throw new Error("水印素材文件不存在");
  }
  if (voiceoverPath && !existsSync(voiceoverPath)) {
    throw new Error("语音文件不存在");
  }
  const fixedFirst = fixedFirstEnabled && fixedFirstPath ? {
    path: String(fixedFirstPath),
    clipStartSec: Math.max(0, Number(fixedFirstStartSec ?? 0)),
    clipEndSec: Math.max(0, Number(fixedFirstEndSec ?? 0)),
  } : null;
  const fixedLast = fixedLastEnabled && fixedLastPath ? {
    path: String(fixedLastPath),
    clipStartSec: Math.max(0, Number(fixedLastStartSec ?? 0)),
    clipEndSec: Math.max(0, Number(fixedLastEndSec ?? 0)),
  } : null;
  if (fixedFirst && !existsSync(fixedFirst.path)) {
    throw new Error("固定首素材文件不存在");
  }
  if (fixedLast && !existsSync(fixedLast.path)) {
    throw new Error("固定末素材文件不存在");
  }
  const fixedPaths = [fixedFirst?.path, fixedLast?.path].filter(Boolean).map((file) => path.resolve(file));
  const fixedInClipsCount = clips.filter((clip) => fixedPaths.includes(path.resolve(clip))).length;
  const selectableClips = fixedPaths.length
    ? clips.filter((clip) => !fixedPaths.includes(path.resolve(clip)))
    : clips;
  const results = [];
  const perOutput = resolveMaterialCount(materialCount, clips.length);
  const durationCache = new Map();
  let remaining = shuffleClips ? shuffled(selectableClips) : [...selectableClips];
  for (let idx = 0; idx < out; idx++) {
    let clipOrder;
    const outputClips = rotateClipOrder ? rotated(selectableClips, idx) : selectableClips;
    if (targetDurationSec > 0 && resolveMaterialCount(materialCount, 0) === 0) {
      const fixedDuration = (fixedFirst ? await effectiveClipDuration(fixedFirst.path, fixedFirst, durationCache) : 0)
        + (fixedLast ? await effectiveClipDuration(fixedLast.path, fixedLast, durationCache) : 0);
      if (fixedDuration > targetDurationSec + 0.25) {
        throw new Error("固定首/末素材总时长超过配音或音频时长，请缩短首尾素材或调整音频");
      }
      const remainingDuration = Math.max(0, targetDurationSec - fixedDuration);
      clipOrder = remainingDuration > 0 ? await pickForDuration(outputClips, remainingDuration, {
        clipStartSec,
        clipEndSec,
        shuffleClips,
        allowReuse,
      }, durationCache) : [];
    } else if (allowReuse) {
      const count = fixedInClipsCount ? Math.max(0, perOutput - fixedInClipsCount) : perOutput;
      if (count > 0 && !outputClips.length) throw new Error("固定首/末素材之外没有可用素材");
      clipOrder = repeatPick(outputClips, count, shuffleClips);
    } else {
      const count = fixedInClipsCount ? Math.max(0, perOutput - fixedInClipsCount) : perOutput;
      if (remaining.length < count) {
        throw new Error("素材数量不足：请开启允许素材重复，或减少使用素材数量/导出数量");
      }
      clipOrder = remaining.splice(0, count);
    }
    const clipItems = [
      ...(fixedFirst ? [fixedFirst] : []),
      ...clipOrder.map((clip) => ({ path: clip, clipStartSec, clipEndSec })),
      ...(fixedLast ? [fixedLast] : []),
    ];
    const segDir = path.join(workDir, `out${idx}`);
    await mkdir(segDir, { recursive: true });
    const segFiles = [];
    for (let i = 0; i < clipItems.length; i++) {
      const item = clipItems[i];
      const params = sampleDedupParams();
      const seg = path.join(segDir, `seg${i}.ts`);
      const filter = await processSegment(item.path, seg, params, w, h, fps, {
        clipStartSec: item.clipStartSec,
        clipEndSec: item.clipEndSec,
        videoVolume,
        bgmEnabled,
        bgmPath,
        bgmVolume,
        fillMode,
        subtitleMode,
        subtitleStyle,
        subtitle,
        textOverlays,
        videoProcessing,
        exportQuality,
        asrCacheDir,
        workDir,
        onEvent,
      });
      segFiles.push(seg);
      onEvent({ type: "segment", output: idx + 1, total: out, seg: i, params,
        filter: idx === 0 && i === 0 ? filter : undefined });
    }
    const listFile = path.join(segDir, "concat_list.txt");
    await writeFile(listFile, segFiles.map((f) => `file '${f}'`).join("\n"));
    const finalIndex = outputStartIndex + idx;
    const final = path.join(outDir, `${outputPrefix}_${String(finalIndex).padStart(2, "0")}.mp4`);
    const needsPostProcess = bgmEnabled || Boolean(voiceoverPath) || Boolean(finalSubtitle?.text || finalSubtitle?.frames?.length);
    const joined = needsPostProcess ? path.join(segDir, "joined.mp4") : final;
    await run(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile,
      "-c", "copy", "-movflags", "+faststart", joined]);
    let mediaForAudio = joined;
    if (finalSubtitle?.text || finalSubtitle?.frames?.length) {
      const subtitled = (bgmEnabled || voiceoverPath) ? path.join(segDir, "subtitled.mp4") : final;
      await applyFinalSubtitle(joined, subtitled, finalSubtitle, w, h, fps, { exportQuality });
      mediaForAudio = subtitled;
    }
    if (voiceoverPath) {
      await muxVoiceover(mediaForAudio, final, { voiceoverPath, voiceVolume, bgmEnabled, bgmPath, bgmVolume });
    } else if (bgmEnabled) {
      await mixContinuousBgm(mediaForAudio, final, { bgmPath, bgmVolume });
    }
    results.push(final);
    onEvent({ type: "output_done", output: idx + 1, total: out, path: final });
  }
  return results;
}

function isVideoFile(file) {
  return /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file);
}

/** 收集目录或单个文件中的视频素材。 */
export async function collectClips(input) {
  const info = await stat(input);
  if (info.isFile()) return isVideoFile(input) ? [input] : [];

  const out = [];
  async function walk(current) {
    const ents = await readdir(current, { withFileTypes: true });
    for (const ent of ents) {
      if (ent.name.startsWith(".")) continue;
      const file = path.join(current, ent.name);
      if (ent.isDirectory()) {
        await walk(file);
      } else if (isVideoFile(ent.name)) {
        out.push(file);
      }
    }
  }
  await walk(input);
  return out.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export { rm };
