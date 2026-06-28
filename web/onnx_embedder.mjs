import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { FFMPEG } from "../poc/pipeline.mjs";

const DEFAULT_IMAGE_MEAN = [0.48145466, 0.4578275, 0.40821073];
const DEFAULT_IMAGE_STD = [0.26862954, 0.26130258, 0.27577711];

function abs(baseDir, file) {
  if (!file) return "";
  return path.isAbsolute(file) ? file : path.resolve(baseDir, file);
}

function firstExisting(paths) {
  return paths.find((item) => item && existsSync(item)) || "";
}

function normalizeVector(values) {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function averageVectors(vectors) {
  const valid = vectors.filter((item) => Array.isArray(item) && item.length);
  if (!valid.length) return null;
  const out = new Array(valid[0].length).fill(0);
  for (const vector of valid) {
    for (let i = 0; i < out.length; i++) out[i] += vector[i];
  }
  return normalizeVector(out.map((value) => value / valid.length));
}

function runBuffer(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let err = "";
    p.stdout.on("data", (d) => chunks.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`${path.basename(bin)} exit ${code}\n${err.slice(-600)}`));
    });
  });
}

async function imageTensorFromFile(file, imageConfig) {
  const size = Number(imageConfig.size || 224);
  const layout = imageConfig.layout || "NCHW";
  const mean = imageConfig.mean || DEFAULT_IMAGE_MEAN;
  const std = imageConfig.std || DEFAULT_IMAGE_STD;
  const vf = imageConfig.crop === "none" || imageConfig.fit === "contain"
    ? `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2,format=rgb24`
    : `scale=${size}:${size}:force_original_aspect_ratio=increase,crop=${size}:${size},format=rgb24`;
  const raw = await runBuffer(FFMPEG, [
    "-hide_banner",
    "-loglevel", "error",
    "-i", file,
    "-frames:v", "1",
    "-vf", vf,
    "-f", "rawvideo",
    "-pix_fmt", "rgb24",
    "pipe:1",
  ]);
  const expected = size * size * 3;
  if (raw.length < expected) throw new Error("图像预处理失败：raw buffer 不完整");
  const data = new Float32Array(expected);
  if (layout === "NHWC") {
    for (let i = 0; i < expected; i += 3) {
      data[i] = (raw[i] / 255 - mean[0]) / std[0];
      data[i + 1] = (raw[i + 1] / 255 - mean[1]) / std[1];
      data[i + 2] = (raw[i + 2] / 255 - mean[2]) / std[2];
    }
    return { data, dims: [1, size, size, 3] };
  }
  const plane = size * size;
  for (let i = 0, p = 0; p < plane; p++, i += 3) {
    data[p] = (raw[i] / 255 - mean[0]) / std[0];
    data[plane + p] = (raw[i + 1] / 255 - mean[1]) / std[1];
    data[plane * 2 + p] = (raw[i + 2] / 255 - mean[2]) / std[2];
  }
  return { data, dims: [1, 3, size, size] };
}

async function loadVocab(vocabPath) {
  const lines = (await readFile(vocabPath, "utf8")).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return new Map(lines.map((token, index) => [token, index]));
}

function wordpieceTokenize(text, vocab) {
  const normalized = String(text || "").trim().toLowerCase();
  const basicTokens = [];
  let ascii = "";
  const flushAscii = () => {
    if (ascii) basicTokens.push(ascii);
    ascii = "";
  };
  for (const char of Array.from(normalized)) {
    if (/\s/.test(char)) {
      flushAscii();
      continue;
    }
    if (/[\p{P}\p{S}]/u.test(char)) {
      flushAscii();
      continue;
    }
    const code = char.codePointAt(0) || 0;
    if (code < 128 && /[a-z0-9]/i.test(char)) {
      ascii += char;
    } else {
      flushAscii();
      basicTokens.push(char);
    }
  }
  flushAscii();
  const pieces = [];
  for (const token of basicTokens) {
    if (vocab.has(token)) {
      pieces.push(token);
      continue;
    }
    let start = 0;
    const subwords = [];
    while (start < token.length) {
      let end = token.length;
      let found = "";
      while (start < end) {
        const part = `${start > 0 ? "##" : ""}${token.slice(start, end)}`;
        if (vocab.has(part)) {
          found = part;
          break;
        }
        end--;
      }
      if (!found) break;
      subwords.push(found);
      start = end;
    }
    if (subwords.length && start === token.length) pieces.push(...subwords);
    else if (Array.from(token).length === 1 && vocab.has(token)) pieces.push(token);
    else {
      pieces.push("[UNK]");
    }
  }
  return pieces;
}

function encodeText(text, vocab, textConfig) {
  const maxLength = Number(textConfig.maxLength || 52);
  const cls = textConfig.clsToken || "[CLS]";
  const sep = textConfig.sepToken || "[SEP]";
  const pad = textConfig.padToken || "[PAD]";
  const unk = textConfig.unkToken || "[UNK]";
  const tokens = [cls, ...wordpieceTokenize(text, vocab).slice(0, Math.max(0, maxLength - 2)), sep];
  const ids = tokens.map((token) => vocab.get(token) ?? vocab.get(unk) ?? 100);
  const mask = ids.map(() => 1);
  const padId = vocab.get(pad) ?? 0;
  while (ids.length < maxLength) {
    ids.push(padId);
    mask.push(0);
  }
  return {
    ids: BigInt64Array.from(ids.map((value) => BigInt(value))),
    mask: BigInt64Array.from(mask.map((value) => BigInt(value))),
    tokenTypes: BigInt64Array.from(new Array(maxLength).fill(0n)),
    dims: [1, maxLength],
  };
}

function firstOutput(outputs, preferred) {
  if (preferred && outputs[preferred]) return outputs[preferred];
  const key = Object.keys(outputs)[0];
  return outputs[key];
}

function outputVector(tensor) {
  if (!tensor?.data) throw new Error("ONNX 输出为空");
  const dims = tensor.dims || [];
  const data = Array.from(tensor.data, Number);
  if (dims.length === 3) {
    const hidden = dims[2];
    return normalizeVector(data.slice(0, hidden));
  }
  return normalizeVector(data);
}

export async function loadSmartOnnxProvider(options = {}) {
  const root = options.root || process.cwd();
  const manifestPath = process.env.ECUT_SMART_ONNX_MANIFEST || firstExisting([
    path.join(root, "models/smart-match/manifest.json"),
    path.join(root, "_models/smart-match/manifest.json"),
    path.join(root, "../app/src-tauri/Resources/models/smart-match/manifest.json"),
  ]);
  if (!manifestPath) {
    return { available: false, reason: "未配置智能匹配 ONNX manifest" };
  }
  let ort;
  try {
    ort = await import("onnxruntime-node");
  } catch (error) {
    return { available: false, reason: `onnxruntime-node 不可用：${error.message}` };
  }
  const baseDir = path.dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const image = manifest.image || {};
  const text = manifest.text || {};
  const imageModelPath = abs(baseDir, manifest.imageModel || image.model);
  const textModelPath = abs(baseDir, manifest.textModel || text.model);
  const vocabPath = abs(baseDir, manifest.vocab || text.vocab || "vocab.txt");
  if (!existsSync(imageModelPath) || !existsSync(textModelPath) || !existsSync(vocabPath)) {
    return { available: false, reason: "ONNX 模型或 vocab.txt 不完整", manifestPath };
  }
  const providers = manifest.executionProviders || ["cpu"];
  const sessionOptions = { executionProviders: providers };
  const imageSession = await ort.InferenceSession.create(imageModelPath, sessionOptions);
  const textSession = await ort.InferenceSession.create(textModelPath, sessionOptions);
  const vocab = await loadVocab(vocabPath);
  const modelKey = createHash("sha1")
    .update(JSON.stringify({
      manifestPath,
      imageModelPath,
      textModelPath,
      vocabPath,
      image,
      text,
    }))
    .digest("hex")
    .slice(0, 16);

  const provider = {
    available: true,
    engine: manifest.engine || "onnx-clip-v1",
    manifestPath,
    modelKey,
    async embedImage(file) {
      const input = await imageTensorFromFile(file, image);
      const inputName = image.inputName || imageSession.inputNames[0];
      const outputName = image.outputName || imageSession.outputNames[0];
      const feeds = { [inputName]: new ort.Tensor("float32", input.data, input.dims) };
      const outputs = await imageSession.run(feeds);
      return outputVector(firstOutput(outputs, outputName));
    },
    async embedImages(files) {
      const vectors = [];
      for (const file of files) {
        try {
          vectors.push(await provider.embedImage(file));
        } catch {
          // Keep indexing resilient; a broken frame should not fail the whole batch.
        }
      }
      return averageVectors(vectors);
    },
    async embedText(value) {
      const encoded = encodeText(value, vocab, text);
      const idsName = text.inputIdsName || "input_ids";
      const maskName = text.attentionMaskName || "attention_mask";
      const typeName = text.tokenTypeIdsName || "token_type_ids";
      const outputName = text.outputName || textSession.outputNames[0];
      const feeds = {
        [idsName]: new ort.Tensor("int64", encoded.ids, encoded.dims),
        [maskName]: new ort.Tensor("int64", encoded.mask, encoded.dims),
      };
      if (textSession.inputNames.includes(typeName)) {
        feeds[typeName] = new ort.Tensor("int64", encoded.tokenTypes, encoded.dims);
      }
      const outputs = await textSession.run(feeds);
      return outputVector(firstOutput(outputs, outputName));
    },
  };
  return provider;
}
