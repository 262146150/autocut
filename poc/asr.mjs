import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSrt, subtitleTextFromFrames } from "./srt.mjs";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, "..");

function run(bin, args, options = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { ...options, windowsHide: true });
    let out = "";
    let err = "";
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve({ stdout: out, stderr: err });
      else reject(new Error(`${path.basename(bin)} exit ${code}\n${(err || out).slice(-1200)}`));
    });
  });
}

function envPath(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && existsSync(value)) return value;
  }
  return null;
}

function pathExecutable(name) {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function findFirstExisting(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

export function resolveWhisperConfig() {
  const bin = envPath("ECUT_WHISPER_BIN", "WHISPER_CPP_BIN") ?? findFirstExisting([
    path.join(ROOT, "tools/whisper.cpp/build/bin/whisper-cli"),
    path.join(ROOT, "tools/whisper.cpp/build/bin/main"),
    path.join(ROOT, "tools/whisper.cpp/main"),
    pathExecutable("whisper-cli"),
    pathExecutable("whisper-cpp"),
  ]);
  const model = envPath("ECUT_WHISPER_MODEL", "WHISPER_MODEL") ?? findFirstExisting([
    path.join(ROOT, "models/whisper/ggml-base.bin"),
    path.join(ROOT, "models/whisper/ggml-tiny.bin"),
    path.join(ROOT, "models/whisper/ggml-tiny-q5_1.bin"),
    path.join(ROOT, "tools/whisper.cpp/models/ggml-base.bin"),
    path.join(ROOT, "tools/whisper.cpp/models/ggml-tiny.bin"),
    path.join(ROOT, "tools/whisper.cpp/models/ggml-tiny-q5_1.bin"),
    path.join(process.env.HOME ?? "", ".cache/ecutauto-clone/models/whisper/ggml-base.bin"),
    path.join(process.env.HOME ?? "", ".cache/ecutauto-clone/models/whisper/ggml-tiny.bin"),
    path.join(process.env.HOME ?? "", ".cache/ecutauto-clone/models/whisper/ggml-tiny-q5_1.bin"),
  ]);
  const vadModel = envPath("ECUT_VAD_MODEL", "WHISPER_VAD_MODEL") ?? findFirstExisting([
    path.join(ROOT, "models/whisper/ggml-silero-v6.2.0.bin"),
    path.join(ROOT, "tools/whisper.cpp/models/ggml-silero-v6.2.0.bin"),
    path.join(process.env.HOME ?? "", ".cache/ecutauto-clone/models/whisper/ggml-silero-v6.2.0.bin"),
  ]);
  return {
    bin,
    model,
    vadModel,
    language: process.env.ECUT_ASR_LANG || process.env.WHISPER_LANG || "zh",
  };
}

function cacheKey(input, info, options, config) {
  return createHash("sha1")
    .update(JSON.stringify({
      input: path.resolve(input),
      size: info.size,
      mtimeMs: info.mtimeMs,
      start: Number(options.clipStartSec ?? 0),
      end: Number(options.clipEndSec ?? 0),
      engine: "whisper.cpp",
      bin: config.bin,
      model: config.model,
      vadModel: config.vadModel,
      language: config.language,
    }))
    .digest("hex");
}

async function extractAudio(input, wavPath, options) {
  const start = Math.max(0, Number(options.clipStartSec ?? 0));
  const end = Math.max(0, Number(options.clipEndSec ?? 0));
  const args = ["-y"];
  if (start > 0) args.push("-ss", String(start));
  if (end > start) args.push("-t", String(end - start));
  else if (start === 0 && end > 0) args.push("-t", String(end));
  args.push("-i", input, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", wavPath);
  await run(options.ffmpegBin ?? "ffmpeg", args);
}

async function runWhisper(wavPath, srtBase, config) {
  const args = [
    "-m", config.model,
    "-f", wavPath,
    "-l", config.language,
    "-osrt",
    "-of", srtBase,
  ];
  if (config.vadModel) {
    args.push("--vad", "-vm", config.vadModel);
  }
  await run(config.bin, args);
}

export async function recognizeClipWithWhisper(input, options = {}) {
  const config = resolveWhisperConfig();
  if (!config.bin || !config.model) {
    throw new Error(
      "自动识别字幕未配置 whisper.cpp：请设置 ECUT_WHISPER_BIN 和 ECUT_WHISPER_MODEL"
    );
  }

  const info = await stat(input);
  const cacheDir = options.asrCacheDir ?? path.join(options.workDir ?? path.dirname(input), "asr-cache");
  await mkdir(cacheDir, { recursive: true });
  const key = cacheKey(input, info, options, config);
  const wavPath = path.join(cacheDir, `${key}.wav`);
  const srtBase = path.join(cacheDir, key);
  const srtPath = `${srtBase}.srt`;

  if (!existsSync(srtPath)) {
    options.onEvent?.({ type: "log", msg: `正在识别字幕：${path.basename(input)}` });
    await extractAudio(input, wavPath, { ...options, ffmpegBin: options.ffmpegBin });
    await runWhisper(wavPath, srtBase, config);
  }

  if (!existsSync(srtPath)) {
    throw new Error("ASR 已执行但未生成 SRT 文件，请检查 whisper.cpp 版本和参数");
  }
  const frames = parseSrt(await readFile(srtPath, "utf8"));
  if (!frames.length) {
    options.onEvent?.({ type: "log", msg: `未检测到有效人声：${path.basename(input)}` });
  }
  return {
    text: subtitleTextFromFrames(frames),
    frames,
    source: srtPath,
  };
}
