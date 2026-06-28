// server.mjs — 本地后端：提供 /api/mix + 托管构建产物 dist/ + 输出预览 /_run。零外部依赖。
//   开发: 终端1 `node server.mjs`(8787) + 终端2 `pnpm dev`(5173, 自动代理 /api,/_run)
//   预览构建: `pnpm build` 后 `node server.mjs`，直接访问 http://localhost:8787
import http from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMix, makeTestClips, collectClips, probeDuration, rm } from "../poc/pipeline.mjs";
import { rewriteCopy } from "./llm.mjs";
import { synthesizeSpeech } from "./tts.mjs";
import { buildSmartMaterialIndex, rankClipsForPrompt } from "./smart_match.mjs";
import { buildSegmentLibrary } from "./segmenter.mjs";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dir, "dist");
const RUN = path.resolve(__dir, "_run");
const CACHE = path.resolve(__dir, "_cache");
const PORT = 8787;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".webm": "video/webm",
  ".avi": "video/x-msvideo", ".m4v": "video/mp4", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac",
  ".wav": "audio/wav", ".flac": "audio/flac", ".ogg": "audio/ogg",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff",
  ".avif": "image/avif", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon" };

function isInside(root, file) {
  const rel = path.relative(root, file);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function serveFile(req, res, file) {
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";
  const info = await stat(file);
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, {
      "content-type": mime,
      "content-length": info.size,
      "accept-ranges": "bytes",
    });
    if (req.method === "HEAD") return res.end();
    return createReadStream(file).pipe(res);
  }
  const [startRaw, endRaw] = range.replace(/bytes=/, "").split("-");
  const start = Math.max(0, Number(startRaw) || 0);
  const end = Math.min(info.size - 1, endRaw ? Number(endRaw) : start + 1024 * 1024 * 4);
  res.writeHead(206, {
    "content-type": mime,
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${info.size}`,
    "accept-ranges": "bytes",
  });
  if (req.method === "HEAD") return res.end();
  return createReadStream(file, { start, end }).pipe(res);
}

async function serveStatic(req, res) {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  // 输出成片预览
  if (rel.startsWith("/_run/")) {
    const f = path.resolve(RUN, rel.slice("/_run/".length));
    if (isInside(RUN, f) && existsSync(f)) return await serveFile(req, res, f);
  }
  if (!existsSync(DIST)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end("<h2>未构建前端</h2><p>请先 <code>pnpm build</code>，或开发期用 <code>pnpm dev</code>（5173）。</p>");
  }
  let file = path.join(DIST, rel === "/" ? "index.html" : rel);
  // SPA：未知路径回退 index.html
  if (!file.startsWith(DIST) || !existsSync(file)) file = path.join(DIST, "index.html");
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(await readFile(file));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b ? JSON.parse(b) : {}));
  });
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function timestampParts(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}${mi}${ss}` };
}

function safeFilename(value, fallback, maxLength = 28) {
  const cleaned = String(value || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "")
    .trim();
  const chars = Array.from(cleaned || fallback);
  return chars.slice(0, maxLength).join("") || fallback;
}

function mediaTitle(filePath, fallback) {
  const base = path.basename(String(filePath || ""), path.extname(String(filePath || "")));
  return safeFilename(base, fallback);
}

async function makeUniqueDir(baseDir) {
  let dir = baseDir;
  for (let i = 2; existsSync(dir); i++) {
    dir = `${baseDir}_${pad2(i)}`;
  }
  await mkdir(dir, { recursive: true });
  return dir;
}

async function createExportBatch({ outputDir, modeLabel, taskName }) {
  const root = String(outputDir || "").trim()
    ? path.resolve(String(outputDir).trim())
    : path.join(RUN, "exports");
  const ts = timestampParts();
  const dateDir = path.join(root, ts.date);
  const batchName = `${ts.time}_${modeLabel}_${safeFilename(taskName, "未命名任务")}`;
  const batchDir = await makeUniqueDir(path.join(dateDir, batchName));
  return { root, dateDir, batchDir };
}

function runFileUrl(file) {
  const abs = path.resolve(file);
  if (abs === RUN || !isInside(RUN, abs)) return `/api/media?path=${encodeURIComponent(abs)}`;
  const rel = path.relative(RUN, abs).split(path.sep).map(encodeURIComponent).join("/");
  return `/_run/${rel}`;
}

function splitCopyText(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const sentenceParts = normalized.match(/[^。！？!?；;]+[。！？!?；;]?/g) ?? [normalized];
  const chunks = [];
  for (const part of sentenceParts.map((item) => item.trim()).filter(Boolean)) {
    const chars = Array.from(part);
    if (chars.length <= 22) {
      chunks.push(part);
      continue;
    }
    for (let i = 0; i < chars.length; i += 22) {
      chunks.push(chars.slice(i, i + 22).join("").trim());
    }
  }
  return chunks.filter(Boolean);
}

function copySubtitleFrames(text, duration) {
  const chunks = splitCopyText(text);
  const totalDuration = Math.max(0.5, Number(duration) || 0);
  if (!chunks.length) return [];
  const weights = chunks.map((chunk) => Math.max(1, Array.from(chunk).length));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  return chunks.map((chunk, index) => {
    const isLast = index === chunks.length - 1;
    const span = isLast ? totalDuration - cursor : totalDuration * (weights[index] / totalWeight);
    const start = Math.max(0, cursor);
    const end = isLast ? totalDuration : Math.min(totalDuration, cursor + Math.max(0.12, span));
    cursor = end;
    return { start, end: Math.max(start + 0.05, end), text: chunk };
  }).filter((frame) => frame.text && frame.end > frame.start);
}

function copySubtitlePayload(text, duration, style) {
  const fallback = {
    x: 50,
    y: 86,
    fontSize: 56,
    opacity: 1,
    outlineWidth: 0,
    color: "#ffffff",
    outlineColor: "#000000",
  };
  return {
    ...fallback,
    ...(style ?? {}),
    text,
    frames: copySubtitleFrames(text, duration),
  };
}

async function apiMix(req, res) {
  const {
    inputs,
    canvas = "1080x1920",
    fillMode = "blur",
    out = 3,
    fps = 30,
    shuffle = true,
    materialCount = 0,
    allowMaterialReuse = true,
    clipStartSec = 0,
    clipEndSec = 0,
    videoVolume = 100,
    bgmEnabled = false,
    bgmPath = "",
    bgmVolume = 30,
    subtitle = null,
    subtitleMode = "off",
    subtitleStyle = null,
    textOverlays = [],
    videoProcessing = null,
    copyMode = false,
    copyItems = [],
    copyVoice = null,
    copyVariants = 1,
    copySubtitleEnabled = true,
    copySubtitleStyle = null,
    audioMode = false,
    audioItems = [],
    audioVariants = 1,
    audioSubtitleEnabled = true,
    audioSubtitleStyle = null,
    voiceVolume = 100,
    fixedFirstEnabled = false,
    fixedFirstPath = "",
    fixedFirstStartSec = 0,
    fixedFirstEndSec = 0,
    smartMix = false,
    groupOutputs = true,
    outputDir = "",
  } = await readBody(req);
  const [w, h] = canvas.split("x").map(Number);
  res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-cache" });
  const send = (o) => res.write(JSON.stringify(o) + "\n");
  try {
    await mkdir(RUN, { recursive: true });
    await rm(path.join(RUN, "work"), { recursive: true, force: true });
    await rm(path.join(RUN, "tts"), { recursive: true, force: true });
    await rm(path.join(RUN, "output"), { recursive: true, force: true });
    const workDir = path.join(RUN, "work");
    const asrCacheDir = path.join(CACHE, "asr");
    let clips;
    if (inputs && existsSync(inputs)) {
      clips = await collectClips(inputs);
      if (!clips.length) throw new Error("该素材路径没有视频素材");
    } else {
      send({ type: "log", msg: "未提供有效素材目录，使用测试素材" });
      clips = await makeTestClips(path.join(workDir, "src"));
    }
    const sourceClips = clips;
    const validCopyItems = Array.isArray(copyItems)
      ? copyItems.map((item, index) => ({
        id: String(item?.id || `copy-${index + 1}`),
        text: String(item?.text || "").trim(),
      })).filter((item) => item.text)
      : [];
    const variantsPerCopy = Math.max(1, Math.floor(Number(copyVariants) || 1));
    const validAudioItems = Array.isArray(audioItems)
      ? audioItems.map((item, index) => ({
        id: String(item?.id || `audio-${index + 1}`),
        path: String(item?.path || "").trim(),
        text: String(item?.text || "").trim(),
        name: String(item?.name || "").trim(),
      })).filter((item) => item.path)
      : [];
    const variantsPerAudio = Math.max(1, Math.floor(Number(audioVariants) || 1));
    const totalOut = copyMode
      ? validCopyItems.length * variantsPerCopy
      : audioMode
        ? validAudioItems.length * variantsPerAudio
        : out;
    if (copyMode && !validCopyItems.length) throw new Error("请先添加文案");
    if (audioMode && !validAudioItems.length) throw new Error("请先添加音频");
    const speaker = copyMode ? String(copyVoice?.speaker || "").trim() : "";
    const resourceId = copyMode ? String(copyVoice?.resourceId || "").trim() : "";
    if (copyMode && !speaker) throw new Error("请选择语音合成音色");
    for (let audioIndex = 0; audioMode && audioIndex < validAudioItems.length; audioIndex++) {
      if (!existsSync(validAudioItems[audioIndex].path)) {
        throw new Error(`音频文件不存在：${validAudioItems[audioIndex].path}`);
      }
    }
    const segmentLibrary = smartMix
      ? await buildSegmentLibrary(sourceClips, {
        cacheDir: path.join(CACHE, "segments"),
        targetSegmentSec: 12,
        maxSegmentSec: 25,
        detectFps: 12,
        cutPaddingSec: 0.35,
        speechProtection: true,
        speechPadSec: 0.2,
        speechMaxShiftSec: 1.5,
        onEvent: send,
      })
      : null;
    if (segmentLibrary) {
      clips = segmentLibrary.segments.map((segment) => segment.path);
      send({
        type: "segment_library",
        engine: segmentLibrary.engine,
        targetEngine: segmentLibrary.targetEngine,
        reused: Boolean(segmentLibrary.reused),
        sourceClips: sourceClips.length,
        segments: segmentLibrary.segments.length,
        manifest: segmentLibrary.path,
      });
      send({
        type: "log",
        msg: segmentLibrary.reused
          ? `智能分割：复用片段库 ${segmentLibrary.segments.length} 个片段`
          : `智能分割：完成 ${segmentLibrary.segments.length} 个片段`,
      });
    }
    const smartIndex = smartMix
      ? await buildSmartMaterialIndex(clips, {
        cacheDir: path.join(CACHE, "smart-index"),
        onEvent: send,
      })
      : null;
    if (smartIndex) {
      send({
        type: "smart_index",
        engine: smartIndex.engine,
        available: Boolean(smartIndex.onnx?.available),
        reused: Boolean(smartIndex.reused),
        indexedClips: smartIndex.clips.length,
        reason: smartIndex.onnx?.reason || "",
      });
      send({
        type: "log",
        msg: smartIndex.reused
          ? `智能索引：复用缓存 ${smartIndex.clips.length} 个素材`
          : `智能索引：完成 ${smartIndex.clips.length} 个素材`,
      });
    }
    const modeLabel = smartMix ? "AI智能混剪" : copyMode ? "文案模式" : audioMode ? "音频模式" : "自定义模式";
    const taskName = inputs && existsSync(inputs) ? path.basename(inputs) : "测试素材";
    const exportBatch = await createExportBatch({ outputDir, modeLabel, taskName });
    const manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      mode: smartMix ? "smart" : copyMode ? "copy" : audioMode ? "audio" : "custom",
      modeLabel,
      source: {
        inputDir: inputs && existsSync(inputs) ? inputs : null,
        materialCount: sourceClips.length,
        segmentLibrary: segmentLibrary ? {
          engine: segmentLibrary.engine,
          targetEngine: segmentLibrary.targetEngine,
          path: segmentLibrary.path,
          reused: segmentLibrary.reused,
          sourceClips: sourceClips.length,
          segments: segmentLibrary.segments.length,
        } : null,
        smartIndex: smartIndex ? {
          engine: smartIndex.engine,
          path: smartIndex.path,
          reused: smartIndex.reused,
          indexedClips: smartIndex.clips.length,
          onnx: smartIndex.onnx ?? null,
        } : null,
      },
      exportDir: exportBatch.batchDir,
      settings: {
        canvas,
        fillMode,
        fps,
        shuffle,
        allowMaterialReuse,
        materialCount,
        clipStartSec,
        clipEndSec,
        videoVolume,
        bgmEnabled,
        bgmPath,
        bgmVolume,
        out,
        copyVariants,
        audioVariants,
        subtitleMode,
        subtitleStyle,
        copySubtitleEnabled,
        copySubtitleStyle,
        audioSubtitleEnabled,
        audioSubtitleStyle,
        textOverlays,
        videoProcessing,
        fixedFirstEnabled,
        fixedFirstPath,
        fixedFirstStartSec,
        fixedFirstEndSec,
        smartMix,
        groupOutputs,
      },
      groups: [],
    };
    send({ type: "log", msg: `输出目录：${exportBatch.batchDir}` });
    send({ type: "start", clips: clips.map((c) => path.basename(c)), w, h, out: totalOut });
    if (copyMode) {
      const outputs = [];
      let outputBase = 0;
      for (let copyIndex = 0; copyIndex < validCopyItems.length; copyIndex++) {
        const item = validCopyItems[copyIndex];
        const groupName = `文案${pad2(copyIndex + 1)}_${safeFilename(item.text, "文案", 18)}`;
        const groupDir = groupOutputs ? path.join(exportBatch.batchDir, groupName) : exportBatch.batchDir;
        const assetDir = groupOutputs ? groupDir : path.join(exportBatch.batchDir, "_assets", groupName);
        await mkdir(groupDir, { recursive: true });
        await mkdir(assetDir, { recursive: true });
        await writeFile(path.join(assetDir, "copy.txt"), `${item.text}\n`);
        send({ type: "log", msg: `合成文案 ${copyIndex + 1}/${validCopyItems.length} 语音…` });
        const ttsFile = path.join(assetDir, "voice.mp3");
        const tts = await synthesizeSpeech({
          text: item.text,
          speaker,
          resourceId,
          format: "mp3",
          sampleRate: 24000,
          outputPath: ttsFile,
        });
        const duration = await probeDuration(tts.path);
        if (!duration) throw new Error(`文案 ${copyIndex + 1} 语音时长读取失败`);
        const smartMatch = smartMix ? await rankClipsForPrompt(clips, item.text, { index: smartIndex }) : null;
        if (smartMatch) {
          const topMatches = smartMatch.matches.slice(0, 3).map((match) => `${match.name}(${match.score})`).join("、");
          send({
            type: "smart_match",
            itemType: "copy",
            index: copyIndex + 1,
            engine: smartMatch.engine,
            matches: smartMatch.matches,
          });
          send({ type: "log", msg: `AI匹配文案 ${copyIndex + 1}：${topMatches || smartMatch.engine}` });
        }
        send({ type: "log", msg: `文案 ${copyIndex + 1} 语音 ${duration.toFixed(1)} 秒，开始混剪…` });
        const results = await runMix({
          clips: smartMatch?.clips ?? clips,
          w,
          h,
          out: variantsPerCopy,
          fps,
          outDir: groupDir,
          workDir: path.join(workDir, `copy_${pad2(copyIndex + 1)}`),
          shuffleClips: smartMix ? false : shuffle,
          materialCount: 0,
          allowReuse: allowMaterialReuse,
          clipStartSec,
          clipEndSec,
          videoVolume,
          bgmEnabled,
          bgmPath,
          bgmVolume,
          fillMode,
          subtitleMode: "off",
          subtitle: null,
          finalSubtitle: copySubtitleEnabled ? copySubtitlePayload(item.text, duration, copySubtitleStyle ?? subtitleStyle) : null,
          textOverlays,
          videoProcessing: videoProcessing ?? {},
          targetDurationSec: duration,
          voiceoverPath: tts.path,
          voiceVolume,
          fixedFirstEnabled,
          fixedFirstPath,
          fixedFirstStartSec,
          fixedFirstEndSec,
          outputPrefix: groupOutputs ? "成片" : `文案${pad2(copyIndex + 1)}_成片`,
          rotateClipOrder: Boolean(smartMatch),
          asrCacheDir,
          onEvent: (e) => {
            if (e.type === "segment") return send({ ...e, output: outputBase + e.output, total: totalOut });
            if (e.type === "output_done") return send({ ...e, output: outputBase + e.output, total: totalOut });
            return send(e);
          },
        });
        outputs.push(...results);
        manifest.groups.push({
          type: "copy",
          index: copyIndex + 1,
          name: groupName,
          dir: groupDir,
          assetDir,
          text: item.text,
          voice: { path: tts.path, durationSec: duration, speaker, resourceId, name: copyVoice?.name || "" },
          smartMatch,
          outputs: results.map((p) => ({ file: path.basename(p), path: p, url: runFileUrl(p) })),
        });
        outputBase += variantsPerCopy;
      }
      const manifestPath = path.join(exportBatch.batchDir, "manifest.json");
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      send({ type: "done", outputs: outputs.map(runFileUrl), exportDir: exportBatch.batchDir, manifest: manifestPath });
      res.end();
      return;
    }
    if (audioMode) {
      const outputs = [];
      let outputBase = 0;
      for (let audioIndex = 0; audioIndex < validAudioItems.length; audioIndex++) {
        const item = validAudioItems[audioIndex];
        const groupName = `音频${pad2(audioIndex + 1)}_${mediaTitle(item.name || item.path, "音频")}`;
        const groupDir = groupOutputs ? path.join(exportBatch.batchDir, groupName) : exportBatch.batchDir;
        const assetDir = groupOutputs ? groupDir : path.join(exportBatch.batchDir, "_assets", groupName);
        await mkdir(groupDir, { recursive: true });
        await mkdir(assetDir, { recursive: true });
        await writeFile(path.join(assetDir, "audio.txt"), [
          `source=${item.path}`,
          item.text ? `subtitle=${item.text}` : "",
        ].filter(Boolean).join("\n") + "\n");
        const duration = await probeDuration(item.path);
        if (!duration) throw new Error(`音频 ${audioIndex + 1} 时长读取失败`);
        const matchPrompt = item.text || item.name || path.basename(item.path);
        const smartMatch = smartMix ? await rankClipsForPrompt(clips, matchPrompt, { index: smartIndex }) : null;
        if (smartMatch) {
          const topMatches = smartMatch.matches.slice(0, 3).map((match) => `${match.name}(${match.score})`).join("、");
          send({
            type: "smart_match",
            itemType: "audio",
            index: audioIndex + 1,
            engine: smartMatch.engine,
            matches: smartMatch.matches,
          });
          send({ type: "log", msg: `AI匹配音频 ${audioIndex + 1}：${topMatches || smartMatch.engine}` });
        }
        send({ type: "log", msg: `音频 ${audioIndex + 1}/${validAudioItems.length} ${duration.toFixed(1)} 秒，开始混剪…` });
        const results = await runMix({
          clips: smartMatch?.clips ?? clips,
          w,
          h,
          out: variantsPerAudio,
          fps,
          outDir: groupDir,
          workDir: path.join(workDir, `audio_${pad2(audioIndex + 1)}`),
          shuffleClips: smartMix ? false : shuffle,
          materialCount: 0,
          allowReuse: allowMaterialReuse,
          clipStartSec,
          clipEndSec,
          videoVolume,
          bgmEnabled,
          bgmPath,
          bgmVolume,
          fillMode,
          subtitleMode: "off",
          subtitle: null,
          finalSubtitle: audioSubtitleEnabled && item.text ? copySubtitlePayload(item.text, duration, audioSubtitleStyle ?? subtitleStyle) : null,
          textOverlays,
          videoProcessing: videoProcessing ?? {},
          targetDurationSec: duration,
          voiceoverPath: item.path,
          voiceVolume,
          fixedFirstEnabled,
          fixedFirstPath,
          fixedFirstStartSec,
          fixedFirstEndSec,
          outputPrefix: groupOutputs ? "成片" : `音频${pad2(audioIndex + 1)}_成片`,
          rotateClipOrder: Boolean(smartMatch),
          asrCacheDir,
          onEvent: (e) => {
            if (e.type === "segment") return send({ ...e, output: outputBase + e.output, total: totalOut });
            if (e.type === "output_done") return send({ ...e, output: outputBase + e.output, total: totalOut });
            return send(e);
          },
        });
        outputs.push(...results);
        manifest.groups.push({
          type: "audio",
          index: audioIndex + 1,
          name: groupName,
          dir: groupDir,
          assetDir,
          sourceAudio: item.path,
          subtitleText: item.text,
          durationSec: duration,
          smartMatch,
          outputs: results.map((p) => ({ file: path.basename(p), path: p, url: runFileUrl(p) })),
        });
        outputBase += variantsPerAudio;
      }
      const manifestPath = path.join(exportBatch.batchDir, "manifest.json");
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      send({ type: "done", outputs: outputs.map(runFileUrl), exportDir: exportBatch.batchDir, manifest: manifestPath });
      res.end();
      return;
    }
    const results = await runMix({
      clips,
      w,
      h,
      out,
      fps,
      outDir: exportBatch.batchDir,
      workDir,
      shuffleClips: shuffle,
      materialCount,
      allowReuse: allowMaterialReuse,
      clipStartSec,
      clipEndSec,
      videoVolume,
      bgmEnabled,
      bgmPath,
      bgmVolume,
      fillMode,
      subtitleMode,
      subtitleStyle,
      subtitle,
      textOverlays,
      videoProcessing: videoProcessing ?? {},
      fixedFirstEnabled,
      fixedFirstPath,
      fixedFirstStartSec,
      fixedFirstEndSec,
      asrCacheDir,
      onEvent: (e) => send(e),
      outputPrefix: "成片",
    });
    manifest.groups.push({
      type: "custom",
      index: 1,
      name: "自定义",
      dir: exportBatch.batchDir,
      outputs: results.map((p) => ({ file: path.basename(p), path: p, url: runFileUrl(p) })),
    });
    const manifestPath = path.join(exportBatch.batchDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    send({ type: "done", outputs: results.map(runFileUrl), exportDir: exportBatch.batchDir, manifest: manifestPath });
  } catch (e) {
    send({ type: "error", msg: e.message });
  }
  res.end();
}

async function apiMaterials(req, res) {
  const { inputs } = await readBody(req);
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
  try {
    if (!inputs || !existsSync(inputs)) {
      throw new Error("素材路径不存在");
    }
    const clips = await collectClips(inputs);
    if (!clips.length) throw new Error("该素材路径没有视频素材");
    res.end(JSON.stringify({
      valid: true,
      path: inputs,
      name: path.basename(inputs),
      count: clips.length,
      clips: clips.map((clip) => ({
        name: path.basename(clip),
        path: clip,
        url: `/api/media?path=${encodeURIComponent(clip)}`,
      })),
    }));
  } catch (e) {
    res.end(JSON.stringify({ valid: false, msg: e.message }));
  }
}

async function apiSegments(req, res) {
  const {
    inputs,
    threshold = 0.35,
    minDurationSec = 1.2,
    targetSegmentSec = 12,
    maxSegmentSec = 25,
    detectFps = 12,
    cutPaddingSec = 0.35,
    speechProtection = true,
    speechPadSec = 0.2,
    speechMaxShiftSec = 1.5,
    force = false,
    outputDir = "",
  } = await readBody(req);
  res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-cache" });
  const send = (o) => res.write(JSON.stringify(o) + "\n");
  try {
    if (!inputs || !existsSync(inputs)) throw new Error("素材路径不存在");
    const clips = await collectClips(inputs);
    if (!clips.length) throw new Error("该素材路径没有视频素材");
    const exportBatch = await createExportBatch({
      outputDir,
      modeLabel: "智能分割",
      taskName: path.basename(inputs),
    });
    send({ type: "start", clips: clips.map((clip) => path.basename(clip)), total: clips.length });
    const library = await buildSegmentLibrary(clips, {
      libraryDir: exportBatch.batchDir,
      threshold,
      minDurationSec,
      targetSegmentSec,
      maxSegmentSec,
      detectFps,
      cutPaddingSec,
      speechProtection,
      speechPadSec,
      speechMaxShiftSec,
      force,
      onEvent: send,
    });
    send({
      type: "done",
      engine: library.engine,
      targetEngine: library.targetEngine,
      reused: Boolean(library.reused),
      manifest: library.path,
      exportDir: exportBatch.batchDir,
      segments: library.segments.map((segment) => ({
        ...segment,
        url: `/api/media?path=${encodeURIComponent(segment.path)}`,
      })),
    });
  } catch (e) {
    send({ type: "error", msg: e.message });
  }
  res.end();
}

async function apiMedia(req, res) {
  const url = new URL(req.url, "http://x");
  const file = url.searchParams.get("path");
  const ext = path.extname(file || "").toLowerCase();
  const mime = MIME[ext] || "";
  if (!file || !existsSync(file) || (!mime.startsWith("video/") && !mime.startsWith("audio/") && !mime.startsWith("image/"))) {
    res.writeHead(404);
    return res.end("media not found");
  }
  return await serveFile(req, res, file);
}

async function apiRewriteCopy(req, res) {
  try {
    const { text } = await readBody(req);
    const rewritten = await rewriteCopy(text);
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(JSON.stringify({ text: rewritten }));
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(e.message);
  }
}

async function apiTts(req, res) {
  try {
    const { text, speaker, resourceId, format = "mp3", sampleRate = 24000 } = await readBody(req);
    const requestedFormat = String(format || "mp3").toLowerCase();
    const ext = ["mp3", "wav", "ogg", "aac"].includes(requestedFormat) ? requestedFormat : "mp3";
    const file = path.join(RUN, "tts", `tts_${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`);
    const result = await synthesizeSpeech({ text, speaker, resourceId, format: ext, sampleRate, outputPath: file });
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(JSON.stringify({
      ...result,
      url: `/api/media?path=${encodeURIComponent(result.path)}`,
    }));
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(e.message);
  }
}

http
  .createServer(async (req, res) => {
    try {
      if ((req.method === "GET" || req.method === "HEAD") && req.url.startsWith("/api/media")) return await apiMedia(req, res);
      if (req.method === "POST" && req.url === "/api/materials") return await apiMaterials(req, res);
      if (req.method === "POST" && req.url === "/api/segments") return await apiSegments(req, res);
      if (req.method === "POST" && req.url === "/api/mix") return await apiMix(req, res);
      if (req.method === "POST" && req.url === "/api/rewrite-copy") return await apiRewriteCopy(req, res);
      if (req.method === "POST" && req.url === "/api/tts") return await apiTts(req, res);
      return await serveStatic(req, res);
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  })
  .listen(PORT, () => console.log(`ECutAuto-Clone 后端 ▶  http://localhost:${PORT}  (dist ${existsSync(DIST) ? "已构建" : "未构建"})`));
