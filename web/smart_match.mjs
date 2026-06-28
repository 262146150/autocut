import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { FFMPEG, probeDuration, run } from "../poc/pipeline.mjs";
import { cosineSimilarity, loadSmartOnnxProvider } from "./onnx_embedder.mjs";

const STOP_WORDS = new Set([
  "的", "了", "和", "与", "及", "在", "是", "有", "就", "都", "也", "很", "让", "把",
  "一个", "一种", "这个", "那个", "我们", "你们", "他们", "进行", "可以", "没有",
  "the", "and", "for", "with", "from", "this", "that", "video", "clip",
]);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_\-./\\()[\]{}]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function charNgrams(text, size) {
  const chars = Array.from(text.replace(/\s+/g, ""));
  if (chars.length < size) return [];
  const grams = [];
  for (let i = 0; i <= chars.length - size; i++) grams.push(chars.slice(i, i + size).join(""));
  return grams;
}

function tokenize(value) {
  const normalized = normalizeText(value);
  const wordTokens = normalized.split(/\s+/).filter((token) => token && !STOP_WORDS.has(token));
  const grams = [
    ...charNgrams(normalized, 2),
    ...charNgrams(normalized, 3),
  ].filter((token) => token && !STOP_WORDS.has(token));
  return Array.from(new Set([...wordTokens, ...grams]));
}

function tokenScore(queryTokens, targetTokens) {
  if (!queryTokens.length || !targetTokens.length) return 0;
  const target = new Set(targetTokens);
  let score = 0;
  for (const token of queryTokens) {
    if (target.has(token)) score += token.length >= 3 ? 2 : 1;
  }
  return score / Math.max(1, queryTokens.length);
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rotate(items, offset) {
  if (!items.length) return [];
  const start = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

function indexKey(items, modelKey = "") {
  const hash = createHash("sha1");
  hash.update(modelKey);
  hash.update("\n");
  for (const item of items) {
    hash.update(item.path);
    hash.update(":");
    hash.update(String(item.size));
    hash.update(":");
    hash.update(String(Math.round(item.mtimeMs)));
    hash.update("\n");
  }
  return hash.digest("hex").slice(0, 16);
}

async function clipFingerprint(clip) {
  const info = await stat(clip);
  return {
    path: clip,
    size: info.size,
    mtimeMs: info.mtimeMs,
  };
}

function clipText(clip) {
  const base = path.basename(clip, path.extname(clip));
  const dir = path.basename(path.dirname(clip));
  return `${dir} ${base}`;
}

async function extractThumb(clip, output, duration, ratio) {
  const at = Math.max(0.1, Math.min(Math.max(0.1, duration - 0.1), duration * ratio));
  await run(FFMPEG, [
    "-y",
    "-ss", at.toFixed(3),
    "-i", clip,
    "-frames:v", "1",
    "-vf", "scale=224:224:force_original_aspect_ratio=decrease,pad=224:224:(ow-iw)/2:(oh-ih)/2,format=yuvj420p",
    "-q:v", "3",
    output,
  ]);
}

async function buildClipEntry(clip, fingerprint, dir, index, onnxProvider) {
  const durationSec = await probeDuration(clip);
  const safeBase = `${String(index + 1).padStart(5, "0")}_${createHash("sha1").update(clip).digest("hex").slice(0, 8)}`;
  const thumbs = [];
  for (const ratio of [0.2, 0.5, 0.8]) {
    const thumb = path.join(dir, `${safeBase}_${Math.round(ratio * 100)}.jpg`);
    try {
      if (!existsSync(thumb)) await extractThumb(clip, thumb, durationSec || 1, ratio);
      thumbs.push(thumb);
    } catch {
      // Some browser-supported files still fail frame extraction; keep the clip indexed.
    }
  }
  const text = clipText(clip);
  const embedding = onnxProvider?.available ? await onnxProvider.embedImages(thumbs) : null;
  return {
    ...fingerprint,
    name: path.basename(clip),
    dirName: path.basename(path.dirname(clip)),
    durationSec,
    text,
    tokens: tokenize(text),
    thumbs,
    embedding,
  };
}

export async function buildSmartMaterialIndex(clips, options = {}) {
  const cacheDir = options.cacheDir || path.join(process.cwd(), "_cache", "smart-index");
  const onnxProvider = await loadSmartOnnxProvider({ root: options.root || process.cwd() });
  if (onnxProvider.available) {
    options.onEvent?.({ type: "log", msg: `ONNX匹配：已加载 ${onnxProvider.engine}` });
  } else {
    options.onEvent?.({ type: "log", msg: `ONNX匹配：${onnxProvider.reason}，使用本地索引匹配` });
  }
  const fingerprints = [];
  for (const clip of clips) {
    try {
      fingerprints.push(await clipFingerprint(clip));
    } catch {
      // Deleted or unreadable files are ignored; collectClips has already filtered the main list.
    }
  }
  const key = indexKey(fingerprints, onnxProvider.available ? onnxProvider.modelKey : "");
  const dir = path.join(cacheDir, key);
  const indexPath = path.join(dir, "index.json");
  await mkdir(dir, { recursive: true });
  if (existsSync(indexPath)) {
    try {
      const cached = JSON.parse(await readFile(indexPath, "utf8"));
      if (cached.version === 3 && Array.isArray(cached.clips) && cached.clips.length === fingerprints.length) {
        return { ...cached, reused: true, path: indexPath, onnxProvider };
      }
    } catch {
      // Rebuild invalid cache files.
    }
  }
  options.onEvent?.({ type: "log", msg: `智能索引：开始分析 ${fingerprints.length} 个素材…` });
  const entries = [];
  for (let i = 0; i < fingerprints.length; i++) {
    const item = fingerprints[i];
    if (i === 0 || (i + 1) % 10 === 0 || i === fingerprints.length - 1) {
      options.onEvent?.({ type: "log", msg: `智能索引：${i + 1}/${fingerprints.length}` });
    }
    entries.push(await buildClipEntry(item.path, item, dir, i, onnxProvider.available ? onnxProvider : null));
  }
  const index = {
    version: 3,
    engine: onnxProvider.available ? onnxProvider.engine : "local-frame-index-v2",
    createdAt: new Date().toISOString(),
    key,
    onnx: {
      available: onnxProvider.available,
      reason: onnxProvider.available ? "" : onnxProvider.reason,
      manifestPath: onnxProvider.manifestPath || "",
      modelKey: onnxProvider.modelKey || "",
    },
    clips: entries,
  };
  await writeFile(indexPath, JSON.stringify(index, null, 2));
  return { ...index, reused: false, path: indexPath, onnxProvider };
}

export async function rankClipsForPrompt(clips, prompt, options = {}) {
  const queryTokens = tokenize(prompt);
  const fallbackOffset = stableHash(prompt) % Math.max(1, clips.length);
  const indexed = new Map((options.index?.clips ?? []).map((item) => [item.path, item]));
  const textEmbedding = options.index?.onnxProvider?.available
    ? await options.index.onnxProvider.embedText(prompt).catch(() => null)
    : null;
  const ranked = clips
    .map((clip, index) => {
      const indexedClip = indexed.get(clip);
      const clipTokens = indexedClip?.tokens?.length ? indexedClip.tokens : tokenize(clipText(clip));
      const lexicalScore = tokenScore(queryTokens, clipTokens);
      const vectorScore = textEmbedding && indexedClip?.embedding
        ? Math.max(0, cosineSimilarity(textEmbedding, indexedClip.embedding))
        : 0;
      const score = vectorScore > 0 ? vectorScore : lexicalScore;
      return {
        clip,
        index,
        score,
        reason: vectorScore > 0 ? "onnx-vector" : score > 0 ? (indexedClip ? "smart-index" : "filename") : "fallback",
        lexicalScore,
        vectorScore,
        thumbs: indexedClip?.thumbs ?? [],
        durationSec: indexedClip?.durationSec ?? 0,
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const ordered = ranked.map((item) => item.clip);
  const hasMatch = ranked.some((item) => item.score > 0);
  return {
    clips: hasMatch ? ordered : rotate(clips, fallbackOffset),
    matches: ranked.slice(0, Math.min(8, ranked.length)).map((item) => ({
      name: path.basename(item.clip),
      score: Number(item.score.toFixed(3)),
      reason: item.reason,
      lexicalScore: Number(item.lexicalScore.toFixed(3)),
      vectorScore: Number(item.vectorScore.toFixed(3)),
      thumbs: item.thumbs,
      durationSec: item.durationSec,
    })),
    engine: textEmbedding && ranked.some((item) => item.vectorScore > 0)
      ? options.index?.engine || "onnx-clip-v1"
      : options.index?.engine
        ? `${options.index.engine}${hasMatch ? "" : "-fallback"}`
        : hasMatch ? "local-lexical-v1" : "local-lexical-v1-fallback",
    indexPath: options.index?.path,
  };
}
