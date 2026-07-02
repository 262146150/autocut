// server.mjs — 本地后端：提供 /api/mix + 托管构建产物 dist/ + 输出预览 /_run。
//   开发: 终端1 `node server.mjs`(8787) + 终端2 `pnpm dev`(5173, 自动代理 /api,/_run)
//   预览构建: `pnpm build` 后 `node server.mjs`，直接访问 http://localhost:8787
import http from "node:http";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { runMix, makeTestClips, collectClips, probeDuration, probeVideoSize, hasAudioStream, rm } from "../poc/pipeline.mjs";
import { rewriteCopy, testArkConnection } from "./llm.mjs";
import { synthesizeSpeech } from "./tts.mjs";
import { buildSmartImageIndex, buildSmartMaterialIndex, rankClipsForPrompt, rankImagesForPrompt } from "./smart_match.mjs";
import { buildSegmentLibrary } from "./segmenter.mjs";
import { runHighlightClips } from "./highlight_clip.mjs";
import { audioDuration, normalizeSceneDuration, runImageVideo } from "./image_video.mjs";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dir, "dist");
const RUN = path.resolve(__dir, "_run");
const CACHE = path.resolve(__dir, "_cache");
const EXPORT_ROOTS_FILE = path.join(RUN, "export_roots.json");
const MATERIAL_LIBRARY_FILE = path.join(RUN, "material_library.json");
const MATERIAL_DB_FILE = path.join(RUN, "ecutauto.db");
const DEFAULT_USER_ID = 1;
const AUTH_SERVICE_URL = (process.env.AUTH_SERVICE_URL || "http://localhost:8899").replace(/\/+$/, "");
const TTS_TEST_TEXT = "测试";
const TTS_TEST_SEED_RESOURCE_ID = "seed-tts-2.0";
const TTS_TEST_SEED_SPEAKER = "zh_female_vv_uranus_bigtts";
const TTS_TEST_10029_RESOURCE_ID = "volc.service_type.10029";
const TTS_TEST_10029_SPEAKER = "zh_male_beijingxiaoye_emo_v2_mars_bigtts";
const PORT = Number(process.env.PORT || 8787);

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

function estimateCopyDuration(text) {
  const chars = Array.from(String(text || "").trim()).length;
  return Math.max(6, Math.min(60, chars * 0.22));
}

async function makeUniqueDir(baseDir) {
  let dir = baseDir;
  for (let i = 2; existsSync(dir); i++) {
    dir = `${baseDir}_${pad2(i)}`;
  }
  await mkdir(dir, { recursive: true });
  return dir;
}

function defaultExportRoot() {
  return path.join(RUN, "exports");
}

function uniqPaths(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const abs = path.resolve(String(item || "").trim());
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

async function readExportRoots() {
  const data = await readJsonFile(EXPORT_ROOTS_FILE);
  const custom = Array.isArray(data) ? data : Array.isArray(data?.roots) ? data.roots : [];
  return uniqPaths([defaultExportRoot(), ...custom]);
}

async function saveExportRoots(roots) {
  await mkdir(RUN, { recursive: true });
  const defaultRoot = defaultExportRoot();
  const custom = uniqPaths(roots).filter((item) => item !== defaultRoot);
  await writeFile(EXPORT_ROOTS_FILE, JSON.stringify({ roots: custom }, null, 2));
  return [defaultRoot, ...custom];
}

const MATERIAL_CATEGORY_LABELS = {
  raw: "原始素材",
  segments: "分割片段",
  reuse: "成品复用",
  audio: "音频素材",
  image: "图片素材",
};

function normalizeMaterialCategory(value) {
  const key = String(value || "").trim();
  return MATERIAL_CATEGORY_LABELS[key] ? key : "raw";
}

function isAudioFile(file) {
  return /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(file);
}

function isVideoMaterialFile(file) {
  return /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file);
}

function isImageMaterialFile(file) {
  return /\.(png|jpe?g|webp|bmp|gif|tiff?|avif)$/i.test(file);
}

function isMaterialFile(file) {
  return isVideoMaterialFile(file) || isAudioFile(file) || isImageMaterialFile(file);
}

async function collectImages(input) {
  const info = await stat(input);
  if (info.isFile()) return isImageMaterialFile(input) ? [input] : [];

  const out = [];
  async function walk(current) {
    const ents = await readdir(current, { withFileTypes: true });
    for (const ent of ents) {
      if (ent.name.startsWith(".")) continue;
      const file = path.join(current, ent.name);
      if (ent.isDirectory()) {
        await walk(file);
      } else if (isImageMaterialFile(ent.name)) {
        out.push(file);
      }
    }
  }
  await walk(input);
  return out.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

async function collectMaterialFiles(input) {
  const info = await stat(input);
  if (info.isFile()) return isMaterialFile(input) ? [input] : [];

  const out = [];
  async function walk(current) {
    const ents = await readdir(current, { withFileTypes: true });
    for (const ent of ents) {
      if (ent.name.startsWith(".")) continue;
      const file = path.join(current, ent.name);
      if (ent.isDirectory()) {
        await walk(file);
      } else if (isMaterialFile(ent.name)) {
        out.push(file);
      }
    }
  }
  await walk(input);
  return out.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function normalizeMaterialRoots(data) {
  const raw = Array.isArray(data) ? data : Array.isArray(data?.roots) ? data.roots : [];
  const seen = new Set();
  const roots = [];
  for (const item of raw) {
    const source = typeof item === "string" ? { path: item } : item ?? {};
    const rawPath = String(source.path || "").trim();
    if (!rawPath) continue;
    const abs = path.resolve(rawPath);
    if (seen.has(abs)) continue;
    seen.add(abs);
    roots.push({
      path: abs,
      category: normalizeMaterialCategory(source.category),
      addedAt: source.addedAt || new Date().toISOString(),
    });
  }
  return roots;
}

async function inspectMaterialItem(file, rootPath, category) {
  const info = await stat(file);
  const isVideo = isVideoMaterialFile(file);
  const isImage = isImageMaterialFile(file);
  const durationSec = isImage ? 0 : await probeDuration(file);
  const size = isVideo || isImage ? await probeVideoSize(file) : null;
  const orientation = isVideo || isImage ? classifyVideoSize(size) : "audio";
  const audio = isVideo ? await hasAudioStream(file) : isImage ? false : true;
  return {
    name: path.basename(file),
    path: file,
    url: runFileUrl(file),
    rootPath,
    category,
    categoryLabel: MATERIAL_CATEGORY_LABELS[category],
    kind: isImage ? "image" : isVideo ? "video" : "audio",
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
    durationSec,
    width: size?.width,
    height: size?.height,
    orientation,
    hasAudio: audio,
    valid: true,
  };
}

let materialDb = null;
let materialDbMigrated = false;

function getMaterialDb() {
  if (materialDb) return materialDb;
  mkdirSync(RUN, { recursive: true });
  materialDb = new Database(MATERIAL_DB_FILE);
  materialDb.pragma("journal_mode = WAL");
  materialDb.pragma("foreign_keys = ON");
  materialDb.exec(`
    CREATE TABLE IF NOT EXISTS material_sources (
      path TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      added_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_scanned_at TEXT,
      exists_flag INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS material_items (
      root_path TEXT NOT NULL,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      size INTEGER,
      modified_at TEXT,
      duration_sec REAL,
      width INTEGER,
      height INTEGER,
      orientation TEXT,
      has_audio INTEGER,
      valid INTEGER NOT NULL DEFAULT 1,
      scanned_at TEXT NOT NULL,
      PRIMARY KEY (root_path, path),
      FOREIGN KEY (root_path) REFERENCES material_sources(path) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_material_items_root ON material_items(root_path);
    CREATE INDEX IF NOT EXISTS idx_material_items_kind ON material_items(kind);
    CREATE INDEX IF NOT EXISTS idx_material_items_orientation ON material_items(orientation);
    CREATE TABLE IF NOT EXISTS app_settings (
      user_id INTEGER NOT NULL DEFAULT 1,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      sensitive INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );
    CREATE TABLE IF NOT EXISTS auth_client (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      device_id TEXT NOT NULL,
      token TEXT,
      account TEXT,
      name TEXT,
      remote_user_id INTEGER,
      license_type TEXT,
      license_expires_at TEXT,
      license_status TEXT,
      license_device_id TEXT,
      last_checked_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS generation_tasks (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL DEFAULT 1,
      mode TEXT NOT NULL,
      mode_label TEXT NOT NULL,
      task_name TEXT NOT NULL,
      status TEXT NOT NULL,
      input_path TEXT,
      output_dir TEXT,
      manifest_path TEXT,
      output_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_ms INTEGER,
      settings_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_generation_tasks_started ON generation_tasks(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_generation_tasks_status ON generation_tasks(status);
    CREATE TABLE IF NOT EXISTS client_event_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      module TEXT,
      success INTEGER,
      duration_ms INTEGER,
      error_code TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_client_event_queue_created ON client_event_queue(created_at);
  `);
  for (const sql of [
    "ALTER TABLE auth_client ADD COLUMN license_status TEXT",
    "ALTER TABLE auth_client ADD COLUMN license_device_id TEXT",
  ]) {
    try {
      materialDb.exec(sql);
    } catch {
      // Existing local databases may already have the column.
    }
  }
  return materialDb;
}

function createTaskId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createGenerationTask({ mode, modeLabel, taskName, inputPath = "", settings = {} }) {
  const id = createTaskId();
  const startedAt = new Date().toISOString();
  getMaterialDb().prepare(`
    INSERT INTO generation_tasks (
      id, user_id, mode, mode_label, task_name, status, input_path, started_at, settings_json
    ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)
  `).run(
    id,
    DEFAULT_USER_ID,
    String(mode || "unknown"),
    String(modeLabel || "未知任务"),
    String(taskName || "未命名任务"),
    String(inputPath || ""),
    startedAt,
    JSON.stringify(settings ?? {}),
  );
  return id;
}

function finishGenerationTask(id, { status = "success", outputDir = "", manifestPath = "", outputCount = 0, error = "" } = {}) {
  if (!id) return;
  const db = getMaterialDb();
  const row = db.prepare("SELECT started_at FROM generation_tasks WHERE id = ?").get(id);
  if (!row) return;
  const endedAt = new Date().toISOString();
  const started = Date.parse(row.started_at);
  const ended = Date.parse(endedAt);
  const durationMs = Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : null;
  db.prepare(`
    UPDATE generation_tasks
    SET status = ?, output_dir = ?, manifest_path = ?, output_count = ?, error = ?, ended_at = ?, duration_ms = ?
    WHERE id = ?
  `).run(
    status,
    String(outputDir || ""),
    String(manifestPath || ""),
    Math.max(0, Math.floor(Number(outputCount) || 0)),
    String(error || ""),
    endedAt,
    durationMs,
    id,
  );
}

function listGenerationTasks(limit = 30) {
  const rows = getMaterialDb().prepare(`
    SELECT id, mode, mode_label, task_name, status, input_path, output_dir, manifest_path,
      output_count, error, started_at, ended_at, duration_ms
    FROM generation_tasks
    WHERE user_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(DEFAULT_USER_ID, Math.max(1, Math.min(100, Math.floor(Number(limit) || 30))));
  return rows.map((row) => ({
    id: row.id,
    mode: row.mode,
    modeLabel: row.mode_label,
    taskName: row.task_name,
    status: row.status,
    inputPath: row.input_path || "",
    outputDir: row.output_dir || "",
    manifestPath: row.manifest_path || "",
    outputCount: Number(row.output_count) || 0,
    error: row.error || "",
    startedAt: row.started_at,
    endedAt: row.ended_at || "",
    durationMs: row.duration_ms ?? null,
  }));
}

function localAuthRow() {
  return getMaterialDb().prepare("SELECT * FROM auth_client WHERE id = 1").get();
}

function ensureDeviceId() {
  const row = localAuthRow();
  if (row?.device_id) return row.device_id;
  const nowIso = new Date().toISOString();
  const deviceId = randomUUID();
  getMaterialDb().prepare(`
    INSERT INTO auth_client (id, device_id, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET device_id = excluded.device_id, updated_at = excluded.updated_at
  `).run(deviceId, nowIso);
  return deviceId;
}

function cachedAuthStatus() {
  const row = localAuthRow();
  if (!row?.token) {
    return {
      registered: false,
      active: false,
      expired: false,
      reason: "unauthenticated",
      user: null,
      license: null,
      serviceUrl: AUTH_SERVICE_URL,
    };
  }
  const expiresAt = row.license_expires_at || "";
  const expiresMs = Date.parse(expiresAt);
  const licenseStatus = row.license_status || "";
  const active = licenseStatus === "active" && Number.isFinite(expiresMs) && expiresMs > Date.now();
  const daysRemaining = active ? Math.max(0, Math.ceil((expiresMs - Date.now()) / 86400000)) : 0;
  return {
    registered: true,
    active,
    expired: Boolean(licenseStatus === "expired" || (expiresAt && !active && licenseStatus !== "device_mismatch")),
    reason: active ? "active" : licenseStatus || (expiresAt ? "expired" : "inactive"),
    user: {
      id: row.remote_user_id,
      account: row.account || "",
      name: row.name || "",
    },
    license: {
      type: row.license_type || "",
      expiresAt,
      daysRemaining,
      deviceId: row.license_device_id || "",
    },
    serviceUrl: AUTH_SERVICE_URL,
    lastCheckedAt: row.last_checked_at || "",
  };
}

function saveAuthSession({ token = "", user = null, license = null } = {}) {
  const row = localAuthRow();
  const nowIso = new Date().toISOString();
  const deviceId = row?.device_id || ensureDeviceId();
  const licenseStatus = license?.active
    ? "active"
    : license?.deviceMismatch
      ? "device_mismatch"
      : license?.expired
        ? "expired"
        : "inactive";
  getMaterialDb().prepare(`
    INSERT INTO auth_client (
      id, device_id, token, account, name, remote_user_id,
      license_type, license_expires_at, license_status, license_device_id, last_checked_at, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      device_id = excluded.device_id,
      token = COALESCE(NULLIF(excluded.token, ''), auth_client.token),
      account = excluded.account,
      name = excluded.name,
      remote_user_id = excluded.remote_user_id,
      license_type = excluded.license_type,
      license_expires_at = excluded.license_expires_at,
      license_status = excluded.license_status,
      license_device_id = excluded.license_device_id,
      last_checked_at = excluded.last_checked_at,
      updated_at = excluded.updated_at
  `).run(
    deviceId,
    token,
    user?.account || "",
    user?.name || "",
    user?.id ?? null,
    license?.type || "",
    license?.expiresAt || "",
    licenseStatus,
    license?.deviceId || license?.boundDeviceId || "",
    nowIso,
    nowIso,
  );
  return cachedAuthStatus();
}

function clearAuthSession() {
  const deviceId = ensureDeviceId();
  getMaterialDb().prepare(`
    UPDATE auth_client
    SET token = NULL, account = NULL, name = NULL, remote_user_id = NULL,
      license_type = NULL, license_expires_at = NULL, license_status = NULL,
      license_device_id = NULL, last_checked_at = NULL, updated_at = ?
    WHERE id = 1
  `).run(new Date().toISOString());
  return { ...cachedAuthStatus(), deviceId };
}

async function requireActiveLicense() {
  const status = await refreshRemoteAuthStatus({ allowCache: false });
  if (status.active) return status;
  const msg = status.reason === "device_mismatch"
    ? "当前授权已绑定到其他设备，请使用本机激活码或联系管理员处理"
    : status.expired
      ? "授权已过期，请重新激活后继续使用"
      : "请先登录并激活后继续使用";
  const error = new Error(msg);
  error.statusCode = 403;
  throw error;
}

function errorStatusCode(error, fallback = 500) {
  const code = Number(error?.statusCode);
  return code >= 400 && code < 600 ? code : fallback;
}

async function requestAuthService(endpoint, { method = "GET", token = "", body = null } = {}) {
  const headers = {
    "content-type": "application/json",
    "x-device-id": ensureDeviceId(),
  };
  if (token) headers.authorization = `Bearer ${token}`;
  let resp;
  try {
    resp = await fetch(`${AUTH_SERVICE_URL}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const error = new Error("无法连接授权服务，请确认授权服务已启动或网络可用");
    error.statusCode = 503;
    throw error;
  }
  const text = await resp.text();
  let data = null;
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.trim() };
    }
  }
  if (!resp.ok) {
    const error = new Error(data?.message || data?.error || `授权服务请求失败：HTTP ${resp.status}`);
    error.statusCode = resp.status;
    throw error;
  }
  return data ?? {};
}

async function refreshRemoteAuthStatus({ allowCache = true } = {}) {
  const row = localAuthRow();
  if (!row?.token) return cachedAuthStatus();
  try {
    const data = await requestAuthService("/api/license/status", { token: row.token });
    return saveAuthSession({ token: row.token, user: data.user, license: data.license });
  } catch (error) {
    if (error.statusCode === 401) {
      clearAuthSession();
      return cachedAuthStatus();
    }
    if (!allowCache) throw error;
    return {
      ...cachedAuthStatus(),
      warning: error.message,
      reason: cachedAuthStatus().active ? "cached" : cachedAuthStatus().reason,
    };
  }
}

function sanitizeEventMeta(value, depth = 0) {
  if (depth > 3 || value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeEventMeta(item, depth + 1));
  if (typeof value === "object") {
    const output = {};
    for (const [key, raw] of Object.entries(value)) {
      if (/path|file|dir|url|token|key|secret|code|text|copy|prompt/i.test(key)) continue;
      output[key] = sanitizeEventMeta(raw, depth + 1);
    }
    return output;
  }
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 160)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value).slice(0, 160);
}

function queueClientEvent(event) {
  getMaterialDb().prepare(`
    INSERT INTO client_event_queue (event, module, success, duration_ms, error_code, meta_json, created_at, last_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.event,
    event.module || "",
    typeof event.success === "boolean" ? (event.success ? 1 : 0) : null,
    event.durationMs ?? null,
    event.errorCode || "",
    JSON.stringify(event.meta || {}),
    event.createdAt,
    event.lastError || "",
  );
}

async function sendClientEvents(events) {
  if (!events.length) return { accepted: 0 };
  const row = localAuthRow();
  return await requestAuthService("/api/client/events", {
    method: "POST",
    token: row?.token || "",
    body: { events },
  });
}

async function flushClientEventQueue() {
  const db = getMaterialDb();
  const rows = db.prepare(`
    SELECT * FROM client_event_queue
    WHERE attempts < 5
    ORDER BY id ASC
    LIMIT 30
  `).all();
  if (!rows.length) return;
  const events = rows.map((row) => ({
    event: row.event,
    module: row.module || "",
    success: row.success === null ? null : Boolean(row.success),
    durationMs: row.duration_ms ?? null,
    errorCode: row.error_code || "",
    meta: JSON.parse(row.meta_json || "{}"),
    createdAt: row.created_at,
  }));
  try {
    await sendClientEvents(events);
    db.prepare(`DELETE FROM client_event_queue WHERE id IN (${rows.map(() => "?").join(",")})`)
      .run(...rows.map((row) => row.id));
  } catch (error) {
    const nowError = String(error.message || "send failed").slice(0, 240);
    const update = db.prepare("UPDATE client_event_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?");
    for (const row of rows) update.run(nowError, row.id);
  }
}

async function trackClientEvent(event, {
  module = "",
  success = null,
  durationMs = null,
  errorCode = "",
  meta = {},
} = {}) {
  const payload = {
    event: String(event || "").trim(),
    module: String(module || "").trim(),
    success,
    durationMs: durationMs === null || durationMs === undefined ? null : Math.max(0, Math.floor(Number(durationMs) || 0)),
    errorCode: String(errorCode || "").slice(0, 120),
    meta: sanitizeEventMeta(meta || {}),
    createdAt: new Date().toISOString(),
    appVersion: "mvp",
  };
  if (!payload.event) return;
  try {
    await sendClientEvents([payload]);
    await flushClientEventQueue();
  } catch (error) {
    queueClientEvent({ ...payload, lastError: error.message });
  }
}

async function registerRemoteUser({ account, password, name }) {
  const data = await requestAuthService("/api/register", {
    method: "POST",
    body: { account, password, name },
  });
  return saveAuthSession({ token: data.token, user: data.user, license: data.license });
}

async function loginRemoteUser({ account, password }) {
  const data = await requestAuthService("/api/login", {
    method: "POST",
    body: { account, password },
  });
  return saveAuthSession({ token: data.token, user: data.user, license: data.license });
}

async function activateRemoteLicense(code) {
  const row = localAuthRow();
  if (!row?.token) {
    const error = new Error("请先注册或登录账号");
    error.statusCode = 401;
    throw error;
  }
  const data = await requestAuthService("/api/license/activate", {
    method: "POST",
    token: row.token,
    body: {
      activationCode: code,
      deviceId: ensureDeviceId(),
      deviceName: process.env.COMPUTERNAME || process.env.HOSTNAME || "desktop",
    },
  });
  return saveAuthSession({ token: row.token, user: data.user, license: data.license });
}

function maskSecret(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 8) return `${text.slice(0, 2)}****${text.slice(-2)}`;
  return `${text.slice(0, 4)}****${text.slice(-4)}`;
}

function readAppSetting(key, userId = DEFAULT_USER_ID) {
  const row = getMaterialDb()
    .prepare("SELECT value FROM app_settings WHERE user_id = ? AND key = ?")
    .get(userId, key);
  return String(row?.value || "").trim();
}

function writeAppSetting(key, value, { sensitive = false, userId = DEFAULT_USER_ID } = {}) {
  const db = getMaterialDb();
  const text = String(value || "").trim();
  if (!text) {
    db.prepare("DELETE FROM app_settings WHERE user_id = ? AND key = ?").run(userId, key);
    return;
  }
  db.prepare(`
    INSERT INTO app_settings (user_id, key, value, sensitive, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET
      value = excluded.value,
      sensitive = excluded.sensitive,
      updated_at = excluded.updated_at
  `).run(userId, key, text, sensitive ? 1 : 0, new Date().toISOString());
}

function settingFromDb(key) {
  const dbValue = readAppSetting(key);
  if (dbValue) return { value: dbValue, source: "db" };
  return { value: "", source: "none" };
}

function volcengineSettings() {
  const arkKey = settingFromDb("volc_ark_api_key");
  const arkModel = settingFromDb("volc_ark_model");
  const ttsKey = settingFromDb("volc_tts_api_key");
  const ttsResourceId = settingFromDb("volc_tts_resource_id");
  return {
    userId: DEFAULT_USER_ID,
    ark: {
      apiKey: arkKey.value,
      source: arkKey.source,
      configured: Boolean(arkKey.value),
      masked: maskSecret(arkKey.value),
      model: arkModel.value || "doubao-seed-2-0-mini-260428",
    },
    tts: {
      apiKey: ttsKey.value,
      source: ttsKey.source,
      configured: Boolean(ttsKey.value),
      masked: maskSecret(ttsKey.value),
      resourceId: ttsResourceId.value || "volc.service_type.10029",
    },
  };
}

function publicVolcengineSettings() {
  const settings = volcengineSettings();
  return {
    userId: settings.userId,
    ark: {
      configured: settings.ark.configured,
      masked: settings.ark.masked,
      source: settings.ark.source,
      model: settings.ark.model,
    },
    tts: {
      configured: settings.tts.configured,
      masked: settings.tts.masked,
      source: settings.tts.source,
      resourceId: settings.tts.resourceId,
    },
  };
}

function ttsTestSpeaker(resourceId) {
  const id = String(resourceId || "").trim();
  if (id === TTS_TEST_10029_RESOURCE_ID) return TTS_TEST_10029_SPEAKER;
  return TTS_TEST_SEED_SPEAKER;
}

function ttsTestResourceId(resourceId) {
  return String(resourceId || "").trim() || TTS_TEST_SEED_RESOURCE_ID;
}

function safeErrorMessage(error, secrets = []) {
  let message = String(error?.message || error || "请求失败");
  for (const secret of secrets) {
    const text = String(secret || "").trim();
    if (text) message = message.split(text).join("***");
  }
  return message;
}

function materialSourceRow(row) {
  return {
    path: row.path,
    category: normalizeMaterialCategory(row.category),
    addedAt: row.added_at,
  };
}

function upsertMaterialSourceRow(root) {
  const db = getMaterialDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO material_sources (path, category, added_at, updated_at, exists_flag)
    VALUES (@path, @category, @addedAt, @updatedAt, @existsFlag)
    ON CONFLICT(path) DO UPDATE SET
      category = excluded.category,
      updated_at = excluded.updated_at,
      exists_flag = excluded.exists_flag
  `).run({
    path: root.path,
    category: normalizeMaterialCategory(root.category),
    addedAt: root.addedAt || now,
    updatedAt: now,
    existsFlag: existsSync(root.path) ? 1 : 0,
  });
}

async function scanMaterialRoot(rootPath) {
  const db = getMaterialDb();
  const source = db.prepare("SELECT * FROM material_sources WHERE path = ?").get(rootPath);
  if (!source) throw new Error("素材源不存在");
  const root = materialSourceRow(source);
  const now = new Date().toISOString();
  if (!existsSync(root.path)) {
    db.prepare("UPDATE material_sources SET exists_flag = 0, last_scanned_at = ?, updated_at = ? WHERE path = ?").run(now, now, root.path);
    db.prepare("UPDATE material_items SET valid = 0, scanned_at = ? WHERE root_path = ?").run(now, root.path);
    return;
  }

  const files = await collectMaterialFiles(root.path);
  let next = 0;
  const workerCount = Math.min(8, files.length);
  const items = [];
  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      try {
        items.push(await inspectMaterialItem(file, root.path, root.category));
      } catch {
        items.push({
          name: path.basename(file),
          path: file,
          url: runFileUrl(file),
          rootPath: root.path,
          category: root.category,
          categoryLabel: MATERIAL_CATEGORY_LABELS[root.category],
          kind: isImageMaterialFile(file) ? "image" : isAudioFile(file) ? "audio" : "video",
          valid: false,
        });
      }
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  items.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

  const tx = db.transaction((nextItems) => {
    db.prepare("UPDATE material_sources SET exists_flag = 1, last_scanned_at = ?, updated_at = ? WHERE path = ?").run(now, now, root.path);
    db.prepare("DELETE FROM material_items WHERE root_path = ?").run(root.path);
    const insert = db.prepare(`
      INSERT INTO material_items (
        root_path, path, name, kind, size, modified_at, duration_sec,
        width, height, orientation, has_audio, valid, scanned_at
      ) VALUES (
        @rootPath, @path, @name, @kind, @size, @modifiedAt, @durationSec,
        @width, @height, @orientation, @hasAudio, @valid, @scannedAt
      )
    `);
    for (const item of nextItems) {
      insert.run({
        rootPath: root.path,
        path: item.path,
        name: item.name,
        kind: item.kind,
        size: item.size ?? null,
        modifiedAt: item.modifiedAt ?? null,
        durationSec: item.durationSec ?? null,
        width: item.width ?? null,
        height: item.height ?? null,
        orientation: item.orientation ?? "unknown",
        hasAudio: item.hasAudio === undefined ? null : item.hasAudio ? 1 : 0,
        valid: item.valid ? 1 : 0,
        scannedAt: now,
      });
    }
  });
  tx(items);
}

async function ensureMaterialDbReady() {
  const db = getMaterialDb();
  if (materialDbMigrated) return;
  materialDbMigrated = true;
  const count = db.prepare("SELECT COUNT(*) AS count FROM material_sources").get().count;
  if (count > 0 || !existsSync(MATERIAL_LIBRARY_FILE)) return;
  const roots = normalizeMaterialRoots(await readJsonFile(MATERIAL_LIBRARY_FILE));
  for (const root of roots) upsertMaterialSourceRow(root);
  for (const root of roots) {
    if (existsSync(root.path)) await scanMaterialRoot(root.path);
  }
}

async function addMaterialSource(inputPath, category = "raw", options = {}) {
  await ensureMaterialDbReady();
  const rawPath = String(inputPath || "").trim();
  if (!rawPath) throw new Error("请填写素材路径");
  const target = path.resolve(rawPath);
  if (!existsSync(target)) throw new Error("素材路径不存在");
  const info = await stat(target);
  if (!info.isDirectory() && !isMaterialFile(target)) throw new Error("素材路径必须是文件夹、视频文件或音频文件");
  upsertMaterialSourceRow({
    path: target,
    category: normalizeMaterialCategory(category),
    addedAt: options.addedAt || new Date().toISOString(),
  });
  if (options.scan !== false) await scanMaterialRoot(target);
  return target;
}

async function removeMaterialSource(inputPath) {
  await ensureMaterialDbReady();
  const target = path.resolve(String(inputPath || "").trim());
  const db = getMaterialDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM material_items WHERE root_path = ?").run(target);
    db.prepare("DELETE FROM material_sources WHERE path = ?").run(target);
  });
  tx();
}

async function refreshMaterialSources(inputPath = "") {
  await ensureMaterialDbReady();
  const target = String(inputPath || "").trim() ? path.resolve(String(inputPath).trim()) : "";
  const roots = target
    ? getMaterialDb().prepare("SELECT path FROM material_sources WHERE path = ?").all(target)
    : getMaterialDb().prepare("SELECT path FROM material_sources ORDER BY added_at DESC, path ASC").all();
  if (target && !roots.length) throw new Error("素材源不存在");
  for (const root of roots) await scanMaterialRoot(root.path);
}

async function rememberExportRoot(root) {
  const abs = path.resolve(root);
  const roots = await readExportRoots();
  if (!roots.includes(abs)) await saveExportRoots([...roots, abs]);
}

async function createExportBatch({ outputDir, modeLabel, taskName }) {
  const root = String(outputDir || "").trim()
    ? path.resolve(String(outputDir).trim())
    : defaultExportRoot();
  const ts = timestampParts();
  const dateDir = path.join(root, ts.date);
  const batchName = `${ts.time}_${modeLabel}_${safeFilename(taskName, "未命名任务")}`;
  const batchDir = await makeUniqueDir(path.join(dateDir, batchName));
  await rememberExportRoot(root);
  return { root, dateDir, batchDir };
}

function runFileUrl(file) {
  const abs = path.resolve(file);
  if (abs === RUN || !isInside(RUN, abs)) return `/api/media?path=${encodeURIComponent(abs)}`;
  const rel = path.relative(RUN, abs).split(path.sep).map(encodeURIComponent).join("/");
  return `/_run/${rel}`;
}

function isExportVideo(file) {
  return /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file);
}

async function readJsonFile(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function collectExportVideos(dir) {
  const videos = [];
  async function walk(current) {
    const ents = await readdir(current, { withFileTypes: true });
    for (const ent of ents) {
      if (ent.name.startsWith(".")) continue;
      const file = path.join(current, ent.name);
      if (ent.isDirectory()) {
        await walk(file);
      } else if (isExportVideo(ent.name)) {
        const info = await stat(file);
        videos.push({
          name: ent.name,
          path: file,
          url: runFileUrl(file),
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
        });
      }
    }
  }
  await walk(dir);
  return videos.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

async function readCollectionVideoEntries(dir) {
  const manifestPath = path.join(dir, "collection.json");
  if (!existsSync(manifestPath)) return [];
  const collection = await readJsonFile(manifestPath);
  const clips = Array.isArray(collection?.clips) ? collection.clips : [];
  const entries = [];
  const seen = new Set();
  for (const clip of clips) {
    const clipPath = String(clip?.path || "").trim();
    if (!clipPath || seen.has(clipPath) || !existsSync(clipPath) || !isExportVideo(clipPath)) continue;
    seen.add(clipPath);
    const info = await stat(clipPath);
    entries.push({
      name: clip.title ? `${clip.order || entries.length + 1}. ${clip.title}` : path.basename(clipPath),
      path: clipPath,
      kind: "video",
      videoCount: 1,
      url: runFileUrl(clipPath),
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
    });
  }
  return entries;
}

async function buildExportEntries(dir) {
  const entries = [...await readCollectionVideoEntries(dir)];
  const ents = (await readdir(dir, { withFileTypes: true }))
    .filter((ent) => !ent.name.startsWith(".") && ent.name !== "manifest.json" && ent.name !== "collection.json" && ent.name !== "clips.txt")
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true });
    });
  for (const ent of ents) {
    const file = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const children = await buildExportEntries(file);
      const videoCount = children.reduce((sum, item) => sum + item.videoCount, 0);
      if (!children.length) continue;
      const info = await stat(file);
      entries.push({
        name: ent.name,
        path: file,
        kind: "dir",
        videoCount,
        modifiedAt: info.mtime.toISOString(),
        children,
      });
    } else if (isExportVideo(ent.name)) {
      const info = await stat(file);
      entries.push({
        name: ent.name,
        path: file,
        kind: "video",
        videoCount: 1,
        url: runFileUrl(file),
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      });
    }
  }
  return entries;
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

function splitCopyScenes(text) {
  const parts = String(text || "")
    .split(/[\r\n。！？!?；;]+|(?<=，|,)/u)
    .map((item) => item.replace(/[，,。！？!?；;]+$/u, "").trim())
    .filter(Boolean);
  return parts.length ? parts.slice(0, 40) : [String(text || "").trim()].filter(Boolean);
}

function pickRankedImages(rankedImages, count, allowRepeat) {
  const source = rankedImages.filter(Boolean);
  if (!source.length) return [];
  const targetCount = Math.max(1, Math.floor(Number(count) || 1));
  if (!allowRepeat && source.length < targetCount) {
    throw new Error("图片数量不足：请开启允许重复，或减少单条视频使用图片数");
  }
  const out = source.slice(0, Math.min(targetCount, source.length));
  while (out.length < targetCount) {
    out.push(source[out.length % source.length]);
  }
  return out;
}

function defaultTtsVoice() {
  return {
    speaker: "zh_female_vv_uranus_bigtts",
    resourceId: "seed-tts-2.0",
    name: "Vivi 2.0",
  };
}

async function apiImageVideo(req, res) {
  const {
    inputs,
    canvas = "1080x1920",
    fillMode = "blur",
    fps = 30,
    mode = "copy",
    copyItems = [],
    audioItems = [],
    variants = 1,
    imageCount = 0,
    sceneDurationSec = 3,
    allowImageReuse = true,
    motionMode = "zoomIn",
    transition = "fade",
    subtitleEnabled = true,
    subtitleStyle = null,
    voiceEnabled = true,
    copyVoiceSpeechRate = 0,
    copyVoiceLoudnessRate = 0,
    voice = null,
    voiceVolume = 100,
    bgmEnabled = false,
    bgmPath = "",
    bgmVolume = 30,
    exportQuality = "high",
    smartRerank = false,
    smartRerankTopK = 24,
    outputDir = "",
  } = await readBody(req);
  const [w, h] = String(canvas).split("x").map(Number);
  res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-cache" });
  const send = (o) => res.write(JSON.stringify(o) + "\n");
  let taskId = "";
  const opStartedAt = Date.now();
  let sourceCount = 0;
  try {
    await requireActiveLicense();
    if (!inputs || !existsSync(inputs)) throw new Error("图片素材路径不存在");
    const images = await collectImages(inputs);
    if (!images.length) throw new Error("该路径没有图片素材");
    sourceCount = images.length;
    const validCopyItems = Array.isArray(copyItems)
      ? copyItems.map((item, index) => ({
        id: String(item?.id || `copy-${index + 1}`),
        text: String(item?.text || "").trim(),
      })).filter((item) => item.text)
      : [];
    const validAudioItems = Array.isArray(audioItems)
      ? audioItems.map((item, index) => ({
        id: String(item?.id || `audio-${index + 1}`),
        path: String(item?.path || "").trim(),
        text: String(item?.text || "").trim(),
        name: String(item?.name || "").trim(),
      })).filter((item) => item.path)
      : [];
    const imageMode = mode === "audio" ? "audio" : "copy";
    if (imageMode === "copy" && !validCopyItems.length) throw new Error("请先填写文案");
    if (imageMode === "audio" && !validAudioItems.length) throw new Error("请先添加音频");
    for (const item of validAudioItems) {
      if (!existsSync(item.path)) throw new Error(`音频文件不存在：${item.path}`);
    }
    const variantsPerItem = Math.max(1, Math.floor(Number(variants) || 1));
    const totalOut = (imageMode === "copy" ? validCopyItems.length : validAudioItems.length) * variantsPerItem;
    const taskName = path.basename(inputs);
    taskId = createGenerationTask({
      mode: "image-video",
      modeLabel: "图片转视频",
      taskName,
      inputPath: inputs,
      settings: {
        sourceCount,
        mode: imageMode,
        outputCount: totalOut,
        imageCount,
        canvas,
        fillMode,
        motionMode,
        exportQuality,
      },
    });
    await trackClientEvent("image_video_start", {
      module: "image_video",
      meta: { mode: imageMode, sourceCount, outputCount: totalOut, canvas, fillMode, motionMode, exportQuality },
    });
    const exportBatch = await createExportBatch({ outputDir, modeLabel: "图片转视频", taskName });
    const workRoot = path.join(RUN, "image-video-work", randomUUID());
    const assetRoot = path.join(exportBatch.batchDir, "_assets");
    await mkdir(workRoot, { recursive: true });
    await mkdir(assetRoot, { recursive: true });
    send({ type: "start", total: totalOut, images: sourceCount });
    const imageIndex = await buildSmartImageIndex(images, {
      cacheDir: path.join(CACHE, "smart-image-index"),
      onEvent: send,
    });
    send({
      type: "image_index",
      available: Boolean(imageIndex.onnx?.available),
      reused: Boolean(imageIndex.reused),
      indexedImages: imageIndex.images.length,
      reason: imageIndex.onnx?.reason || "",
    });
    const arkSettings = volcengineSettings().ark;
    const outputs = [];
    const manifest = {
      version: 1,
      mode: "image-video",
      modeLabel: "图片转视频",
      createdAt: new Date().toISOString(),
      source: {
        inputDir: inputs,
        imageCount: images.length,
        smartIndex: {
          path: imageIndex.path,
          reused: imageIndex.reused,
          indexedImages: imageIndex.images.length,
          onnx: imageIndex.onnx ?? null,
        },
      },
      settings: { canvas, fillMode, fps, mode: imageMode, imageCount, sceneDurationSec, motionMode, transition, subtitleEnabled, voiceEnabled, bgmEnabled, exportQuality },
      groups: [],
    };
    const items = imageMode === "copy" ? validCopyItems : validAudioItems;
    let outputBase = 0;
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      const itemText = imageMode === "copy" ? item.text : item.text || item.name || path.basename(item.path);
      const scenes = splitCopyScenes(itemText);
      const promptText = scenes.join(" ");
      const groupName = `${imageMode === "copy" ? "文案" : "音频"}${pad2(itemIndex + 1)}_${safeFilename(itemText || item.name, imageMode === "copy" ? "文案" : "音频", 18)}`;
      const groupDir = path.join(exportBatch.batchDir, groupName);
      const assetDir = path.join(assetRoot, groupName);
      await mkdir(groupDir, { recursive: true });
      await mkdir(assetDir, { recursive: true });
      let audioPath = imageMode === "audio" ? item.path : "";
      let duration = imageMode === "audio" ? await audioDuration(item.path) : estimateCopyDuration(item.text);
      let tts = null;
      if (imageMode === "copy" && voiceEnabled !== false) {
        const selectedVoice = {
          ...defaultTtsVoice(),
          ...(voice ?? {}),
        };
        const ttsSettings = volcengineSettings().tts;
        const ttsFile = path.join(assetDir, "voice.mp3");
        send({ type: "log", msg: `正在生成第 ${itemIndex + 1} 条配音` });
        tts = await synthesizeSpeech({
          text: item.text,
          speaker: selectedVoice.speaker,
          resourceId: selectedVoice.resourceId || ttsSettings.resourceId,
          apiKey: ttsSettings.apiKey,
          format: "mp3",
          sampleRate: 24000,
          speechRate: copyVoiceSpeechRate,
          loudnessRate: copyVoiceLoudnessRate,
          outputPath: ttsFile,
        });
        audioPath = tts.path;
        duration = await probeDuration(tts.path);
      }
      if (!duration) duration = Math.max(4, scenes.length * normalizeSceneDuration(sceneDurationSec));
      const match = await rankImagesForPrompt(images, promptText, {
        index: imageIndex,
        llm: smartRerank ? { apiKey: arkSettings.apiKey, model: arkSettings.model } : null,
        rerankTopK: smartRerankTopK,
        onEvent: send,
      });
      const perVideoImages = Math.max(
        scenes.length,
        Math.floor(Number(imageCount) || Math.ceil(duration / normalizeSceneDuration(sceneDurationSec))),
        1,
      );
      const pickedImages = pickRankedImages(match.images, perVideoImages, allowImageReuse);
      send({
        type: "image_match",
        index: itemIndex + 1,
        matches: match.matches,
      });
      const itemOutputs = [];
      for (let variant = 0; variant < variantsPerItem; variant++) {
        const orderedImages = pickedImages.slice(variant).concat(pickedImages.slice(0, variant));
        const outputName = `成片_${pad2(variant + 1)}.mp4`;
        const output = path.join(groupDir, outputName);
        const finalSubtitle = subtitleEnabled && itemText
          ? copySubtitlePayload(itemText, duration, subtitleStyle)
          : null;
        await runImageVideo({
          images: orderedImages,
          output,
          workDir: path.join(workRoot, `${itemIndex}_${variant}`),
          w,
          h,
          fps,
          durationSec: duration,
          sceneDurationSec: normalizeSceneDuration(sceneDurationSec),
          fillMode,
          motionMode,
          transition,
          finalSubtitle,
          audioPath,
          bgmEnabled,
          bgmPath,
          bgmVolume,
          voiceVolume,
          exportQuality,
          onEvent: (event) => send({ ...event, output: outputBase + variant + 1, total: totalOut }),
        });
        itemOutputs.push(output);
        outputs.push(output);
        send({ type: "output_done", output: outputBase + variant + 1, total: totalOut, path: output });
      }
      manifest.groups.push({
        type: imageMode,
        index: itemIndex + 1,
        name: groupName,
        dir: groupDir,
        text: itemText,
        audio: audioPath ? { path: audioPath, durationSec: duration, tts: Boolean(tts) } : null,
        smartMatch: match,
        images: pickedImages.map((image) => ({ path: image, name: path.basename(image), url: runFileUrl(image) })),
        outputs: itemOutputs.map((file) => ({ file: path.basename(file), path: file, url: runFileUrl(file) })),
      });
      outputBase += variantsPerItem;
    }
    const manifestPath = path.join(exportBatch.batchDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    finishGenerationTask(taskId, {
      outputDir: exportBatch.batchDir,
      manifestPath,
      outputCount: outputs.length,
    });
    await trackClientEvent("image_video_success", {
      module: "image_video",
      success: true,
      durationMs: Date.now() - opStartedAt,
      meta: { mode: imageMode, sourceCount, outputCount: outputs.length, canvas, fillMode, motionMode, exportQuality },
    });
    send({ type: "done", outputs: outputs.map(runFileUrl), exportDir: exportBatch.batchDir, manifest: manifestPath });
  } catch (e) {
    finishGenerationTask(taskId, { status: "failed", error: safeErrorMessage(e, [volcengineSettings().ark.apiKey, volcengineSettings().tts.apiKey]) });
    await trackClientEvent("image_video_fail", {
      module: "image_video",
      success: false,
      durationMs: Date.now() - opStartedAt,
      errorCode: e.statusCode ? `http_${e.statusCode}` : "image_video_error",
      meta: { sourceCount },
    });
    send({ type: "error", msg: safeErrorMessage(e, [volcengineSettings().ark.apiKey, volcengineSettings().tts.apiKey]) });
  }
  res.end();
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
    copyVoiceEnabled = true,
    copyVoiceSpeechRate = 0,
    copyVoiceLoudnessRate = 0,
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
    fixedLastEnabled = false,
    fixedLastPath = "",
    fixedLastStartSec = 0,
    fixedLastEndSec = 0,
    smartMix = false,
    smartMaterialMode = "segments",
    smartRerank = false,
    smartRerankTopK = 24,
    exportQuality = "high",
    groupOutputs = true,
    outputDir = "",
  } = await readBody(req);
  const [w, h] = canvas.split("x").map(Number);
  res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-cache" });
  const send = (o) => res.write(JSON.stringify(o) + "\n");
  let taskId = "";
  const opStartedAt = Date.now();
  let telemetryMode = "unknown";
  let telemetrySourceCount = 0;
  try {
    await requireActiveLicense();
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
    const voiceEnabled = copyMode && copyVoiceEnabled !== false;
    const speaker = voiceEnabled ? String(copyVoice?.speaker || "").trim() : "";
    const resourceId = copyMode ? String(copyVoice?.resourceId || "").trim() : "";
    if (voiceEnabled && !speaker) throw new Error("请选择语音合成音色");
    for (let audioIndex = 0; audioMode && audioIndex < validAudioItems.length; audioIndex++) {
      if (!existsSync(validAudioItems[audioIndex].path)) {
        throw new Error(`音频文件不存在：${validAudioItems[audioIndex].path}`);
      }
    }
    const arkSettings = smartMix && smartRerank ? volcengineSettings().ark : null;
    if (smartMix && smartRerank && !arkSettings?.apiKey) {
      throw new Error("深度匹配需要先在系统设置中配置火山 ARK API Key");
    }
    const mode = smartMix ? "smart" : copyMode ? "copy" : audioMode ? "audio" : "custom";
    const modeLabel = smartMix ? "AI智能混剪" : copyMode ? "文案模式" : audioMode ? "音频模式" : "自定义模式";
    telemetryMode = mode;
    telemetrySourceCount = sourceClips.length;
    const taskName = inputs && existsSync(inputs) ? path.basename(inputs) : "测试素材";
    taskId = createGenerationTask({
      mode,
      modeLabel,
      taskName,
      inputPath: inputs && existsSync(inputs) ? inputs : "",
      settings: {
        canvas,
        fillMode,
        fps,
        totalOut,
        materialCount: sourceClips.length,
        smartMix,
        smartMaterialMode: smartMix ? smartMaterialMode : null,
        exportQuality,
        smartRerank: smartMix ? Boolean(smartRerank) : false,
      },
    });
    await trackClientEvent("mix_start", {
      module: smartMix ? "smart_mix" : "video_mix",
      meta: {
        mode,
        sourceCount: sourceClips.length,
        outputCount: totalOut,
        canvas,
        exportQuality,
        smartRerank: Boolean(smartMix && smartRerank),
      },
    });
    const shouldSegmentSmartMaterials = smartMix && smartMaterialMode === "raw";
    const segmentLibrary = shouldSegmentSmartMaterials
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
    } else if (smartMix) {
      send({
        type: "log",
        msg: "AI素材类型：已分割片段，跳过智能分割，直接建立匹配索引",
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
    const exportBatch = await createExportBatch({ outputDir, modeLabel, taskName });
    const manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      mode,
      modeLabel,
      source: {
        inputDir: inputs && existsSync(inputs) ? inputs : null,
        materialCount: sourceClips.length,
        smartMaterialMode: smartMix ? smartMaterialMode : null,
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
        copyVoiceEnabled,
        copyVoiceSpeechRate,
        copyVoiceLoudnessRate,
        audioVariants,
        subtitleMode,
        subtitleStyle,
        copySubtitleEnabled,
        copySubtitleStyle,
        audioSubtitleEnabled,
        audioSubtitleStyle,
        textOverlays,
        videoProcessing,
        exportQuality,
        fixedFirstEnabled,
        fixedFirstPath,
        fixedFirstStartSec,
        fixedFirstEndSec,
        fixedLastEnabled,
        fixedLastPath,
        fixedLastStartSec,
        fixedLastEndSec,
        smartMix,
        smartMaterialMode: smartMix ? smartMaterialMode : null,
        smartRerank: smartMix ? Boolean(smartRerank) : false,
        smartRerankTopK: smartMix ? Math.max(6, Math.min(40, Math.floor(Number(smartRerankTopK) || 24))) : null,
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
        let tts = null;
        let duration = estimateCopyDuration(item.text);
        if (voiceEnabled) {
          send({ type: "log", msg: `合成文案 ${copyIndex + 1}/${validCopyItems.length} 语音…` });
          const ttsFile = path.join(assetDir, "voice.mp3");
          tts = await synthesizeSpeech({
            text: item.text,
            speaker,
            resourceId,
            format: "mp3",
            sampleRate: 24000,
            speechRate: copyVoiceSpeechRate,
            loudnessRate: copyVoiceLoudnessRate,
            outputPath: ttsFile,
          });
          duration = await probeDuration(tts.path);
          if (!duration) throw new Error(`文案 ${copyIndex + 1} 语音时长读取失败`);
        } else {
          send({ type: "log", msg: `文案 ${copyIndex + 1} 未启用语音合成，按 ${duration.toFixed(1)} 秒生成…` });
        }
        const smartMatch = smartMix ? await rankClipsForPrompt(clips, item.text, {
          index: smartIndex,
          llm: smartRerank ? { apiKey: arkSettings.apiKey, model: arkSettings.model } : null,
          rerankTopK: smartRerankTopK,
          onEvent: send,
        }) : null;
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
        send({ type: "log", msg: `文案 ${copyIndex + 1} ${voiceEnabled ? "语音" : "估算"} ${duration.toFixed(1)} 秒，开始混剪…` });
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
          exportQuality,
          targetDurationSec: duration,
          voiceoverPath: tts?.path || "",
          voiceVolume,
          fixedFirstEnabled,
          fixedFirstPath,
          fixedFirstStartSec,
          fixedFirstEndSec,
          fixedLastEnabled,
          fixedLastPath,
          fixedLastStartSec,
          fixedLastEndSec,
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
          voice: voiceEnabled && tts ? {
            path: tts.path,
            durationSec: duration,
            speaker,
            resourceId,
            name: copyVoice?.name || "",
            speechRate: copyVoiceSpeechRate,
            loudnessRate: copyVoiceLoudnessRate,
          } : null,
          smartMatch,
          outputs: results.map((p) => ({ file: path.basename(p), path: p, url: runFileUrl(p) })),
        });
        outputBase += variantsPerCopy;
      }
      const manifestPath = path.join(exportBatch.batchDir, "manifest.json");
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      finishGenerationTask(taskId, {
        outputDir: exportBatch.batchDir,
        manifestPath,
        outputCount: outputs.length,
      });
      await trackClientEvent("mix_success", {
        module: smartMix ? "smart_mix" : "video_mix",
        success: true,
        durationMs: Date.now() - opStartedAt,
        meta: { mode, sourceCount: telemetrySourceCount, outputCount: outputs.length, canvas, exportQuality },
      });
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
        const smartMatch = smartMix ? await rankClipsForPrompt(clips, matchPrompt, {
          index: smartIndex,
          llm: smartRerank ? { apiKey: arkSettings.apiKey, model: arkSettings.model } : null,
          rerankTopK: smartRerankTopK,
          onEvent: send,
        }) : null;
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
          exportQuality,
          targetDurationSec: duration,
          voiceoverPath: item.path,
          voiceVolume,
          fixedFirstEnabled,
          fixedFirstPath,
          fixedFirstStartSec,
          fixedFirstEndSec,
          fixedLastEnabled,
          fixedLastPath,
          fixedLastStartSec,
          fixedLastEndSec,
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
      finishGenerationTask(taskId, {
        outputDir: exportBatch.batchDir,
        manifestPath,
        outputCount: outputs.length,
      });
      await trackClientEvent("mix_success", {
        module: smartMix ? "smart_mix" : "video_mix",
        success: true,
        durationMs: Date.now() - opStartedAt,
        meta: { mode, sourceCount: telemetrySourceCount, outputCount: outputs.length, canvas, exportQuality },
      });
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
      exportQuality,
      fixedFirstEnabled,
      fixedFirstPath,
      fixedFirstStartSec,
      fixedFirstEndSec,
      fixedLastEnabled,
      fixedLastPath,
      fixedLastStartSec,
      fixedLastEndSec,
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
    finishGenerationTask(taskId, {
      outputDir: exportBatch.batchDir,
      manifestPath,
      outputCount: results.length,
    });
    await trackClientEvent("mix_success", {
      module: smartMix ? "smart_mix" : "video_mix",
      success: true,
      durationMs: Date.now() - opStartedAt,
      meta: { mode, sourceCount: telemetrySourceCount, outputCount: results.length, canvas, exportQuality },
    });
    send({ type: "done", outputs: results.map(runFileUrl), exportDir: exportBatch.batchDir, manifest: manifestPath });
  } catch (e) {
    finishGenerationTask(taskId, { status: "failed", error: e.message });
    await trackClientEvent("mix_fail", {
      module: smartMix ? "smart_mix" : "video_mix",
      success: false,
      durationMs: Date.now() - opStartedAt,
      errorCode: e.statusCode ? `http_${e.statusCode}` : "mix_error",
      meta: { mode: telemetryMode, sourceCount: telemetrySourceCount },
    });
    send({ type: "error", msg: e.message });
  }
  res.end();
}

function classifyVideoSize(size) {
  if (!size) return "unknown";
  if (size.width > size.height) return "landscape";
  if (size.height > size.width) return "portrait";
  return "square";
}

async function inspectMaterialOrientation(clips) {
  const orientation = {
    portrait: 0,
    landscape: 0,
    square: 0,
    unknown: 0,
    resolved: "9:16",
  };
  const metaByPath = new Map();
  let next = 0;
  const workerCount = Math.min(6, clips.length);
  async function worker() {
    while (next < clips.length) {
      const clip = clips[next++];
      const size = await probeVideoSize(clip);
      const kind = classifyVideoSize(size);
      orientation[kind] += 1;
      metaByPath.set(clip, { width: size?.width, height: size?.height, orientation: kind });
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  orientation.resolved = orientation.landscape > orientation.portrait ? "16:9" : "9:16";
  return { orientation, metaByPath };
}

async function apiMaterials(req, res) {
  const { inputs } = await readBody(req);
  const opStartedAt = Date.now();
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
  try {
    await requireActiveLicense();
    if (!inputs || !existsSync(inputs)) {
      throw new Error("素材路径不存在");
    }
    const clips = await collectClips(inputs);
    if (!clips.length) throw new Error("该素材路径没有视频素材");
    const { orientation, metaByPath } = await inspectMaterialOrientation(clips);
    await trackClientEvent("material_import_success", {
      module: "materials",
      success: true,
      durationMs: Date.now() - opStartedAt,
      meta: {
        count: clips.length,
        resolvedOrientation: orientation.resolved,
        portrait: orientation.portrait,
        landscape: orientation.landscape,
        square: orientation.square,
      },
    });
    res.end(JSON.stringify({
      valid: true,
      path: inputs,
      name: path.basename(inputs),
      count: clips.length,
      orientation,
      clips: clips.map((clip) => ({
        name: path.basename(clip),
        path: clip,
        url: `/api/media?path=${encodeURIComponent(clip)}`,
        width: metaByPath.get(clip)?.width,
        height: metaByPath.get(clip)?.height,
        orientation: metaByPath.get(clip)?.orientation,
      })),
    }));
  } catch (e) {
    await trackClientEvent("material_import_fail", {
      module: "materials",
      success: false,
      durationMs: Date.now() - opStartedAt,
      errorCode: e.statusCode ? `http_${e.statusCode}` : "material_import_error",
    });
    res.end(JSON.stringify({ valid: false, msg: e.message }));
  }
}

async function inspectImageMaterials(inputs) {
  if (!inputs || !existsSync(inputs)) throw new Error("图片素材路径不存在");
  const images = await collectImages(inputs);
  if (!images.length) throw new Error("该路径没有图片素材");
  const items = [];
  let next = 0;
  const workerCount = Math.min(8, images.length);
  async function worker() {
    while (next < images.length) {
      const image = images[next++];
      const size = await probeVideoSize(image);
      items.push({
        name: path.basename(image),
        path: image,
        url: runFileUrl(image),
        width: size?.width,
        height: size?.height,
        orientation: classifyVideoSize(size),
      });
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  items.sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));
  return {
    valid: true,
    path: inputs,
    name: path.basename(inputs),
    count: items.length,
    images: items,
  };
}

async function apiImageMaterials(req, res) {
  const { inputs } = await readBody(req);
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
  try {
    const payload = await inspectImageMaterials(inputs);
    res.end(JSON.stringify(payload));
  } catch (e) {
    res.end(JSON.stringify({ valid: false, msg: e.message, path: inputs || "", name: "", count: 0, images: [] }));
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
    segmentMode = "material",
    speechPadSec = 0.2,
    speechMaxShiftSec = 1.5,
    force = false,
    outputDir = "",
  } = await readBody(req);
  res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-cache" });
  const send = (o) => res.write(JSON.stringify(o) + "\n");
  let taskId = "";
  const opStartedAt = Date.now();
  let sourceCount = 0;
  try {
    await requireActiveLicense();
    if (!inputs || !existsSync(inputs)) throw new Error("素材路径不存在");
    const clips = await collectClips(inputs);
    if (!clips.length) throw new Error("该素材路径没有视频素材");
    sourceCount = clips.length;
    taskId = createGenerationTask({
      mode: "segment",
      modeLabel: "智能分割",
      taskName: path.basename(inputs),
      inputPath: inputs,
      settings: {
        sourceCount: clips.length,
        threshold,
        minDurationSec,
        targetSegmentSec,
        maxSegmentSec,
        segmentMode,
      },
    });
    await trackClientEvent("segment_start", {
      module: "smart_segment",
      meta: { sourceCount, segmentMode, targetSegmentSec, maxSegmentSec, speechProtection: Boolean(speechProtection) },
    });
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
      segmentMode,
      speechPadSec,
      speechMaxShiftSec,
      force,
      onEvent: send,
    });
    await addMaterialSource(exportBatch.batchDir, "segments");
    finishGenerationTask(taskId, {
      outputDir: exportBatch.batchDir,
      manifestPath: library.path,
      outputCount: library.segments.length,
    });
    await trackClientEvent("segment_success", {
      module: "smart_segment",
      success: true,
      durationMs: Date.now() - opStartedAt,
      meta: { sourceCount, outputCount: library.segments.length, segmentMode },
    });
    send({
      type: "done",
      engine: library.engine,
      targetEngine: library.targetEngine,
      reused: Boolean(library.reused),
      manifest: library.path,
      exportDir: exportBatch.batchDir,
      materialLibraryPath: exportBatch.batchDir,
      segments: library.segments.map((segment) => ({
        ...segment,
        url: `/api/media?path=${encodeURIComponent(segment.path)}`,
      })),
    });
  } catch (e) {
    finishGenerationTask(taskId, { status: "failed", error: e.message });
    await trackClientEvent("segment_fail", {
      module: "smart_segment",
      success: false,
      durationMs: Date.now() - opStartedAt,
      errorCode: e.statusCode ? `http_${e.statusCode}` : "segment_error",
      meta: { sourceCount, segmentMode },
    });
    send({ type: "error", msg: e.message });
  }
  res.end();
}

async function apiHighlightClips(req, res) {
  const {
    inputs,
    srtPath = "",
    minDurationSec = 60,
    maxDurationSec = 360,
    minScore = 0.65,
    maxClips = 8,
    maxCollections = 2,
    enableAsr = true,
    addToLibrary = true,
    exportQuality = "high",
    outputDir = "",
  } = await readBody(req);
  res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-cache" });
  const send = (o) => res.write(JSON.stringify(o) + "\n");
  let taskId = "";
  const opStartedAt = Date.now();
  let sourceCount = 0;
  try {
    await requireActiveLicense();
    if (!inputs || !existsSync(inputs)) throw new Error("视频路径不存在");
    const clips = await collectClips(inputs);
    if (!clips.length) throw new Error("该路径没有可处理的视频");
    sourceCount = clips.length;
    const settings = volcengineSettings();
    if (!settings.ark.apiKey) throw new Error("未配置火山 ARK API Key，请先在系统设置中填写");
    taskId = createGenerationTask({
      mode: "highlight",
      modeLabel: "高光切片",
      taskName: path.basename(inputs),
      inputPath: inputs,
      settings: {
        sourceCount: clips.length,
        minDurationSec,
        maxDurationSec,
        minScore,
        maxClips,
        maxCollections,
        enableAsr,
        exportQuality,
      },
    });
    const exportBatch = await createExportBatch({
      outputDir,
      modeLabel: "高光切片",
      taskName: path.basename(inputs),
    });
    await trackClientEvent("highlight_start", {
      module: "highlight_clip",
      meta: { sourceCount, minDurationSec, maxDurationSec, minScore, maxClips, maxCollections, enableAsr: Boolean(enableAsr) },
    });
    const result = await runHighlightClips(clips, {
      outputDir: exportBatch.batchDir,
      srtPath,
      minDurationSec,
      maxDurationSec,
      minScore,
      maxClips,
      maxCollections,
      enableAsr,
      exportQuality,
      workDir: path.join(RUN, "highlight-work"),
      asrCacheDir: path.join(CACHE, "asr"),
      llm: {
        apiKey: settings.ark.apiKey,
        model: settings.ark.model,
      },
      onEvent: (event) => {
        if (event.type === "log") {
          send({ type: "log", msg: event.msg });
          return;
        }
        send(event);
      },
    });
    if (addToLibrary && result.clips.length) {
      await addMaterialSource(path.join(exportBatch.batchDir, "clips"), "segments");
    }
    finishGenerationTask(taskId, {
      outputDir: exportBatch.batchDir,
      manifestPath: result.manifestPath,
      outputCount: result.clips.length,
    });
    await trackClientEvent("highlight_success", {
      module: "highlight_clip",
      success: true,
      durationMs: Date.now() - opStartedAt,
      meta: { sourceCount, clipCount: result.clips.length, collectionCount: result.collections.length, exportQuality },
    });
    send({
      type: "done",
      exportDir: exportBatch.batchDir,
      manifest: result.manifestPath,
      materialLibraryPath: addToLibrary && result.clips.length ? path.join(exportBatch.batchDir, "clips") : "",
      clips: result.clips.map((clip) => ({
        ...clip,
        url: runFileUrl(clip.path),
      })),
      collections: result.collections.map((collection) => ({
        ...collection,
      })),
    });
  } catch (e) {
    finishGenerationTask(taskId, { status: "failed", error: safeErrorMessage(e, [volcengineSettings().ark.apiKey]) });
    await trackClientEvent("highlight_fail", {
      module: "highlight_clip",
      success: false,
      durationMs: Date.now() - opStartedAt,
      errorCode: e.statusCode ? `http_${e.statusCode}` : "highlight_error",
      meta: { sourceCount },
    });
    send({ type: "error", msg: safeErrorMessage(e, [volcengineSettings().ark.apiKey]) });
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

async function apiExports(req, res) {
  const roots = await readExportRoots();
  const dates = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dateNames = (await readdir(root, { withFileTypes: true }))
      .filter((ent) => ent.isDirectory())
      .map((ent) => ent.name)
      .sort((a, b) => b.localeCompare(a));
    for (const date of dateNames) {
      const dateDir = path.join(root, date);
      const batchDirs = (await readdir(dateDir, { withFileTypes: true }))
        .filter((ent) => ent.isDirectory())
        .map((ent) => path.join(dateDir, ent.name));
      const batches = [];
      for (const dir of batchDirs) {
        const info = await stat(dir);
        const manifestPath = path.join(dir, "manifest.json");
        const manifest = existsSync(manifestPath) ? await readJsonFile(manifestPath) : null;
        const videos = await collectExportVideos(dir);
        const entries = await buildExportEntries(dir);
        if (!videos.length && !entries.length && !manifest) continue;
        batches.push({
          name: path.basename(dir),
          dir,
          createdAt: manifest?.createdAt || info.birthtime.toISOString(),
          modifiedAt: info.mtime.toISOString(),
          mode: manifest?.mode || "",
          modeLabel: manifest?.modeLabel || "未知模式",
          manifest: existsSync(manifestPath) ? manifestPath : "",
          videoCount: videos.length,
          videos,
          entries,
        });
      }
      batches.sort((a, b) => b.name.localeCompare(a.name));
      if (batches.length) {
        dates.push({
          date,
          dir: dateDir,
          root,
          rootName: path.basename(root) || root,
          count: batches.reduce((sum, item) => sum + item.videoCount, 0),
          batches,
        });
      }
    }
  }
  dates.sort((a, b) => b.date.localeCompare(a.date) || b.root.localeCompare(a.root));
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
  res.end(JSON.stringify({ root: defaultExportRoot(), roots, dates }));
}

async function apiGenerationTasks(req, res) {
  const url = new URL(req.url, "http://x");
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 30));
  const tasks = listGenerationTasks(limit);
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
  res.end(JSON.stringify({
    tasks,
    totals: {
      count: tasks.length,
      running: tasks.filter((task) => task.status === "running").length,
      failed: tasks.filter((task) => task.status === "failed").length,
    },
  }));
}

async function apiAuthStatus(req, res) {
  const status = await refreshRemoteAuthStatus();
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
  res.end(JSON.stringify(status));
}

async function apiAuthRegister(req, res) {
  const opStartedAt = Date.now();
  try {
    const { account, password, name } = await readBody(req);
    const status = await registerRemoteUser({ account, password, name });
    await trackClientEvent("auth_register_success", {
      module: "auth",
      success: true,
      durationMs: Date.now() - opStartedAt,
      meta: { active: Boolean(status.active), reason: status.reason },
    });
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(JSON.stringify({ status }));
  } catch (e) {
    await trackClientEvent("auth_register_fail", {
      module: "auth",
      success: false,
      durationMs: Date.now() - opStartedAt,
      errorCode: e.statusCode ? `http_${e.statusCode}` : "auth_register_error",
    });
    res.writeHead(errorStatusCode(e, 400), { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(JSON.stringify({ ok: false, message: e.message }));
  }
}

async function apiAuthLogin(req, res) {
  const opStartedAt = Date.now();
  try {
    const { account, password } = await readBody(req);
    const status = await loginRemoteUser({ account, password });
    await trackClientEvent("auth_login_success", {
      module: "auth",
      success: true,
      durationMs: Date.now() - opStartedAt,
      meta: { active: Boolean(status.active), reason: status.reason },
    });
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(JSON.stringify({ status }));
  } catch (e) {
    await trackClientEvent("auth_login_fail", {
      module: "auth",
      success: false,
      durationMs: Date.now() - opStartedAt,
      errorCode: e.statusCode ? `http_${e.statusCode}` : "auth_login_error",
    });
    res.writeHead(errorStatusCode(e, 400), { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(JSON.stringify({ ok: false, message: e.message }));
  }
}

async function apiAuthActivate(req, res) {
  const opStartedAt = Date.now();
  try {
    const { code } = await readBody(req);
    const status = await activateRemoteLicense(code);
    await trackClientEvent("auth_activate_success", {
      module: "auth",
      success: true,
      durationMs: Date.now() - opStartedAt,
      meta: { active: Boolean(status.active), reason: status.reason, licenseType: status.license?.type || "" },
    });
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(JSON.stringify(status));
  } catch (e) {
    await trackClientEvent("auth_activate_fail", {
      module: "auth",
      success: false,
      durationMs: Date.now() - opStartedAt,
      errorCode: e.statusCode ? `http_${e.statusCode}` : "auth_activate_error",
    });
    res.writeHead(errorStatusCode(e, 400), { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(JSON.stringify({ ok: false, message: e.message }));
  }
}

async function apiAuthLogout(req, res) {
  try {
    const status = clearAuthSession();
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(JSON.stringify(status));
  } catch (e) {
    res.writeHead(errorStatusCode(e, 400), { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(JSON.stringify({ ok: false, message: e.message }));
  }
}

async function apiExportRoots(req, res) {
  try {
    const { path: inputPath, remove = false } = await readBody(req);
    const rawPath = String(inputPath || "").trim();
    if (!rawPath) throw new Error("请填写导出目录路径");
    const target = path.resolve(rawPath);
    if (target === defaultExportRoot() && remove) throw new Error("默认导出目录不能移除");
    let roots = await readExportRoots();
    if (remove) {
      roots = roots.filter((item) => item !== target);
    } else {
      if (!existsSync(target) || !(await stat(target)).isDirectory()) throw new Error("导出目录不存在");
      roots = [...roots, target];
    }
    roots = await saveExportRoots(roots);
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(JSON.stringify({ roots }));
  } catch (e) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end(e.message);
  }
}

async function materialLibraryPayload() {
  await ensureMaterialDbReady();
  const db = getMaterialDb();
  const sourceRows = db.prepare("SELECT * FROM material_sources ORDER BY added_at DESC, path ASC").all();
  const itemRows = db.prepare("SELECT * FROM material_items WHERE valid = 1 ORDER BY name ASC, path ASC").all();
  const itemsByRoot = new Map();
  for (const row of itemRows) {
    if (!itemsByRoot.has(row.root_path)) itemsByRoot.set(row.root_path, []);
    itemsByRoot.get(row.root_path).push(row);
  }
  const roots = sourceRows.map((row) => {
    const exists = existsSync(row.path);
    if (Boolean(row.exists_flag) !== exists) {
      db.prepare("UPDATE material_sources SET exists_flag = ?, updated_at = ? WHERE path = ?")
        .run(exists ? 1 : 0, new Date().toISOString(), row.path);
    }
    const category = normalizeMaterialCategory(row.category);
    const rootItems = exists ? (itemsByRoot.get(row.path) ?? []).map((item) => ({
      name: item.name,
      path: item.path,
      url: runFileUrl(item.path),
      rootPath: item.root_path,
      category,
      categoryLabel: MATERIAL_CATEGORY_LABELS[category],
      kind: item.kind,
      size: item.size ?? undefined,
      modifiedAt: item.modified_at ?? undefined,
      durationSec: item.duration_sec ?? undefined,
      width: item.width ?? undefined,
      height: item.height ?? undefined,
      orientation: item.orientation ?? "unknown",
      hasAudio: item.has_audio === null ? undefined : Boolean(item.has_audio),
      valid: Boolean(item.valid),
    })) : [];
    return {
      path: row.path,
      category,
      addedAt: row.added_at,
      name: path.basename(row.path) || row.path,
      categoryLabel: MATERIAL_CATEGORY_LABELS[category],
      exists,
      count: rootItems.length,
      videoCount: rootItems.filter((item) => item.kind === "video").length,
      audioCount: rootItems.filter((item) => item.kind === "audio").length,
      imageCount: rootItems.filter((item) => item.kind === "image").length,
      durationSec: rootItems.reduce((sum, item) => sum + (Number(item.durationSec) || 0), 0),
      lastScannedAt: row.last_scanned_at ?? "",
      items: rootItems,
    };
  });
  const items = roots.flatMap((root) => root.items);
  return {
    roots,
    items,
    totals: {
      roots: roots.length,
      validRoots: roots.filter((root) => root.exists).length,
      items: items.length,
      videos: items.filter((item) => item.kind === "video").length,
      audios: items.filter((item) => item.kind === "audio").length,
      images: items.filter((item) => item.kind === "image").length,
      durationSec: items.reduce((sum, item) => sum + (Number(item.durationSec) || 0), 0),
    },
  };
}

async function apiMaterialLibrary(req, res) {
  try {
    if (req.method === "POST") {
      const { path: inputPath = "", category = "raw", remove = false, refresh = false } = await readBody(req);
      const rawPath = String(inputPath || "").trim();
      if (remove) {
        if (!rawPath) throw new Error("请填写素材路径");
        await removeMaterialSource(rawPath);
      } else if (refresh) {
        await refreshMaterialSources(rawPath);
      } else {
        if (!rawPath) throw new Error("请填写素材路径");
        await addMaterialSource(rawPath, category);
      }
    }
    const payload = await materialLibraryPayload();
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(JSON.stringify(payload));
  } catch (e) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end(e.message);
  }
}

async function apiRewriteCopy(req, res) {
  const opStartedAt = Date.now();
  try {
    await requireActiveLicense();
    const { text } = await readBody(req);
    const settings = volcengineSettings();
    const rewritten = await rewriteCopy(text, { apiKey: settings.ark.apiKey, model: settings.ark.model });
    await trackClientEvent("rewrite_success", {
      module: "copywriting",
      success: true,
      durationMs: Date.now() - opStartedAt,
      meta: { inputLength: String(text || "").length, outputLength: String(rewritten || "").length },
    });
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(JSON.stringify({ text: rewritten }));
  } catch (e) {
    await trackClientEvent("rewrite_fail", {
      module: "copywriting",
      success: false,
      durationMs: Date.now() - opStartedAt,
      errorCode: e.statusCode ? `http_${e.statusCode}` : "rewrite_error",
    });
    res.writeHead(errorStatusCode(e), { "content-type": "text/plain; charset=utf-8" });
    res.end(e.message);
  }
}

async function apiTts(req, res) {
  const opStartedAt = Date.now();
  try {
    await requireActiveLicense();
    const { text, speaker, resourceId, format = "mp3", sampleRate = 24000, speechRate = 0, loudnessRate = 0 } = await readBody(req);
    const settings = volcengineSettings();
    const requestedFormat = String(format || "mp3").toLowerCase();
    const ext = ["mp3", "wav", "ogg", "aac"].includes(requestedFormat) ? requestedFormat : "mp3";
    const file = path.join(RUN, "tts", `tts_${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`);
    const result = await synthesizeSpeech({
      text,
      speaker,
      resourceId: resourceId || settings.tts.resourceId,
      apiKey: settings.tts.apiKey,
      format: ext,
      sampleRate,
      speechRate,
      loudnessRate,
      outputPath: file,
    });
    await trackClientEvent("tts_success", {
      module: "tts",
      success: true,
      durationMs: Date.now() - opStartedAt,
      meta: { textLength: String(text || "").length, format: ext, sampleRate, speechRate, loudnessRate, bytes: result.bytes || 0 },
    });
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(JSON.stringify({
      ...result,
      url: `/api/media?path=${encodeURIComponent(result.path)}`,
    }));
  } catch (e) {
    await trackClientEvent("tts_fail", {
      module: "tts",
      success: false,
      durationMs: Date.now() - opStartedAt,
      errorCode: e.statusCode ? `http_${e.statusCode}` : "tts_error",
    });
    res.writeHead(errorStatusCode(e), { "content-type": "text/plain; charset=utf-8" });
    res.end(e.message);
  }
}

async function apiVolcengineSettings(req, res) {
  try {
    if (req.method === "POST") {
      const {
        arkApiKey,
        arkModel,
        ttsApiKey,
        ttsResourceId,
        clearArkApiKey = false,
        clearTtsApiKey = false,
      } = await readBody(req);
      if (clearArkApiKey) writeAppSetting("volc_ark_api_key", "", { sensitive: true });
      else if (String(arkApiKey || "").trim()) writeAppSetting("volc_ark_api_key", arkApiKey, { sensitive: true });
      if (clearTtsApiKey) writeAppSetting("volc_tts_api_key", "", { sensitive: true });
      else if (String(ttsApiKey || "").trim()) writeAppSetting("volc_tts_api_key", ttsApiKey, { sensitive: true });
      writeAppSetting("volc_ark_model", arkModel || "doubao-seed-2-0-mini-260428");
      writeAppSetting("volc_tts_resource_id", ttsResourceId || "volc.service_type.10029");
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(JSON.stringify(publicVolcengineSettings()));
  } catch (e) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end(e.message);
  }
}

async function apiVolcengineSettingsTest(req, res) {
  const secrets = [];
  try {
    const {
      target,
    } = await readBody(req);
    const settings = volcengineSettings();
    const kind = String(target || "").trim();
    if (kind === "ark") {
      const apiKey = settings.ark.apiKey;
      secrets.push(apiKey);
      const result = await testArkConnection({
        apiKey,
        model: settings.ark.model,
      });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
      res.end(JSON.stringify({
        target: "ark",
        ok: true,
        message: "AI 改写测试成功",
        text: result.text,
        usage: result.usage,
      }));
      return;
    }
    if (kind === "tts") {
      const apiKey = settings.tts.apiKey;
      const resourceId = ttsTestResourceId(settings.tts.resourceId);
      const speaker = ttsTestSpeaker(resourceId);
      secrets.push(apiKey);
      const file = path.join(RUN, "tts", `tts_test_${Date.now()}_${Math.random().toString(16).slice(2)}.mp3`);
      const result = await synthesizeSpeech({
        text: TTS_TEST_TEXT,
        speaker,
        resourceId,
        apiKey,
        format: "mp3",
        sampleRate: 24000,
        outputPath: file,
      });
      await unlink(file).catch(() => {});
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
      res.end(JSON.stringify({
        target: "tts",
        ok: true,
        message: "语音合成测试成功",
        bytes: result.bytes,
      }));
      return;
    }
    throw new Error("未知测试类型");
  } catch (e) {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(JSON.stringify({
      ok: false,
      message: safeErrorMessage(e, secrets),
    }));
  }
}

http
  .createServer(async (req, res) => {
    try {
      if ((req.method === "GET" || req.method === "HEAD") && req.url.startsWith("/api/media")) return await apiMedia(req, res);
      if (req.method === "GET" && req.url === "/api/auth/status") return await apiAuthStatus(req, res);
      if (req.method === "POST" && req.url === "/api/auth/register") return await apiAuthRegister(req, res);
      if (req.method === "POST" && req.url === "/api/auth/login") return await apiAuthLogin(req, res);
      if (req.method === "POST" && req.url === "/api/auth/activate") return await apiAuthActivate(req, res);
      if (req.method === "POST" && req.url === "/api/auth/logout") return await apiAuthLogout(req, res);
      if (req.method === "GET" && req.url.startsWith("/api/exports")) return await apiExports(req, res);
      if (req.method === "GET" && req.url.startsWith("/api/tasks")) return await apiGenerationTasks(req, res);
      if (req.method === "POST" && req.url === "/api/export-roots") return await apiExportRoots(req, res);
      if (req.method === "GET" && req.url.startsWith("/api/material-library")) return await apiMaterialLibrary(req, res);
      if (req.method === "POST" && req.url === "/api/material-library") return await apiMaterialLibrary(req, res);
      if (req.method === "POST" && req.url === "/api/materials") return await apiMaterials(req, res);
      if (req.method === "POST" && req.url === "/api/image-materials") return await apiImageMaterials(req, res);
      if (req.method === "POST" && req.url === "/api/segments") return await apiSegments(req, res);
      if (req.method === "POST" && req.url === "/api/highlight-clips") return await apiHighlightClips(req, res);
      if (req.method === "POST" && req.url === "/api/image-video") return await apiImageVideo(req, res);
      if (req.method === "POST" && req.url === "/api/mix") return await apiMix(req, res);
      if (req.method === "POST" && req.url === "/api/rewrite-copy") return await apiRewriteCopy(req, res);
      if (req.method === "POST" && req.url === "/api/tts") return await apiTts(req, res);
      if (req.method === "GET" && req.url === "/api/settings/volcengine") return await apiVolcengineSettings(req, res);
      if (req.method === "POST" && req.url === "/api/settings/volcengine") return await apiVolcengineSettings(req, res);
      if (req.method === "POST" && req.url === "/api/settings/volcengine/test") return await apiVolcengineSettingsTest(req, res);
      if (req.url.startsWith("/api/")) {
        res.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
        res.end(JSON.stringify({ ok: false, message: `接口不存在：${req.method} ${req.url}` }));
        return;
      }
      return await serveStatic(req, res);
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  })
  .listen(PORT, () => {
    console.log(`ECutAuto-Clone 后端 ▶  http://localhost:${PORT}  (dist ${existsSync(DIST) ? "已构建" : "未构建"})`);
    void trackClientEvent("app_open", {
      module: "app",
      meta: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    });
  });
