import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FFMPEG, probeDuration, run } from "../poc/pipeline.mjs";
import { recognizeClipWithWhisper } from "../poc/asr.mjs";
import { parseSrt } from "../poc/srt.mjs";
import { callArkText } from "./llm.mjs";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function safeFilename(value, fallback, maxLength = 36) {
  const cleaned = String(value || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "")
    .trim();
  const chars = Array.from(cleaned || fallback);
  return chars.slice(0, maxLength).join("") || fallback;
}

function secondsToSrtTime(value) {
  const totalMs = Math.max(0, Math.round(Number(value || 0) * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const ss = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const mm = totalMin % 60;
  const hh = Math.floor(totalMin / 60);
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)},${String(ms).padStart(3, "0")}`;
}

function srtTimeToSeconds(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return null;
  const [, hh, mm, ss, ms] = match;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms.padEnd(3, "0")) / 1000;
}

function formatSeconds(value) {
  const sec = Math.max(0, Number(value) || 0);
  const mm = Math.floor(sec / 60);
  const ss = Math.floor(sec % 60);
  return `${pad2(mm)}:${pad2(ss)}`;
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = fenced ? fenced[1].trim() : raw;
  const match = body.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (!match) throw new Error("AI返回内容不是有效结构");
  try {
    return JSON.parse(match[0]);
  } catch (error) {
    throw new Error(`AI返回结构解析失败：${error.message}`);
  }
}

function frameText(frames) {
  return frames.map((frame) => frame.text).join(" ").replace(/\s+/g, " ").trim();
}

function srtTextForPrompt(frames) {
  return frames.map((frame, index) => [
    String(index + 1),
    `${secondsToSrtTime(frame.start)} --> ${secondsToSrtTime(frame.end)}`,
    frame.text,
  ].join("\n")).join("\n\n");
}

function chunkFrames(frames, chunkSeconds = 30 * 60) {
  const chunks = [];
  let current = [];
  let start = frames[0]?.start ?? 0;
  for (const frame of frames) {
    if (current.length && frame.end - start > chunkSeconds) {
      chunks.push(current);
      current = [];
      start = frame.start;
    }
    current.push(frame);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function findSidecarSrt(videoPath, explicitSrtPath = "") {
  const requested = String(explicitSrtPath || "").trim();
  if (requested && existsSync(requested)) return requested;
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  const candidates = [
    path.join(dir, `${base}.srt`),
    path.join(dir, "input.srt"),
    path.join(dir, "transcript.srt"),
  ];
  return candidates.find((item) => existsSync(item)) ?? "";
}

async function resolveFrames(videoPath, options = {}) {
  const sidecar = findSidecarSrt(videoPath, options.srtPath);
  if (sidecar) {
    const frames = parseSrt(await readFile(sidecar, "utf8"));
    if (!frames.length) throw new Error(`字幕文件没有可用内容：${sidecar}`);
    return { frames, source: sidecar, sourceType: "srt" };
  }
  if (options.enableAsr === false) {
    throw new Error("未找到同名 SRT，且自动识别已关闭");
  }
  const recognized = await recognizeClipWithWhisper(videoPath, {
    workDir: options.workDir,
    asrCacheDir: options.asrCacheDir,
    onEvent: options.onEvent,
  });
  if (!recognized.frames.length) throw new Error("未识别到有效字幕，无法做高光切片");
  return { frames: recognized.frames, source: recognized.source, sourceType: "asr" };
}

async function askJson(prompt, llmOptions) {
  const { text } = await callArkText(prompt, {
    apiKey: llmOptions.apiKey,
    model: llmOptions.model,
    maxOutputTokens: llmOptions.maxOutputTokens ?? 8192,
  });
  return extractJson(text);
}

async function analyzeOutline(frames, llmOptions) {
  const prompt = [
    "你是专业的视频内容结构分析师。请根据下面的字幕文本，提取适合短视频切片的话题大纲。",
    "要求：覆盖主要内容，忽略寒暄和无意义重复；每个话题应有独立看点。",
    "只输出 JSON 数组，不要解释。数组元素格式：",
    "{\"title\":\"话题标题\",\"summary\":\"一句话概括\",\"keywords\":[\"关键词1\",\"关键词2\"]}",
    "",
    "字幕文本：",
    frameText(frames),
  ].join("\n");
  const parsed = await askJson(prompt, llmOptions);
  return (Array.isArray(parsed) ? parsed : [])
    .map((item, index) => ({
      id: `outline-${index + 1}`,
      title: String(item?.title || "").trim(),
      summary: String(item?.summary || "").trim(),
      keywords: Array.isArray(item?.keywords) ? item.keywords.map(String).slice(0, 6) : [],
    }))
    .filter((item) => item.title);
}

async function extractTimeline(outlines, frames, llmOptions, settings) {
  if (!outlines.length) return [];
  const prompt = [
    "你是短视频高光切片分析师。请在字幕中为每个话题定位自然的开始和结束时间。",
    "要求：",
    `1. 片段时长尽量在 ${settings.minDurationSec}-${settings.maxDurationSec} 秒之间。`,
    "2. 必须在语义完整的位置开始和结束，避免句子中间切断。",
    "3. 只输出 JSON 数组，不要解释。",
    "数组元素格式：",
    "{\"outlineId\":\"outline-1\",\"title\":\"片段标题\",\"start_time\":\"00:00:00,000\",\"end_time\":\"00:01:30,000\",\"content\":\"该片段对应的字幕内容摘要\"}",
    "",
    "话题大纲：",
    JSON.stringify(outlines, null, 2),
    "",
    "字幕：",
    srtTextForPrompt(frames),
  ].join("\n");
  const parsed = await askJson(prompt, llmOptions);
  return (Array.isArray(parsed) ? parsed : []).map((item, index) => {
    const startSec = srtTimeToSeconds(item?.start_time);
    const endSec = srtTimeToSeconds(item?.end_time);
    return {
      id: `clip-${index + 1}`,
      outlineId: String(item?.outlineId || item?.id || ""),
      title: String(item?.title || "").trim(),
      startSec,
      endSec,
      content: String(item?.content || "").trim(),
    };
  }).filter((item) => item.title && item.startSec !== null && item.endSec !== null && item.endSec > item.startSec);
}

async function scoreAndTitle(clips, llmOptions) {
  if (!clips.length) return [];
  const prompt = [
    "你是短视频内容策划。请对下面候选切片评分，并生成更适合发布的标题。",
    "评分参考：信息价值、情绪共鸣、传播潜力、结构完整性。",
    "只输出 JSON 数组，不要解释。数组元素格式：",
    "{\"id\":\"clip-1\",\"score\":0.86,\"title\":\"吸引人的标题\",\"reason\":\"15到30字推荐理由\"}",
    "",
    JSON.stringify(clips.map((clip) => ({
      id: clip.id,
      title: clip.title,
      durationSec: Math.round((clip.endSec - clip.startSec) * 10) / 10,
      content: clip.content,
    })), null, 2),
  ].join("\n");
  const parsed = await askJson(prompt, llmOptions);
  const scoreById = new Map((Array.isArray(parsed) ? parsed : []).map((item) => [String(item?.id || ""), item]));
  return clips.map((clip) => {
    const item = scoreById.get(clip.id) ?? {};
    const score = Number(item.score);
    return {
      ...clip,
      score: Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0.5,
      title: String(item.title || clip.title).trim(),
      reason: String(item.reason || "内容完整，适合剪成独立短视频").trim(),
    };
  });
}

async function recommendCollections(clips, llmOptions, maxCollections) {
  if (clips.length < 2 || maxCollections <= 0) return [];
  const prompt = [
    "你是视频合集策划。请根据切片标题和推荐理由，推荐适合拼成合集的视频组合。",
    `最多输出 ${maxCollections} 个合集，每个合集包含 2-5 个切片。`,
    "只输出 JSON 数组，不要解释。数组元素格式：",
    "{\"title\":\"合集标题\",\"summary\":\"合集简介\",\"clipIds\":[\"clip-1\",\"clip-2\"]}",
    "",
    JSON.stringify(clips.map((clip) => ({
      id: clip.id,
      title: clip.title,
      score: clip.score,
      reason: clip.reason,
    })), null, 2),
  ].join("\n");
  try {
    const parsed = await askJson(prompt, llmOptions);
    const ids = new Set(clips.map((clip) => clip.id));
    return (Array.isArray(parsed) ? parsed : []).map((item, index) => ({
      id: `collection-${index + 1}`,
      title: String(item?.title || `高光合集${index + 1}`).trim(),
      summary: String(item?.summary || "").trim(),
      clipIds: Array.isArray(item?.clipIds) ? item.clipIds.map(String).filter((id) => ids.has(id)).slice(0, 5) : [],
    })).filter((item) => item.title && item.clipIds.length >= 2).slice(0, maxCollections);
  } catch {
    const top = clips.slice().sort((a, b) => b.score - a.score).slice(0, Math.min(5, clips.length));
    return top.length >= 2 ? [{
      id: "collection-1",
      title: "精选高光合集",
      summary: "按精彩评分自动组合的高光片段",
      clipIds: top.map((clip) => clip.id),
    }] : [];
  }
}

function validateClips(clips, videoDuration, settings) {
  const minDuration = Math.max(5, Number(settings.minDurationSec) || 60);
  const maxDuration = Math.max(minDuration, Number(settings.maxDurationSec) || 360);
  const minScore = Math.max(0, Math.min(1, Number(settings.minScore) || 0));
  const normalized = [];
  for (const clip of clips) {
    const startSec = Math.max(0, Math.min(videoDuration || Infinity, Number(clip.startSec)));
    let endSec = Math.max(startSec, Math.min(videoDuration || Infinity, Number(clip.endSec)));
    if (endSec - startSec > maxDuration) endSec = startSec + maxDuration;
    if (endSec - startSec < minDuration) continue;
    if (Number(clip.score ?? 0.5) < minScore) continue;
    normalized.push({
      ...clip,
      startSec: Number(startSec.toFixed(3)),
      endSec: Number(endSec.toFixed(3)),
      durationSec: Number((endSec - startSec).toFixed(3)),
    });
  }
  return normalized
    .sort((a, b) => b.score - a.score || a.startSec - b.startSec)
    .slice(0, Math.max(1, Math.floor(Number(settings.maxClips) || 8)))
    .map((clip, index) => ({ ...clip, id: `clip-${index + 1}` }));
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

async function cutHighlightClip(sourcePath, outputPath, clip, quality) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await run(FFMPEG, [
    "-y",
    "-ss", String(clip.startSec),
    "-i", sourcePath,
    "-t", String(clip.durationSec),
    ...videoEncodeArgs(quality),
    "-c:a", "aac",
    "-b:a", "128k",
    "-ac", "2",
    "-ar", "48000",
    "-movflags", "+faststart",
    outputPath,
  ]);
}

async function createCollectionGroup(collection, clipsById, outputDir) {
  const selected = collection.clipIds.map((id) => clipsById.get(id)).filter(Boolean);
  if (selected.length < 2) return null;
  await mkdir(outputDir, { recursive: true });
  const payload = {
    id: collection.id,
    title: collection.title,
    summary: collection.summary,
    clipIds: selected.map((clip) => clip.id),
    clips: selected.map((clip, index) => ({
      order: index + 1,
      id: clip.id,
      title: clip.title,
      reason: clip.reason,
      score: Number(clip.score.toFixed(3)),
      sourceName: clip.sourceName,
      startSec: clip.startSec,
      endSec: clip.endSec,
      durationSec: clip.durationSec,
      timeRange: `${formatSeconds(clip.startSec)}-${formatSeconds(clip.endSec)}`,
      path: clip.path,
    })),
    note: "合集默认保存为分组目录和清单，不自动拼接成视频；需要时可基于 clipIds 再生成合集视频。",
  };
  await writeFile(path.join(outputDir, "collection.json"), JSON.stringify(payload, null, 2));
  await writeFile(
    path.join(outputDir, "clips.txt"),
    selected.map((clip, index) => `${index + 1}. ${clip.title}\n${clip.path}`).join("\n\n") + "\n",
  );
  return { ...collection, path: outputDir, items: payload.clips };
}

async function analyzeVideo(videoPath, options, settings) {
  const send = options.onEvent ?? (() => {});
  const videoDuration = await probeDuration(videoPath);
  send({ type: "analysis", msg: "准备字幕和内容文本", video: path.basename(videoPath) });
  const { frames, source, sourceType } = await resolveFrames(videoPath, {
    srtPath: options.srtPath,
    enableAsr: settings.enableAsr,
    workDir: options.workDir,
    asrCacheDir: options.asrCacheDir,
    onEvent: send,
  });
  const chunks = chunkFrames(frames);
  const allCandidates = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    send({ type: "analysis", msg: `分析内容结构 ${i + 1}/${chunks.length}`, video: path.basename(videoPath) });
    const outlines = await analyzeOutline(chunk, options.llm);
    send({ type: "timeline", msg: `定位高光时间段 ${i + 1}/${chunks.length}`, video: path.basename(videoPath), outlines: outlines.length });
    const timeline = await extractTimeline(outlines, chunk, options.llm, settings);
    allCandidates.push(...timeline);
  }
  send({ type: "score", msg: "评估精彩程度并生成标题", video: path.basename(videoPath) });
  const scored = await scoreAndTitle(allCandidates, options.llm);
  const clips = validateClips(scored, videoDuration, settings);
  return { clips, srtSource: source, srtSourceType: sourceType, durationSec: videoDuration };
}

export async function runHighlightClips(videos, options = {}) {
  const send = options.onEvent ?? (() => {});
  const outputDir = path.resolve(options.outputDir);
  const clipsDir = path.join(outputDir, "clips");
  const collectionsDir = path.join(outputDir, "collections");
  const settings = {
    minDurationSec: Math.max(5, Number(options.minDurationSec ?? 60)),
    maxDurationSec: Math.max(10, Number(options.maxDurationSec ?? 360)),
    minScore: Math.max(0, Math.min(1, Number(options.minScore ?? 0.65))),
    maxClips: Math.max(1, Math.floor(Number(options.maxClips ?? 8))),
    maxCollections: Math.max(0, Math.floor(Number(options.maxCollections ?? 2))),
    enableAsr: options.enableAsr !== false,
    exportQuality: options.exportQuality || "high",
  };
  if (settings.maxDurationSec < settings.minDurationSec) settings.maxDurationSec = settings.minDurationSec;
  await mkdir(clipsDir, { recursive: true });
  await mkdir(collectionsDir, { recursive: true });

  const allClips = [];
  const sourceReports = [];
  send({ type: "start", total: videos.length, settings });
  for (let videoIndex = 0; videoIndex < videos.length; videoIndex++) {
    const videoPath = videos[videoIndex];
    send({ type: "file", index: videoIndex + 1, total: videos.length, name: path.basename(videoPath), path: videoPath });
    const report = await analyzeVideo(videoPath, options, settings);
    sourceReports.push({
      path: videoPath,
      name: path.basename(videoPath),
      durationSec: report.durationSec,
      srtSource: report.srtSource,
      srtSourceType: report.srtSourceType,
      candidateCount: report.clips.length,
    });
    for (let i = 0; i < report.clips.length; i++) {
      const sourceBase = safeFilename(path.basename(videoPath, path.extname(videoPath)), `视频${videoIndex + 1}`, 18);
      const titleBase = safeFilename(report.clips[i].title, `高光${i + 1}`, 28);
      const idHash = createHash("sha1").update(`${videoPath}:${report.clips[i].startSec}:${report.clips[i].endSec}`).digest("hex").slice(0, 8);
      const fileName = `${String(videoIndex + 1).padStart(2, "0")}_${String(i + 1).padStart(2, "0")}_${sourceBase}_${titleBase}_${idHash}.mp4`;
      const outputPath = path.join(clipsDir, fileName);
      const clip = {
        ...report.clips[i],
        id: `clip-${allClips.length + 1}`,
        sourcePath: videoPath,
        sourceName: path.basename(videoPath),
        name: fileName,
        path: outputPath,
      };
      send({ type: "clip", name: clip.title, sourceName: clip.sourceName, startSec: clip.startSec, endSec: clip.endSec, score: clip.score });
      await cutHighlightClip(videoPath, outputPath, clip, settings.exportQuality);
      allClips.push(clip);
      send({ type: "clip_done", index: allClips.length, name: clip.name, path: outputPath, title: clip.title, sourceName: clip.sourceName, startSec: clip.startSec, endSec: clip.endSec, durationSec: clip.durationSec, score: clip.score });
    }
  }

  const collections = await recommendCollections(allClips, options.llm, settings.maxCollections);
  const clipsById = new Map(allClips.map((clip) => [clip.id, clip]));
  const generatedCollections = [];
  for (let i = 0; i < collections.length; i++) {
    const collection = collections[i];
    const dirName = `${String(i + 1).padStart(2, "0")}_${safeFilename(collection.title, "高光合集", 32)}`;
    const outputPath = path.join(collectionsDir, dirName);
    send({ type: "collection", title: collection.title, count: collection.clipIds.length });
    const group = await createCollectionGroup(collection, clipsById, outputPath);
    if (group) {
      generatedCollections.push({ ...group, name: dirName });
      send({ type: "collection_done", index: generatedCollections.length, title: collection.title, name: dirName, path: outputPath, count: collection.clipIds.length });
    }
  }

  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    mode: "highlight",
    modeLabel: "高光切片",
    exportDir: outputDir,
    settings,
    process: {
      visible: true,
      basis: "参考 AutoClip 的字幕语义切片流程，但输出采用本项目的分组目录方案。",
      steps: [
        "准备素材：读取本地视频，优先使用同名或指定 SRT；没有字幕时可自动识别。",
        "内容分析：按字幕文本提取话题大纲和关键信息。",
        "时间线提取：根据话题在字幕中定位自然的开始和结束时间。",
        "精彩评分：按信息价值、情绪共鸣、传播潜力和结构完整性评分。",
        "标题生成：为保留片段生成适合短视频发布的标题和推荐理由。",
        "合集推荐：按主题把相关片段分组，保存为目录和 collection.json。",
        "视频生成：只默认生成单个高光片段；合集视频后续作为可选动作。",
      ],
      decisions: [
        "合集不是默认拼接视频，而是可复用的片段分组。",
        "片段视频只保存在 clips 目录，合集目录通过清单引用片段，避免重复占用空间。",
        "切分依据以字幕语义时间段为主，不按镜头变化硬切。",
      ],
    },
    sources: sourceReports,
    clips: allClips.map((clip) => ({
      id: clip.id,
      name: clip.name,
      title: clip.title,
      reason: clip.reason,
      score: Number(clip.score.toFixed(3)),
      sourcePath: clip.sourcePath,
      sourceName: clip.sourceName,
      startSec: clip.startSec,
      endSec: clip.endSec,
      durationSec: clip.durationSec,
      timeRange: `${formatSeconds(clip.startSec)}-${formatSeconds(clip.endSec)}`,
      path: clip.path,
    })),
    collections: generatedCollections.map((item) => ({
      id: item.id,
      name: item.name,
      title: item.title,
      summary: item.summary,
      clipIds: item.clipIds,
      path: item.path,
      items: item.items ?? [],
    })),
  };
  const manifestPath = path.join(outputDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { ...manifest, manifestPath };
}
