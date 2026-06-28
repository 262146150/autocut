import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dir, "..");
const MODEL_DIR = path.join(WEB_ROOT, "models", "smart-match");
const REPO = process.env.ECUT_SMART_ONNX_REPO || "zihuv/chinese-clip-vit-base-patch16-onnx";
const REVISION = process.env.ECUT_SMART_ONNX_REVISION || "main";
const FILES = ["visual.onnx", "text.onnx", "vocab.txt", "model_config.json"];

function urlFor(file) {
  return `https://huggingface.co/${REPO}/resolve/${REVISION}/${file}`;
}

async function fileSize(file) {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

async function download(file) {
  const out = path.join(MODEL_DIR, file);
  const doneMarker = `${out}.complete`;
  if (existsSync(out) && existsSync(doneMarker) && await fileSize(out) > 0) {
    console.log(`skip ${file}`);
    return;
  }
  const existingSize = await fileSize(out);
  console.log(existingSize > 0 ? `resume ${file} from ${Math.round(existingSize / 1024 / 1024)} MB` : `download ${file}`);
  await curlDownload(file, out);
  await writeFile(doneMarker, new Date().toISOString());
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
      "--connect-timeout", "30",
      "--continue-at", "-",
      "-o", out,
      urlFor(file),
    ], { stdio: "inherit" });
    p.on("close", (code) => {
      code === 0 ? resolve() : reject(new Error(`curl exit ${code}`));
    });
  });
}

async function writeManifest() {
  const manifest = {
    version: 1,
    engine: "chinese-clip-vit-base-patch16-onnx",
    executionProviders: ["cpu"],
    imageModel: "visual.onnx",
    textModel: "text.onnx",
    vocab: "vocab.txt",
    image: {
      outputName: "image_features",
      size: 224,
      layout: "NCHW",
      crop: "none",
      mean: [0.48145466, 0.4578275, 0.40821073],
      std: [0.26862954, 0.26130258, 0.27577711],
    },
    text: {
      inputIdsName: "input_ids",
      attentionMaskName: "attention_mask",
      tokenTypeIdsName: "token_type_ids",
      outputName: "text_features",
      maxLength: 52,
      clsToken: "[CLS]",
      sepToken: "[SEP]",
      padToken: "[PAD]",
      unkToken: "[UNK]",
    },
    source: {
      repo: REPO,
      revision: REVISION,
      license: "MIT",
      baseModel: "OFA-Sys/chinese-clip-vit-base-patch16",
    },
  };
  await writeFile(path.join(MODEL_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`manifest ${path.join(MODEL_DIR, "manifest.json")}`);
}

await mkdir(MODEL_DIR, { recursive: true });
for (const file of FILES) await download(file);
await writeManifest();
console.log("done");
