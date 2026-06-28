import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { FFMPEG, FFPROBE, runOutput } from "../poc/pipeline.mjs";

const FRAME_W = 48;
const FRAME_H = 27;
const CHANNELS = 3;
const FRAME_SIZE = FRAME_W * FRAME_H * CHANNELS;
const WINDOW = 100;
const STRIDE = 50;
const CENTER_START = 25;
const CENTER_END = 75;

function abs(baseDir, file) {
  if (!file) return "";
  return path.isAbsolute(file) ? file : path.resolve(baseDir, file);
}

function firstExisting(paths) {
  return paths.find((item) => item && existsSync(item)) || "";
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

function parseRate(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  if (text.includes("/")) {
    const [a, b] = text.split("/").map(Number);
    return b ? a / b : 0;
  }
  const rate = Number(text);
  return Number.isFinite(rate) ? rate : 0;
}

async function probeFps(file) {
  try {
    const out = await runOutput(FFPROBE, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=avg_frame_rate,r_frame_rate",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    const rates = out.split(/\r?\n/).map(parseRate).filter((rate) => rate > 0);
    return rates[0] || 25;
  } catch {
    return 25;
  }
}

async function extractFrames(file, detectFps) {
  const filters = [];
  if (detectFps > 0) filters.push(`fps=${detectFps}`);
  filters.push(`scale=${FRAME_W}:${FRAME_H}`, "format=rgb24");
  const raw = await runBuffer(FFMPEG, [
    "-hide_banner",
    "-loglevel", "error",
    "-i", file,
    "-vf", filters.join(","),
    "-f", "rawvideo",
    "-pix_fmt", "rgb24",
    "pipe:1",
  ]);
  const frameCount = Math.floor(raw.length / FRAME_SIZE);
  if (!frameCount) throw new Error("TransNetV2 预处理失败：未提取到视频帧");
  const bytes = raw.subarray(0, frameCount * FRAME_SIZE);
  return { bytes, frameCount };
}

function frameToFloat(bytes, frameIndex, out, outOffset) {
  const srcOffset = frameIndex * FRAME_SIZE;
  for (let i = 0; i < FRAME_SIZE; i++) out[outOffset + i] = bytes[srcOffset + i];
}

function makeWindowTensor(bytes, frameCount, start) {
  const data = new Float32Array(WINDOW * FRAME_SIZE);
  for (let i = 0; i < WINDOW; i++) {
    const frameIndex = Math.max(0, Math.min(frameCount - 1, start + i));
    frameToFloat(bytes, frameIndex, data, i * FRAME_SIZE);
  }
  return data;
}

function predictionsToCuts(predictions, fps, threshold, minDurationSec) {
  const binary = predictions.map((value) => value > threshold ? 1 : 0);
  const cuts = [];
  let previous = 0;
  for (let i = 0; i < binary.length; i++) {
    const current = binary[i];
    if (previous === 0 && current === 1 && i !== 0) {
      const time = i / Math.max(1, fps);
      const last = cuts[cuts.length - 1] ?? -Infinity;
      if (time - last >= minDurationSec) cuts.push(Number(time.toFixed(3)));
    }
    previous = current;
  }
  return cuts;
}

function firstOutput(outputs, preferred) {
  if (preferred && outputs[preferred]) return outputs[preferred];
  const key = Object.keys(outputs)[0];
  return outputs[key];
}

export async function loadTransNetV2Provider(options = {}) {
  const root = options.root || process.cwd();
  const manifestPath = process.env.ECUT_TRANSNETV2_ONNX_MANIFEST || firstExisting([
    path.join(root, "models/transnetv2/manifest.json"),
    path.join(root, "_models/transnetv2/manifest.json"),
    path.join(root, "../app/src-tauri/Resources/models/transnetv2/manifest.json"),
  ]);
  if (!manifestPath) {
    return { available: false, reason: "未配置 TransNetV2 ONNX manifest" };
  }
  let ort;
  try {
    ort = await import("onnxruntime-node");
  } catch (error) {
    return { available: false, reason: `onnxruntime-node 不可用：${error.message}` };
  }
  const baseDir = path.dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const modelPath = abs(baseDir, manifest.model || "transnetv2.onnx");
  if (!existsSync(modelPath)) {
    return { available: false, reason: "TransNetV2 ONNX 模型文件不存在", manifestPath };
  }
  const providers = manifest.executionProviders || ["cpu"];
  const session = await ort.InferenceSession.create(modelPath, { executionProviders: providers });
  const inputName = manifest.inputName || session.inputNames[0] || "input";
  const singleOutputName = manifest.singleOutputName || session.outputNames[0];
  const modelKey = createHash("sha1")
    .update(JSON.stringify({ manifestPath, modelPath, inputName, singleOutputName }))
    .digest("hex")
    .slice(0, 16);

  return {
    available: true,
    engine: manifest.engine || "transnetv2-onnx",
    manifestPath,
    modelKey,
    async detectCuts(file, detectOptions = {}) {
      const threshold = Math.max(0.05, Math.min(0.95, Number(detectOptions.threshold ?? manifest.threshold ?? 0.5)));
      const minDurationSec = Math.max(0.4, Number(detectOptions.minDurationSec ?? 1.2));
      const sourceFps = await probeFps(file);
      const requestedDetectFps = Number(detectOptions.detectFps ?? manifest.detectFps ?? 12);
      const fps = requestedDetectFps > 0 ? Math.min(sourceFps || requestedDetectFps, requestedDetectFps) : sourceFps;
      const { bytes, frameCount } = await extractFrames(file, requestedDetectFps);
      const predictions = [];
      const padStart = 25;
      const mod = frameCount % STRIDE;
      const padEnd = 25 + STRIDE - (mod === 0 ? STRIDE : mod);
      const paddedLength = padStart + frameCount + padEnd;
      for (let ptr = 0; ptr + WINDOW <= paddedLength; ptr += STRIDE) {
        const sourceStart = ptr - padStart;
        const input = makeWindowTensor(bytes, frameCount, sourceStart);
        const outputs = await session.run({
          [inputName]: new ort.Tensor("float32", input, [1, WINDOW, FRAME_H, FRAME_W, CHANNELS]),
        });
        const tensor = firstOutput(outputs, singleOutputName);
        const values = Array.from(tensor.data, Number).slice(CENTER_START, CENTER_END);
        predictions.push(...values);
      }
      const trimmed = predictions.slice(0, frameCount);
      return {
        cuts: predictionsToCuts(trimmed, fps, threshold, minDurationSec),
        fps,
        sourceFps,
        frameCount,
        threshold,
      };
    },
  };
}
