import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCipheriv, createDecipheriv, createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import mysql from "mysql2/promise";

loadEnvFile();

const PORT = Number(process.env.AUTH_PORT || 8899);
const TOKEN_TTL_DAYS = Number(process.env.AUTH_TOKEN_TTL_DAYS || 30);
const JWT_SECRET = process.env.AUTH_JWT_SECRET || "dev-only-change-me";
const CODE_SECRET = process.env.AUTH_CODE_SECRET || JWT_SECRET;
const ADMIN_TOKEN = process.env.AUTH_ADMIN_TOKEN || "";
const DB_PREFIX = sanitizePrefix(process.env.DB_PREFIX || "r_");
const __dir = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_DIST = path.join(__dir, "admin-dist");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_DATABASE || "autocut",
  user: process.env.DB_USERNAME || "root",
  password: process.env.DB_PASSWORD || "",
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 8),
  charset: "utf8mb4",
  timezone: "Z",
});

const tables = {
  users: `${DB_PREFIX}users`,
  codes: `${DB_PREFIX}activation_codes`,
  licenses: `${DB_PREFIX}user_licenses`,
  logs: `${DB_PREFIX}audit_logs`,
  events: `${DB_PREFIX}client_events`,
};

function loadEnvFile(file = ".env") {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!key || process.env[key]) continue;
    process.env[key] = rest.join("=").replace(/^['"]|['"]$/g, "");
  }
}

function sanitizePrefix(value) {
  const cleaned = String(value || "").replace(/[^a-zA-Z0-9_]/g, "");
  return cleaned || "r_";
}

function json(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-cache",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization, x-admin-token, x-device-id",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(data));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "cache-control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  res.end(readFileSync(file));
}

function serveAdmin(req, res) {
  if (!existsSync(ADMIN_DIST)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<h2>后台未构建</h2><p>请先在 auth-service 目录运行 <code>pnpm admin:build</code>，开发期可运行 <code>pnpm admin:dev</code>。</p>");
    return;
  }
  const url = new URL(req.url, "http://localhost");
  const rel = decodeURIComponent(url.pathname.replace(/^\/admin\/?/, "")) || "index.html";
  const target = path.resolve(ADMIN_DIST, rel);
  const safe = target.startsWith(ADMIN_DIST) && existsSync(target) ? target : path.join(ADMIN_DIST, "index.html");
  serveFile(res, safe);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("请求 JSON 格式错误"));
      }
    });
  });
}

function normalizeAccount(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCode(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function addDays(date, days) {
  return new Date(date.getTime() + Math.max(1, Math.floor(Number(days) || 1)) * 86400000);
}

function toSqlDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function toIso(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    account: row.account,
    name: row.name || "",
  };
}

function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = passwordHash(password, salt);
  const actual = Buffer.from(hash, "hex");
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload) {
  return createHmac("sha256", JWT_SECRET).update(payload).digest("base64url");
}

function createToken(userId) {
  const payload = b64url(JSON.stringify({
    sub: Number(userId),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(addDays(new Date(), TOKEN_TTL_DAYS).getTime() / 1000),
  }));
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  const [payloadRaw, sig] = String(token || "").split(".");
  if (!payloadRaw || !sig || sign(payloadRaw) !== sig) {
    const error = new Error("登录状态无效，请重新登录");
    error.statusCode = 401;
    throw error;
  }
  const payload = JSON.parse(Buffer.from(payloadRaw, "base64url").toString("utf8"));
  if (!payload.sub || Number(payload.exp) * 1000 <= Date.now()) {
    const error = new Error("登录已过期，请重新登录");
    error.statusCode = 401;
    throw error;
  }
  return Number(payload.sub);
}

function bearerToken(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
}

function requireAdmin(req) {
  if (!ADMIN_TOKEN || req.headers["x-admin-token"] !== ADMIN_TOKEN) {
    const error = new Error("无管理员权限");
    error.statusCode = 401;
    throw error;
  }
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}

async function writeAudit(req, {
  actorType = "system",
  actorId = null,
  actorLabel = "",
  action,
  targetType = "",
  targetId = "",
  detail = {},
} = {}) {
  if (!action) return;
  try {
    await pool.query(
      `INSERT INTO \`${tables.logs}\` (
        actor_type, actor_id, actor_label, action, target_type, target_id,
        ip, user_agent, detail_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actorType,
        actorId,
        actorLabel,
        action,
        targetType,
        String(targetId || ""),
        clientIp(req),
        String(req.headers["user-agent"] || "").slice(0, 255),
        JSON.stringify(detail || {}),
        toSqlDate(new Date()),
      ],
    );
  } catch {
    // Audit logging must not block the business operation.
  }
}

function codeHash(code) {
  return createHmac("sha256", JWT_SECRET).update(normalizeCode(code)).digest("hex");
}

function codeCryptoKey() {
  return createHash("sha256").update(CODE_SECRET).digest();
}

function encryptCode(code) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", codeCryptoKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(code), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptCode(value) {
  try {
    const [version, ivRaw, tagRaw, encryptedRaw] = String(value || "").split(":");
    if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) return "";
    const decipher = createDecipheriv("aes-256-gcm", codeCryptoKey(), Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

function formatCode(raw) {
  const normalized = normalizeCode(raw);
  const chunks = [];
  for (let i = 0; i < normalized.length; i += 4) chunks.push(normalized.slice(i, i + 4));
  return chunks.join("-");
}

function generateActivationCode(type) {
  const prefix = type === "official" ? "ECF" : "ECT";
  return formatCode(`${prefix}${randomBytes(10).toString("hex")}`);
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`${tables.users}\` (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      account VARCHAR(190) NOT NULL,
      password_hash VARCHAR(128) NOT NULL,
      password_salt VARCHAR(64) NOT NULL,
      name VARCHAR(120) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      last_login_at DATETIME NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_account (account)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`${tables.codes}\` (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      code_hash CHAR(64) NOT NULL,
      code_cipher TEXT NULL,
      code_preview VARCHAR(40) NOT NULL,
      license_type VARCHAR(20) NOT NULL,
      duration_days INT NOT NULL,
      code_expires_at DATETIME NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'available',
      assigned_user_id BIGINT UNSIGNED NULL,
      issued_to VARCHAR(190) NULL,
      issued_at DATETIME NULL,
      activated_user_id BIGINT UNSIGNED NULL,
      activated_device_id VARCHAR(120) NULL,
      activated_at DATETIME NULL,
      created_by VARCHAR(120) NULL,
      note VARCHAR(255) NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_code_hash (code_hash),
      KEY idx_status (status),
      KEY idx_assigned_user (assigned_user_id),
      KEY idx_activated_user (activated_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  for (const sql of [
    `ALTER TABLE \`${tables.codes}\` ADD COLUMN code_cipher TEXT NULL AFTER code_hash`,
    `ALTER TABLE \`${tables.codes}\` ADD COLUMN issued_to VARCHAR(190) NULL AFTER assigned_user_id`,
    `ALTER TABLE \`${tables.codes}\` ADD COLUMN issued_at DATETIME NULL AFTER issued_to`,
  ]) {
    try {
      await pool.query(sql);
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
  await pool.query(`UPDATE \`${tables.codes}\` SET status = 'issued', issued_at = COALESCE(issued_at, updated_at) WHERE status = 'unused' AND assigned_user_id IS NOT NULL`);
  await pool.query(`UPDATE \`${tables.codes}\` SET status = 'available' WHERE status = 'unused'`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`${tables.licenses}\` (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      activation_code_id BIGINT UNSIGNED NOT NULL,
      license_type VARCHAR(20) NOT NULL,
      device_id VARCHAR(120) NULL,
      device_name VARCHAR(120) NULL,
      starts_at DATETIME NOT NULL,
      expires_at DATETIME NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_activation_code (activation_code_id),
      KEY idx_user_status (user_id, status),
      KEY idx_expires_at (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`${tables.logs}\` (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      actor_type VARCHAR(30) NOT NULL,
      actor_id BIGINT UNSIGNED NULL,
      actor_label VARCHAR(190) NULL,
      action VARCHAR(80) NOT NULL,
      target_type VARCHAR(80) NULL,
      target_id VARCHAR(80) NULL,
      ip VARCHAR(80) NULL,
      user_agent VARCHAR(255) NULL,
      detail_json JSON NULL,
      created_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      KEY idx_action_time (action, created_at),
      KEY idx_actor_time (actor_type, actor_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`${tables.events}\` (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NULL,
      device_id VARCHAR(120) NULL,
      event VARCHAR(80) NOT NULL,
      module VARCHAR(80) NULL,
      success TINYINT NULL,
      duration_ms INT NULL,
      error_code VARCHAR(120) NULL,
      app_version VARCHAR(40) NULL,
      meta_json JSON NULL,
      created_at DATETIME NOT NULL,
      received_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      KEY idx_event_time (event, created_at),
      KEY idx_module_time (module, created_at),
      KEY idx_user_time (user_id, created_at),
      KEY idx_device_time (device_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function currentLicense(userId, deviceId = "") {
  const normalizedDeviceId = String(deviceId || "").trim();
  if (normalizedDeviceId) {
    const [deviceRows] = await pool.query(
      `SELECT * FROM \`${tables.licenses}\`
       WHERE user_id = ? AND status = 'active' AND device_id = ?
       ORDER BY expires_at DESC, id DESC
       LIMIT 1`,
      [userId, normalizedDeviceId],
    );
    if (deviceRows[0]) return licensePayload(deviceRows[0]);
  }
  const [rows] = await pool.query(
    `SELECT * FROM \`${tables.licenses}\`
     WHERE user_id = ? AND status = 'active'
     ORDER BY expires_at DESC, id DESC
     LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  const payload = licensePayload(row);
  if (normalizedDeviceId && row.device_id && row.device_id !== normalizedDeviceId) {
    return {
      ...payload,
      active: false,
      expired: false,
      deviceMismatch: true,
      boundDeviceId: row.device_id,
    };
  }
  return payload;
}

function licensePayload(row) {
  const expiresMs = new Date(row.expires_at).getTime();
  const active = Number.isFinite(expiresMs) && expiresMs > Date.now();
  return {
    id: Number(row.id),
    type: row.license_type,
    active,
    expired: !active,
    deviceId: row.device_id || "",
    expiresAt: toIso(row.expires_at),
    daysRemaining: active ? Math.max(0, Math.ceil((expiresMs - Date.now()) / 86400000)) : 0,
  };
}

async function authPayload(userId, { deviceId = "" } = {}) {
  const [users] = await pool.query(`SELECT * FROM \`${tables.users}\` WHERE id = ? LIMIT 1`, [userId]);
  const user = users[0];
  if (!user || user.status !== "active") {
    const error = new Error("账号不可用");
    error.statusCode = 401;
    throw error;
  }
  const license = await currentLicense(user.id, deviceId);
  return {
    registered: true,
    active: Boolean(license?.active),
    expired: Boolean(license?.expired),
    reason: license?.active ? "active" : license?.deviceMismatch ? "device_mismatch" : license?.expired ? "expired" : "inactive",
    user: publicUser(user),
    license,
  };
}

async function handleRegister(req, res) {
  const { account, password, name = "" } = await readBody(req);
  const normalized = normalizeAccount(account);
  if (!normalized) throw Object.assign(new Error("请填写账号"), { statusCode: 400 });
  if (String(password || "").length < 6) throw Object.assign(new Error("密码至少 6 位"), { statusCode: 400 });
  const now = toSqlDate(new Date());
  const { salt, hash } = passwordHash(password);
  try {
    const [result] = await pool.query(
      `INSERT INTO \`${tables.users}\` (account, password_hash, password_salt, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [normalized, hash, salt, String(name || "").trim(), now, now],
    );
    await writeAudit(req, {
      actorType: "user",
      actorId: result.insertId,
      actorLabel: normalized,
      action: "user.register",
      targetType: "user",
      targetId: result.insertId,
      detail: { account: normalized },
    });
    const token = createToken(result.insertId);
    json(res, 200, { token, ...(await authPayload(result.insertId, { deviceId: req.headers["x-device-id"] })) });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") throw Object.assign(new Error("账号已存在，请直接登录"), { statusCode: 409 });
    throw error;
  }
}

async function handleLogin(req, res) {
  const { account, password } = await readBody(req);
  const normalized = normalizeAccount(account);
  const [rows] = await pool.query(`SELECT * FROM \`${tables.users}\` WHERE account = ? LIMIT 1`, [normalized]);
  const user = rows[0];
  if (!user || !verifyPassword(password || "", user.password_salt, user.password_hash)) {
    throw Object.assign(new Error("账号或密码错误"), { statusCode: 401 });
  }
  if (user.status !== "active") throw Object.assign(new Error("账号已停用"), { statusCode: 403 });
  await pool.query(`UPDATE \`${tables.users}\` SET last_login_at = ?, updated_at = ? WHERE id = ?`, [
    toSqlDate(new Date()),
    toSqlDate(new Date()),
    user.id,
  ]);
  await writeAudit(req, {
    actorType: "user",
    actorId: user.id,
    actorLabel: user.account,
    action: "user.login",
    targetType: "user",
    targetId: user.id,
  });
  const token = createToken(user.id);
  json(res, 200, { token, ...(await authPayload(user.id, { deviceId: req.headers["x-device-id"] })) });
}

async function handleStatus(req, res) {
  const userId = verifyToken(bearerToken(req));
  const deviceId = String(req.headers["x-device-id"] || "").trim();
  if (!deviceId) throw Object.assign(new Error("缺少设备 ID"), { statusCode: 400 });
  json(res, 200, await authPayload(userId, { deviceId }));
}

async function handleActivate(req, res) {
  const userId = verifyToken(bearerToken(req));
  const { activationCode, deviceId = req.headers["x-device-id"] || "", deviceName = "" } = await readBody(req);
  const normalizedDeviceId = String(deviceId || "").trim();
  if (!normalizedDeviceId) throw Object.assign(new Error("缺少设备 ID"), { statusCode: 400 });
  const normalized = normalizeCode(activationCode);
  if (!normalized) throw Object.assign(new Error("请填写激活码"), { statusCode: 400 });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [codes] = await conn.query(
      `SELECT * FROM \`${tables.codes}\` WHERE code_hash = ? LIMIT 1 FOR UPDATE`,
      [codeHash(normalized)],
    );
    const code = codes[0];
    if (!code) throw Object.assign(new Error("激活码无效"), { statusCode: 404 });
    if (!["available", "issued"].includes(code.status)) throw Object.assign(new Error("激活码已使用或已失效"), { statusCode: 409 });
    if (code.assigned_user_id && Number(code.assigned_user_id) !== userId) {
      throw Object.assign(new Error("激活码不属于当前账号"), { statusCode: 403 });
    }
    const codeExpiresMs = code.code_expires_at ? new Date(code.code_expires_at).getTime() : 0;
    if (codeExpiresMs && codeExpiresMs <= Date.now()) {
      throw Object.assign(new Error("激活码已过期"), { statusCode: 410 });
    }
    const now = new Date();
    const expiresAt = addDays(now, code.duration_days);
    await conn.query(
      `UPDATE \`${tables.codes}\`
       SET status = 'used', activated_user_id = ?, activated_device_id = ?, activated_at = ?, updated_at = ?
       WHERE id = ?`,
      [userId, normalizedDeviceId, toSqlDate(now), toSqlDate(now), code.id],
    );
    await conn.query(
      `INSERT INTO \`${tables.licenses}\` (
        user_id, activation_code_id, license_type, device_id, device_name,
        starts_at, expires_at, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        userId,
        code.id,
        code.license_type,
        normalizedDeviceId,
        String(deviceName || "").slice(0, 120),
        toSqlDate(now),
        toSqlDate(expiresAt),
        toSqlDate(now),
        toSqlDate(now),
      ],
    );
    await conn.commit();
    await writeAudit(req, {
      actorType: "user",
      actorId: userId,
      actorLabel: "",
      action: "license.activate",
      targetType: "activation_code",
      targetId: code.id,
      detail: {
        licenseType: code.license_type,
        deviceId: normalizedDeviceId,
        durationDays: code.duration_days,
      },
    });
    json(res, 200, await authPayload(userId, { deviceId: normalizedDeviceId }));
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

function optionalUserId(req) {
  const token = bearerToken(req);
  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
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

function normalizeEventItem(item) {
  const event = String(item?.event || "").trim().slice(0, 80);
  if (!event) return null;
  const createdAt = item?.createdAt ? new Date(item.createdAt) : new Date();
  return {
    event,
    module: String(item?.module || "").trim().slice(0, 80),
    success: typeof item?.success === "boolean" ? (item.success ? 1 : 0) : null,
    durationMs: item?.durationMs === null || item?.durationMs === undefined ? null : Math.max(0, Math.floor(Number(item.durationMs) || 0)),
    errorCode: String(item?.errorCode || "").trim().slice(0, 120),
    appVersion: String(item?.appVersion || "").trim().slice(0, 40),
    meta: sanitizeEventMeta(item?.meta && typeof item.meta === "object" ? item.meta : {}),
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
  };
}

async function handleClientEvents(req, res) {
  const userId = optionalUserId(req);
  const deviceId = String(req.headers["x-device-id"] || "").trim().slice(0, 120);
  const body = await readBody(req);
  const rawEvents = Array.isArray(body.events) ? body.events : [body];
  const events = rawEvents.map(normalizeEventItem).filter(Boolean).slice(0, 50);
  if (!events.length) throw Object.assign(new Error("没有可记录的事件"), { statusCode: 400 });
  const receivedAt = toSqlDate(new Date());
  for (const item of events) {
    await pool.query(
      `INSERT INTO \`${tables.events}\` (
        user_id, device_id, event, module, success, duration_ms,
        error_code, app_version, meta_json, created_at, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        deviceId || null,
        item.event,
        item.module || null,
        item.success,
        item.durationMs,
        item.errorCode || null,
        item.appVersion || null,
        JSON.stringify(item.meta || {}),
        toSqlDate(item.createdAt),
        receivedAt,
      ],
    );
  }
  json(res, 200, { ok: true, accepted: events.length });
}

async function handleCreateCodes(req, res) {
  requireAdmin(req);
  const {
    type = "trial",
    durationDays = type === "official" ? 365 : 7,
    count = 1,
    codeExpiresAt = null,
    assignedAccount = "",
    issuedTo = "",
    status = assignedAccount || issuedTo ? "issued" : "available",
    note = "",
  } = await readBody(req);
  const licenseType = type === "official" ? "official" : "trial";
  const total = Math.min(100, Math.max(1, Math.floor(Number(count) || 1)));
  const initialStatus = status === "issued" ? "issued" : "available";
  let assignedUserId = null;
  if (assignedAccount) {
    const [users] = await pool.query(`SELECT id FROM \`${tables.users}\` WHERE account = ? LIMIT 1`, [
      normalizeAccount(assignedAccount),
    ]);
    if (!users[0]) throw Object.assign(new Error("指定账号不存在"), { statusCode: 404 });
    assignedUserId = users[0].id;
  }
  const now = toSqlDate(new Date());
  const codes = [];
  for (let i = 0; i < total; i += 1) {
    const code = generateActivationCode(licenseType);
    const preview = `${code.slice(0, 8)}…${code.slice(-4)}`;
    await pool.query(
      `INSERT INTO \`${tables.codes}\` (
        code_hash, code_cipher, code_preview, license_type, duration_days, code_expires_at,
        status, assigned_user_id, issued_to, issued_at, created_by, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        codeHash(code),
        encryptCode(code),
        preview,
        licenseType,
        Math.max(1, Math.floor(Number(durationDays) || 1)),
        codeExpiresAt ? toSqlDate(codeExpiresAt) : null,
        initialStatus,
        assignedUserId,
        String(issuedTo || assignedAccount || "").trim() || null,
        initialStatus === "issued" ? now : null,
        "admin",
        String(note || "").slice(0, 255),
        now,
        now,
      ],
    );
    codes.push({
      code,
      type: licenseType,
      durationDays: Math.max(1, Math.floor(Number(durationDays) || 1)),
      status: initialStatus,
      issuedTo: String(issuedTo || assignedAccount || "").trim(),
    });
  }
  await writeAudit(req, {
    actorType: "admin",
    actorLabel: "admin",
    action: "admin.codes.create",
    targetType: "activation_code",
    detail: {
      type: licenseType,
      count: total,
      durationDays: Math.max(1, Math.floor(Number(durationDays) || 1)),
      status: initialStatus,
      issuedTo: String(issuedTo || assignedAccount || "").trim(),
      note: String(note || "").slice(0, 255),
    },
  });
  json(res, 200, { codes });
}

async function handleIssueCodes(req, res) {
  requireAdmin(req);
  const {
    type = "",
    count = 1,
    assignedAccount = "",
    issuedTo = "",
    sourceNote = "",
    note = "",
  } = await readBody(req);
  const licenseType = type === "official" ? "official" : type === "trial" ? "trial" : "";
  const total = Math.min(100, Math.max(1, Math.floor(Number(count) || 1)));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let assignedUserId = null;
    if (assignedAccount) {
      const [users] = await conn.query(`SELECT id FROM \`${tables.users}\` WHERE account = ? LIMIT 1`, [
        normalizeAccount(assignedAccount),
      ]);
      if (!users[0]) throw Object.assign(new Error("指定账号不存在"), { statusCode: 404 });
      assignedUserId = users[0].id;
    }
    const where = ["status = 'available'", "code_cipher IS NOT NULL"];
    const params = [];
    if (licenseType) {
      where.push("license_type = ?");
      params.push(licenseType);
    }
    if (sourceNote) {
      where.push("note = ?");
      params.push(String(sourceNote).slice(0, 255));
    }
    params.push(total);
    const [rows] = await conn.query(
      `SELECT id, code_cipher, license_type, duration_days
       FROM \`${tables.codes}\`
       WHERE ${where.join(" AND ")}
       ORDER BY id ASC
       LIMIT ?
       FOR UPDATE`,
      params,
    );
    if (rows.length < total) throw Object.assign(new Error(`库存不足：需要 ${total} 个，只有 ${rows.length} 个可发放`), { statusCode: 409 });
    const now = toSqlDate(new Date());
    const ids = rows.map((row) => row.id);
    await conn.query(
      `UPDATE \`${tables.codes}\`
       SET status = 'issued', issued_to = ?, issued_at = ?, assigned_user_id = COALESCE(?, assigned_user_id),
         note = CASE WHEN ? = '' THEN note ELSE ? END, updated_at = ?
       WHERE id IN (${ids.map(() => "?").join(",")})`,
      [
        String(issuedTo || assignedAccount || "").trim() || null,
        now,
        assignedUserId,
        String(note || "").trim(),
        String(note || "").slice(0, 255),
        now,
        ...ids,
      ],
    );
    await conn.commit();
    await writeAudit(req, {
      actorType: "admin",
      actorLabel: "admin",
      action: "admin.codes.issue",
      targetType: "activation_code",
      detail: {
        count: rows.length,
        type: licenseType || "all",
        issuedTo: String(issuedTo || assignedAccount || "").trim(),
        assignedAccount,
        sourceNote,
        note: String(note || "").slice(0, 255),
      },
    });
    json(res, 200, {
      codes: rows.map((row) => ({
        id: Number(row.id),
        code: decryptCode(row.code_cipher),
        type: row.license_type,
        durationDays: Number(row.duration_days),
        status: "issued",
        issuedTo: String(issuedTo || assignedAccount || "").trim(),
      })),
    });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function handleListCodes(req, res) {
  requireAdmin(req);
  const url = new URL(req.url, "http://localhost");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 30)));
  const status = String(url.searchParams.get("status") || "").trim();
  const params = [];
  const where = [];
  if (status) {
    where.push("c.status = ?");
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  params.push(limit);
  const [rows] = await pool.query(
    `SELECT c.id, c.code_cipher, c.code_preview, c.license_type, c.duration_days, c.code_expires_at, c.status,
      c.assigned_user_id, au.account AS assigned_account,
      c.issued_to, c.issued_at,
      c.activated_user_id, uu.account AS activated_account, c.activated_at,
      c.activated_device_id, c.note, c.created_at
     FROM \`${tables.codes}\` c
     LEFT JOIN \`${tables.users}\` au ON au.id = c.assigned_user_id
     LEFT JOIN \`${tables.users}\` uu ON uu.id = c.activated_user_id
     ${whereSql}
     ORDER BY c.id DESC
     LIMIT ?`,
    params,
  );
  json(res, 200, {
    codes: rows.map((row) => ({
      id: Number(row.id),
      code: decryptCode(row.code_cipher),
      preview: row.code_preview,
      type: row.license_type,
      durationDays: Number(row.duration_days),
      codeExpiresAt: toIso(row.code_expires_at),
      status: row.status,
      assignedUserId: row.assigned_user_id ? Number(row.assigned_user_id) : null,
      assignedAccount: row.assigned_account || "",
      issuedTo: row.issued_to || "",
      issuedAt: toIso(row.issued_at),
      activatedUserId: row.activated_user_id ? Number(row.activated_user_id) : null,
      activatedAccount: row.activated_account || "",
      activatedDeviceId: row.activated_device_id || "",
      activatedAt: toIso(row.activated_at),
      note: row.note || "",
      createdAt: toIso(row.created_at),
    })),
  });
}

async function handleAdminStats(req, res) {
  requireAdmin(req);
  const [[userStats]] = await pool.query(`
    SELECT
      COUNT(*) AS total,
      SUM(status = 'active') AS active,
      SUM(status <> 'active') AS disabled,
      SUM(created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS new7d
    FROM \`${tables.users}\`
  `);
  const [codeRows] = await pool.query(`
    SELECT status, COUNT(*) AS count
    FROM \`${tables.codes}\`
    GROUP BY status
  `);
  const [[licenseStats]] = await pool.query(`
    SELECT
      COUNT(*) AS total,
      SUM(status = 'active' AND expires_at > NOW()) AS active,
      SUM(status = 'active' AND expires_at <= NOW()) AS expired
    FROM \`${tables.licenses}\`
  `);
  const [recentLogs] = await pool.query(`
    SELECT action, COUNT(*) AS count
    FROM \`${tables.logs}\`
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY action
    ORDER BY count DESC
    LIMIT 8
  `);
  const [[eventStats]] = await pool.query(`
    SELECT
      COUNT(*) AS total,
      SUM(created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS last7d,
      SUM(success = 0) AS failed
    FROM \`${tables.events}\`
  `);
  const codes = { available: 0, issued: 0, used: 0, revoked: 0 };
  for (const row of codeRows) codes[row.status] = Number(row.count) || 0;
  json(res, 200, {
    users: {
      total: Number(userStats.total) || 0,
      active: Number(userStats.active) || 0,
      disabled: Number(userStats.disabled) || 0,
      new7d: Number(userStats.new7d) || 0,
    },
    codes,
    licenses: {
      total: Number(licenseStats.total) || 0,
      active: Number(licenseStats.active) || 0,
      expired: Number(licenseStats.expired) || 0,
    },
    events: {
      total: Number(eventStats.total) || 0,
      last7d: Number(eventStats.last7d) || 0,
      failed: Number(eventStats.failed) || 0,
    },
    recentLogs: recentLogs.map((row) => ({ action: row.action, count: Number(row.count) || 0 })),
  });
}

async function handleListUsers(req, res) {
  requireAdmin(req);
  const url = new URL(req.url, "http://localhost");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 30)));
  const q = normalizeAccount(url.searchParams.get("q") || "");
  const status = String(url.searchParams.get("status") || "").trim();
  const where = [];
  const params = [];
  if (q) {
    where.push("(u.account LIKE ? OR u.name LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  if (status) {
    where.push("u.status = ?");
    params.push(status);
  }
  params.push(limit);
  const [rows] = await pool.query(
    `SELECT
      u.id, u.account, u.name, u.status, u.created_at, u.updated_at, u.last_login_at,
      l.license_type, l.device_id, l.starts_at, l.expires_at, l.status AS license_status
    FROM \`${tables.users}\` u
    LEFT JOIN \`${tables.licenses}\` l ON l.id = (
      SELECT id FROM \`${tables.licenses}\`
      WHERE user_id = u.id
      ORDER BY expires_at DESC, id DESC
      LIMIT 1
    )
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY u.id DESC
    LIMIT ?`,
    params,
  );
  json(res, 200, {
    users: rows.map((row) => {
      const expiresMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
      return {
        id: Number(row.id),
        account: row.account,
        name: row.name || "",
        status: row.status,
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at),
        lastLoginAt: toIso(row.last_login_at),
        license: row.license_type ? {
          type: row.license_type,
          status: row.license_status,
          active: row.license_status === "active" && expiresMs > Date.now(),
          expired: Boolean(expiresMs && expiresMs <= Date.now()),
          deviceId: row.device_id || "",
          startsAt: toIso(row.starts_at),
          expiresAt: toIso(row.expires_at),
        } : null,
      };
    }),
  });
}

async function handleUpdateUser(req, res) {
  requireAdmin(req);
  const match = new URL(req.url, "http://localhost").pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  const userId = Number(match?.[1] || 0);
  if (!userId) throw Object.assign(new Error("用户 ID 无效"), { statusCode: 400 });
  const { status, name } = await readBody(req);
  const nextStatus = status === "disabled" ? "disabled" : "active";
  await pool.query(
    `UPDATE \`${tables.users}\` SET status = ?, name = COALESCE(?, name), updated_at = ? WHERE id = ?`,
    [nextStatus, typeof name === "string" && name.trim() ? name.trim() : null, toSqlDate(new Date()), userId],
  );
  await writeAudit(req, {
    actorType: "admin",
    actorLabel: "admin",
    action: "admin.user.update",
    targetType: "user",
    targetId: userId,
    detail: { status: nextStatus },
  });
  json(res, 200, { ok: true });
}

async function handleRevokeCode(req, res) {
  requireAdmin(req);
  const match = new URL(req.url, "http://localhost").pathname.match(/^\/api\/admin\/activation-codes\/(\d+)\/revoke$/);
  const codeId = Number(match?.[1] || 0);
  if (!codeId) throw Object.assign(new Error("激活码 ID 无效"), { statusCode: 400 });
  const { reason = "" } = await readBody(req);
  await pool.query(
    `UPDATE \`${tables.codes}\` SET status = 'revoked', note = ?, updated_at = ? WHERE id = ? AND status <> 'used'`,
    [String(reason || "manual revoke").slice(0, 255), toSqlDate(new Date()), codeId],
  );
  await writeAudit(req, {
    actorType: "admin",
    actorLabel: "admin",
    action: "admin.codes.revoke",
    targetType: "activation_code",
    targetId: codeId,
    detail: { reason },
  });
  json(res, 200, { ok: true });
}

async function handleListLogs(req, res) {
  requireAdmin(req);
  const url = new URL(req.url, "http://localhost");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const action = String(url.searchParams.get("action") || "").trim();
  const params = [];
  const where = [];
  if (action) {
    where.push("action = ?");
    params.push(action);
  }
  params.push(limit);
  const [rows] = await pool.query(
    `SELECT * FROM \`${tables.logs}\`
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY id DESC
     LIMIT ?`,
    params,
  );
  json(res, 200, {
    logs: rows.map((row) => ({
      id: Number(row.id),
      actorType: row.actor_type,
      actorId: row.actor_id ? Number(row.actor_id) : null,
      actorLabel: row.actor_label || "",
      action: row.action,
      targetType: row.target_type || "",
      targetId: row.target_id || "",
      ip: row.ip || "",
      userAgent: row.user_agent || "",
      detail: typeof row.detail_json === "string" ? JSON.parse(row.detail_json || "{}") : (row.detail_json || {}),
      createdAt: toIso(row.created_at),
    })),
  });
}

async function handleEventSummary(req, res) {
  requireAdmin(req);
  const [byModule] = await pool.query(`
    SELECT COALESCE(module, 'unknown') AS module, COUNT(*) AS count,
      SUM(success = 0) AS failed,
      AVG(duration_ms) AS avg_duration_ms
    FROM \`${tables.events}\`
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    GROUP BY COALESCE(module, 'unknown')
    ORDER BY count DESC
    LIMIT 20
  `);
  const [byEvent] = await pool.query(`
    SELECT event, COUNT(*) AS count,
      SUM(success = 0) AS failed,
      AVG(duration_ms) AS avg_duration_ms
    FROM \`${tables.events}\`
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    GROUP BY event
    ORDER BY count DESC
    LIMIT 30
  `);
  json(res, 200, {
    byModule: byModule.map((row) => ({
      module: row.module,
      count: Number(row.count) || 0,
      failed: Number(row.failed) || 0,
      avgDurationMs: Math.round(Number(row.avg_duration_ms) || 0),
    })),
    byEvent: byEvent.map((row) => ({
      event: row.event,
      count: Number(row.count) || 0,
      failed: Number(row.failed) || 0,
      avgDurationMs: Math.round(Number(row.avg_duration_ms) || 0),
    })),
  });
}

async function handleListEvents(req, res) {
  requireAdmin(req);
  const url = new URL(req.url, "http://localhost");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const module = String(url.searchParams.get("module") || "").trim();
  const event = String(url.searchParams.get("event") || "").trim();
  const user = normalizeAccount(url.searchParams.get("user") || "");
  const where = [];
  const params = [];
  if (module) {
    where.push("e.module = ?");
    params.push(module);
  }
  if (event) {
    where.push("e.event = ?");
    params.push(event);
  }
  if (user) {
    where.push("u.account LIKE ?");
    params.push(`%${user}%`);
  }
  params.push(limit);
  const [rows] = await pool.query(
    `SELECT e.*, u.account
     FROM \`${tables.events}\` e
     LEFT JOIN \`${tables.users}\` u ON u.id = e.user_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY e.id DESC
     LIMIT ?`,
    params,
  );
  json(res, 200, {
    events: rows.map((row) => ({
      id: Number(row.id),
      userId: row.user_id ? Number(row.user_id) : null,
      account: row.account || "",
      deviceId: row.device_id || "",
      event: row.event,
      module: row.module || "",
      success: row.success === null ? null : Boolean(row.success),
      durationMs: row.duration_ms ?? null,
      errorCode: row.error_code || "",
      appVersion: row.app_version || "",
      meta: typeof row.meta_json === "string" ? JSON.parse(row.meta_json || "{}") : (row.meta_json || {}),
      createdAt: toIso(row.created_at),
      receivedAt: toIso(row.received_at),
    })),
  });
}

await migrate();

http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return json(res, 204, {});
    if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true });
    if (req.method === "GET" && (req.url === "/admin" || req.url.startsWith("/admin/"))) return serveAdmin(req, res);
    if (req.method === "POST" && req.url === "/api/register") return await handleRegister(req, res);
    if (req.method === "POST" && req.url === "/api/login") return await handleLogin(req, res);
    if (req.method === "GET" && req.url === "/api/license/status") return await handleStatus(req, res);
    if (req.method === "POST" && req.url === "/api/license/activate") return await handleActivate(req, res);
    if (req.method === "POST" && req.url === "/api/client/events") return await handleClientEvents(req, res);
    if (req.method === "GET" && req.url.startsWith("/api/admin/stats")) return await handleAdminStats(req, res);
    if (req.method === "GET" && req.url.startsWith("/api/admin/users")) return await handleListUsers(req, res);
    if (req.method === "POST" && /^\/api\/admin\/users\/\d+/.test(new URL(req.url, "http://localhost").pathname)) return await handleUpdateUser(req, res);
    if (req.method === "GET" && req.url.startsWith("/api/admin/logs")) return await handleListLogs(req, res);
    if (req.method === "GET" && req.url.startsWith("/api/admin/client-events/summary")) return await handleEventSummary(req, res);
    if (req.method === "GET" && req.url.startsWith("/api/admin/client-events")) return await handleListEvents(req, res);
    if (req.method === "POST" && /^\/api\/admin\/activation-codes\/\d+\/revoke$/.test(new URL(req.url, "http://localhost").pathname)) return await handleRevokeCode(req, res);
    if (req.method === "POST" && req.url === "/api/admin/activation-codes/issue") return await handleIssueCodes(req, res);
    if (req.method === "POST" && req.url === "/api/admin/activation-codes") return await handleCreateCodes(req, res);
    if (req.method === "GET" && req.url.startsWith("/api/admin/activation-codes")) return await handleListCodes(req, res);
    json(res, 404, { ok: false, message: "Not Found" });
  } catch (error) {
    json(res, error.statusCode || 500, { ok: false, message: error.message || "服务异常" });
  }
}).listen(PORT, () => {
  console.log(`ECutAuto 授权服务 ▶ http://localhost:${PORT}`);
});
