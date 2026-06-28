import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { FFMPEG, run } from "../poc/pipeline.mjs";

function abs(baseDir, file) {
  if (!file) return "";
  return path.isAbsolute(file) ? file : path.resolve(baseDir, file);
}

function firstExisting(paths) {
  return paths.find((item) => item && existsSync(item)) || "";
}

async function extractWav(input, sampleRate) {
  const dir = path.join(os.tmpdir(), `ecutauto-vad-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  const wav = path.join(dir, "audio.wav");
  try {
    await run(FFMPEG, [
      "-y",
      "-i", input,
      "-vn",
      "-ac", "1",
      "-ar", String(sampleRate),
      "-f", "wav",
      wav,
    ]);
    return { wav, cleanup: () => rm(dir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

function normalizeSegments(segments, sampleRate, durationSec, padSec) {
  const total = Math.max(0, Number(durationSec) || 0);
  const pad = Math.max(0, Number(padSec) || 0);
  return segments
    .map((segment) => {
      const start = Math.max(0, (Number(segment.start) || 0) / sampleRate - pad);
      const end = Math.min(total || Infinity, ((Number(segment.start) || 0) + (segment.samples?.length || 0)) / sampleRate + pad);
      return { startSec: Number(start.toFixed(3)), endSec: Number(end.toFixed(3)) };
    })
    .filter((segment) => segment.endSec > segment.startSec);
}

export function protectCutsWithSpeech(cuts, speechSegments, options = {}) {
  if (!speechSegments?.length || !cuts?.length) return cuts ?? [];
  const durationSec = Math.max(0, Number(options.durationSec) || 0);
  const maxShiftSec = Math.max(0, Number(options.maxShiftSec ?? 1.5));
  const protectedCuts = [];
  for (const cut of cuts) {
    const speech = speechSegments.find((segment) => cut >= segment.startSec && cut <= segment.endSec);
    if (!speech) {
      protectedCuts.push(cut);
      continue;
    }
    const before = Math.max(0, speech.startSec);
    const after = durationSec > 0 ? Math.min(durationSec, speech.endSec) : speech.endSec;
    const beforeShift = Math.abs(cut - before);
    const afterShift = Math.abs(after - cut);
    let next = cut;
    if (beforeShift <= afterShift && beforeShift <= maxShiftSec) next = before;
    else if (afterShift <= maxShiftSec) next = after;
    else next = cut;
    if (next > 0.2 && (!durationSec || next < durationSec - 0.2)) protectedCuts.push(Number(next.toFixed(3)));
  }
  return Array.from(new Set(protectedCuts)).sort((a, b) => a - b);
}

export async function loadSherpaVadProvider(options = {}) {
  const root = options.root || process.cwd();
  const manifestPath = process.env.ECUT_SHERPA_VAD_MANIFEST || firstExisting([
    path.join(root, "models/sherpa-vad/manifest.json"),
    path.join(root, "_models/sherpa-vad/manifest.json"),
    path.join(root, "../app/src-tauri/Resources/models/sherpa-vad/manifest.json"),
  ]);
  if (!manifestPath) return { available: false, reason: "未配置 sherpa-onnx VAD manifest" };

  let sherpa;
  try {
    const module = await import("sherpa-onnx-node");
    sherpa = module.default ?? module;
  } catch (error) {
    return { available: false, reason: `sherpa-onnx-node 不可用：${error.message}` };
  }

  const baseDir = path.dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const modelPath = abs(baseDir, manifest.model || "silero_vad.onnx");
  if (!existsSync(modelPath)) return { available: false, reason: "sherpa-onnx VAD 模型文件不存在", manifestPath };

  const sampleRate = Number(manifest.sampleRate || 16000);
  const config = {
    sileroVad: {
      model: modelPath,
      threshold: Number(manifest.threshold ?? 0.5),
      minSilenceDuration: Number(manifest.minSilenceDuration ?? 0.35),
      minSpeechDuration: Number(manifest.minSpeechDuration ?? 0.15),
      maxSpeechDuration: Number(manifest.maxSpeechDuration ?? 20),
      windowSize: Number(manifest.windowSize ?? 512),
    },
    sampleRate,
    numThreads: Number(manifest.numThreads ?? 1),
    provider: manifest.provider || "cpu",
    debug: Boolean(manifest.debug ?? false),
  };
  const modelKey = createHash("sha1")
    .update(JSON.stringify({ manifestPath, modelPath, config }))
    .digest("hex")
    .slice(0, 16);

  return {
    available: true,
    engine: manifest.engine || "sherpa-onnx-silero-vad",
    manifestPath,
    modelKey,
    sampleRate,
    async detectSpeech(input, detectOptions = {}) {
      const durationSec = Number(detectOptions.durationSec ?? 0);
      const padSec = Math.max(0, Number(detectOptions.padSec ?? 0.15));
      const { wav, cleanup } = await extractWav(input, sampleRate);
      try {
        const audio = sherpa.readWave(wav);
        const vad = new sherpa.Vad(config, Math.max(30, durationSec + 5));
        const chunkSize = sampleRate / 10;
        for (let i = 0; i < audio.samples.length; i += chunkSize) {
          vad.acceptWaveform(audio.samples.slice(i, i + chunkSize));
        }
        vad.flush();
        const raw = [];
        while (!vad.isEmpty()) {
          raw.push(vad.front());
          vad.pop();
        }
        return normalizeSegments(raw, sampleRate, durationSec, padSec);
      } finally {
        await cleanup();
      }
    },
  };
}
