import { existsSync, readFileSync } from "node:fs";
import { createDecipheriv, createHash } from "node:crypto";
import mysql from "mysql2/promise";

loadEnvFile();

const JWT_SECRET = process.env.AUTH_JWT_SECRET || "dev-only-change-me";
const CODE_SECRET = process.env.AUTH_CODE_SECRET || JWT_SECRET;
const DB_PREFIX = sanitizePrefix(process.env.DB_PREFIX || "r_");
const tables = {
  users: `${DB_PREFIX}users`,
  codes: `${DB_PREFIX}activation_codes`,
};

const args = parseArgs(process.argv.slice(2));
const limit = clampInt(args.limit ?? 50, 1, 1000);
const status = String(args.status || "").trim();
const type = args.type === "official" ? "official" : args.type === "trial" ? "trial" : "";
const jsonOutput = Boolean(args.json);

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

function toIso(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function codeCryptoKey() {
  return createHash("sha256").update(CODE_SECRET).digest();
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

function render(rows) {
  const data = rows.map((row) => ({
    id: Number(row.id),
    code: decryptCode(row.code_cipher),
    preview: row.code_preview,
    type: row.license_type,
    durationDays: Number(row.duration_days),
    status: row.status,
    issuedTo: row.issued_to || "",
    issuedAt: toIso(row.issued_at),
    assignedAccount: row.assigned_account || "",
    activatedAccount: row.activated_account || "",
    activatedDeviceId: row.activated_device_id || "",
    activatedAt: toIso(row.activated_at),
    note: row.note || "",
    createdAt: toIso(row.created_at),
  }));
  if (jsonOutput) return `${JSON.stringify({ count: data.length, codes: data }, null, 2)}\n`;
  return [
    `count=${data.length}`,
    "id\tstatus\ttype\tdays\tcode\tissued_to\tactivated_account",
    ...data.map((item) => [
      item.id,
      item.status,
      item.type,
      item.durationDays,
      item.code || item.preview,
      item.issuedTo || "-",
      item.activatedAccount || "-",
    ].join("\t")),
    "",
  ].join("\n");
}

async function main() {
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
  const where = [];
  const params = [];
  if (status) {
    where.push("c.status = ?");
    params.push(status);
  }
  if (type) {
    where.push("c.license_type = ?");
    params.push(type);
  }
  params.push(limit);
  const [rows] = await pool.query(
    `SELECT c.*, au.account AS assigned_account, uu.account AS activated_account
     FROM \`${tables.codes}\` c
     LEFT JOIN \`${tables.users}\` au ON au.id = c.assigned_user_id
     LEFT JOIN \`${tables.users}\` uu ON uu.id = c.activated_user_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY c.id DESC
     LIMIT ?`,
    params,
  );
  await pool.end();
  process.stdout.write(render(rows));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
