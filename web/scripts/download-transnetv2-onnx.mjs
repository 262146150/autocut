import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dir, "..");
const MODEL_DIR = path.join(WEB_ROOT, "models", "transnetv2");
const PACKAGE_NAME = process.env.ECUT_TRANSNETV2_PACKAGE || "@azstorm/lightcut-transnetv2@1.0.0";
const EXPECTED_SHA256 = "c4d54a682bace32f25136ef83ca2c9d403e8f8193775efeb995172a0d95a8e0c";

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: options.stdio || "pipe", cwd: options.cwd });
    let out = "";
    let err = "";
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (err += d));
    p.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`${cmd} exit ${code}\n${err || out}`));
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

async function ensurePackage(tmpDir) {
  const output = await run("npm", ["pack", PACKAGE_NAME, "--pack-destination", tmpDir], { stdio: "pipe" });
  const file = output.split(/\r?\n/).filter(Boolean).pop();
  if (!file) throw new Error("npm pack 未返回 tarball");
  return path.join(tmpDir, file);
}

async function extractPackage(tarball, tmpDir) {
  const outDir = path.join(tmpDir, "pkg");
  await mkdir(outDir, { recursive: true });
  await run("tar", ["-xzf", tarball, "-C", outDir]);
  return path.join(outDir, "package", "dist");
}

async function combineChunks(distDir, manifest) {
  const chunks = [];
  for (const file of manifest.files) {
    const chunk = await readFile(path.join(distDir, file));
    const expected = manifest.sizes?.[file];
    if (expected && chunk.length !== expected) {
      throw new Error(`${file} size mismatch: ${chunk.length} != ${expected}`);
    }
    chunks.push(chunk);
  }
  const model = Buffer.concat(chunks);
  const out = path.join(MODEL_DIR, "transnetv2.onnx");
  await writeFile(out, model);
  const actualSha = await sha256(out);
  const expectedSha = manifest.sha256 || EXPECTED_SHA256;
  if (expectedSha && actualSha !== expectedSha) {
    throw new Error(`sha256 mismatch: ${actualSha} != ${expectedSha}`);
  }
  return { out, sha256: actualSha };
}

async function writeManifest(modelSha) {
  const manifest = {
    version: 1,
    engine: "transnetv2-onnx",
    executionProviders: ["cpu"],
    model: "transnetv2.onnx",
    inputName: "input",
    singleOutputName: "534",
    manyHotOutputName: "535",
    threshold: 0.5,
    detectFps: 12,
    input: {
      shape: [1, 100, 27, 48, 3],
      dtype: "float32",
      color: "rgb",
      frameSize: [48, 27],
    },
    source: {
      package: PACKAGE_NAME,
      license: "MIT",
      sha256: modelSha,
      paper: "TransNet V2: An effective deep network architecture for fast shot transition detection",
    },
  };
  await writeFile(path.join(MODEL_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
}

await mkdir(MODEL_DIR, { recursive: true });
const existing = path.join(MODEL_DIR, "transnetv2.onnx");
const existingManifest = path.join(MODEL_DIR, "manifest.json");
if (existsSync(existing) && existsSync(existingManifest)) {
  console.log(`skip ${existing}`);
  process.exit(0);
}

const tmpDir = path.join(os.tmpdir(), `ecutauto-transnetv2-${Date.now()}`);
await mkdir(tmpDir, { recursive: true });
try {
  const tarball = await ensurePackage(tmpDir);
  const distDir = await extractPackage(tarball, tmpDir);
  const chunkManifest = JSON.parse(await readFile(path.join(distDir, "manifest.json"), "utf8"));
  const result = await combineChunks(distDir, chunkManifest);
  await writeManifest(result.sha256);
  await writeFile(path.join(MODEL_DIR, "transnetv2.onnx.complete"), new Date().toISOString());
  console.log(`model ${result.out}`);
  console.log(`sha256 ${result.sha256}`);
  console.log(`manifest ${path.join(MODEL_DIR, "manifest.json")}`);
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}
