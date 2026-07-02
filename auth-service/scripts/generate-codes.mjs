import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import mysql from "mysql2/promise";

loadEnvFile();

const JWT_SECRET = process.env.AUTH_JWT_SECRET || "dev-only-change-me";
const CODE_SECRET = process.env.AUTH_CODE_SECRET || JWT_SECRET;
const DB_PREFIX = sanitizePrefix(process.env.DB_PREFIX || "r_");
const tables = {
  users: `${DB_PREFIX}users`,
  codes: `${DB_PREFIX}activation_codes`,
  licenses: `${DB_PREFIX}user_licenses`,
};

const args = parseArgs(process.argv.slice(2));
const type = args.type === "official" ? "official" : "trial";
const count = clampInt(args.count ?? 1, 1, 10000);
const durationDays = clampInt(args.days ?? (type === "official" ? 365 : 7), 1, 3650);
const codeExpiresAt = args.expires ? toSqlDate(args.expires) : null;
const assignedAccount = String(args.assigned || "").trim().toLowerCase();
const issuedTo = String(args["issued-to"] || args.issuedTo || assignedAccount || "").trim();
const initialStatus = issuedTo || assignedAccount ? "issued" : "available";
const note = String(args.note || `batch-${type}`).slice(0, 255);
const outputFile = String(args.out || "").trim();
const jsonOutput = Boolean(args.json);
const dryRun = Boolean(args["dry-run"]);

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

function parseArgs(values) {
  const result = {};
  for (let i = 0; i < values.length; i += 1) {
    const item = values[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = values[i + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
    } else {
      result[key] = next;
      i += 1;
    }
  }
  return result;
}

function sanitizePrefix(value) {
  const cleaned = String(value || "").replace(/[^a-zA-Z0-9_]/g, "");
  return cleaned || "r_";
}

function clampInt(value, min, max) {
  const number = Math.floor(Number(value) || min);
  return Math.min(max, Math.max(min, number));
}

function normalizeCode(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function formatCode(raw) {
  const normalized = normalizeCode(raw);
  const chunks = [];
  for (let i = 0; i < normalized.length; i += 4) chunks.push(normalized.slice(i, i + 4));
  return chunks.join("-");
}

function generateActivationCode(licenseType) {
  const prefix = licenseType === "official" ? "ECF" : "ECT";
  return formatCode(`${prefix}${randomBytes(10).toString("hex")}`);
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

function toSqlDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`无效日期：${value}`);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function nowSql() {
  return toSqlDate(new Date());
}

async function migrate(pool) {
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
}

function render(codes) {
  if (jsonOutput) {
    return `${JSON.stringify({
      type,
      count: codes.length,
      durationDays,
      codeExpiresAt,
      assignedAccount: assignedAccount || null,
      issuedTo: issuedTo || null,
      status: initialStatus,
      note,
      codes,
    }, null, 2)}\n`;
  }
  return [
    `type=${type}`,
    `count=${codes.length}`,
    `durationDays=${durationDays}`,
    `codeExpiresAt=${codeExpiresAt || "-"}`,
    `assignedAccount=${assignedAccount || "-"}`,
    `issuedTo=${issuedTo || "-"}`,
    `status=${initialStatus}`,
    "",
    ...codes.map((item) => item.code),
    "",
  ].join("\n");
}

async function main() {
  const codes = Array.from({ length: count }, () => ({
    code: generateActivationCode(type),
    type,
    durationDays,
    status: initialStatus,
    issuedTo,
  }));

  if (!dryRun) {
    const pool = mysql.createPool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      database: process.env.DB_DATABASE || "autocut",
      user: process.env.DB_USERNAME || "root",
      password: process.env.DB_PASSWORD || "",
      waitForConnections: true,
      connectionLimit: 4,
      charset: "utf8mb4",
      timezone: "Z",
    });
    await migrate(pool);
    let assignedUserId = null;
    if (assignedAccount) {
      const [users] = await pool.query(`SELECT id FROM \`${tables.users}\` WHERE account = ? LIMIT 1`, [assignedAccount]);
      if (!users[0]) throw new Error(`指定账号不存在：${assignedAccount}`);
      assignedUserId = users[0].id;
    }
    const createdAt = nowSql();
    for (const item of codes) {
      const preview = `${item.code.slice(0, 8)}...${item.code.slice(-4)}`;
      await pool.query(
        `INSERT INTO \`${tables.codes}\` (
          code_hash, code_preview, license_type, duration_days, code_expires_at,
          code_cipher, status, assigned_user_id, issued_to, issued_at, created_by, note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          codeHash(item.code),
          preview,
          type,
          durationDays,
          codeExpiresAt,
          encryptCode(item.code),
          initialStatus,
          assignedUserId,
          issuedTo || null,
          initialStatus === "issued" ? createdAt : null,
          "batch-script",
          note,
          createdAt,
          createdAt,
        ],
      );
    }
    await pool.end();
  }

  const output = render(codes);
  if (outputFile) writeFileSync(outputFile, output);
  process.stdout.write(output);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
