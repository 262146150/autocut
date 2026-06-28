import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dir, "..");
const MODEL_DIR = path.join(WEB_ROOT, "models", "sherpa-vad");
const REPO = process.env.ECUT_SHERPA_VAD_REPO || "R4kSo1997/sherpa-onnx-silero-vad-v5";
const REVISION = process.env.ECUT_SHERPA_VAD_REVISION || "main";
const FILE = "silero_vad.onnx";

function urlFor(file) {
  return `https://huggingface.co/${REPO}/resolve/${REVISION}/${file}`;
}

function curlDownload(file, out) {
  return new Promise((resolve, reject) => {
    const p = spawn("curl", [
      "-L",
      "--fail",
      "--http1.1",
      "--retry", "5",
      "--retry-all-errors",
      "--retry-delay", "2",
      "-o", out,
      urlFor(file),
    ], { stdio: "inherit" });
    p.on("close", (code) => {
      code === 0 ? resolve() : reject(new Error(`curl exit ${code}`));
    });
  });
}

async function sha256(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

async function writeManifest(modelSha) {
  const manifest = {
    version: 1,
    engine: "sherpa-onnx-silero-vad",
    model: FILE,
    sampleRate: 16000,
    threshold: 0.5,
    minSilenceDuration: 0.35,
    minSpeechDuration: 0.15,
    maxSpeechDuration: 20,
    windowSize: 512,
    provider: "cpu",
    numThreads: 1,
    source: {
      repo: REPO,
      revision: REVISION,
      file: FILE,
      sha256: modelSha,
    },
  };
  await writeFile(path.join(MODEL_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
}

await mkdir(MODEL_DIR, { recursive: true });
const modelPath = path.join(MODEL_DIR, FILE);
if (!existsSync(modelPath)) await curlDownload(FILE, modelPath);
const modelSha = await sha256(modelPath);
await writeManifest(modelSha);
await writeFile(path.join(MODEL_DIR, `${FILE}.complete`), new Date().toISOString());
console.log(`model ${modelPath}`);
console.log(`sha256 ${modelSha}`);
console.log(`manifest ${path.join(MODEL_DIR, "manifest.json")}`);
