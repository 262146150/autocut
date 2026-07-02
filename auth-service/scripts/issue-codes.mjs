import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const type = args.type === "official" ? "official" : args.type === "trial" ? "trial" : "";
const count = clampInt(args.count ?? 1, 1, 10000);
const issuedTo = String(args.to || args["issued-to"] || "").trim();
const assignedAccount = String(args.assigned || "").trim().toLowerCase();
const sourceNote = String(args["source-note"] || "").trim();
const note = String(args.note || "").slice(0, 255);
const outputFile = String(args.out || "").trim();
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

function toSqlDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function codeCryptoKey() {
  return createHash("sha256").update(CODE_SECRET).digest();
}

function decryptCode(value) {
  const [version, ivRaw, tagRaw, encryptedRaw] = String(value || "").split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) return "";
  const decipher = createDecipheriv("aes-256-gcm", codeCryptoKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function render(codes) {
  if (jsonOutput) {
    return `${JSON.stringify({
      count: codes.length,
      type: type || null,
      sourceNote: sourceNote || null,
      issuedTo,
      assignedAccount: assignedAccount || null,
      codes,
    }, null, 2)}\n`;
  }
  return [
    `count=${codes.length}`,
    `type=${type || "all"}`,
    `sourceNote=${sourceNote || "-"}`,
    `issuedTo=${issuedTo || "-"}`,
    `assignedAccount=${assignedAccount || "-"}`,
    "",
    ...codes.map((item) => `${item.code}  # id=${item.id}, ${item.type}, ${item.durationDays}天`),
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
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let assignedUserId = null;
    if (assignedAccount) {
      const [users] = await conn.query(`SELECT id FROM \`${tables.users}\` WHERE account = ? LIMIT 1`, [assignedAccount]);
      if (!users[0]) throw new Error(`指定账号不存在：${assignedAccount}`);
      assignedUserId = users[0].id;
    }
    const where = ["status = 'available'", "code_cipher IS NOT NULL"];
    const params = [];
    if (type) {
      where.push("license_type = ?");
      params.push(type);
    }
    if (sourceNote) {
      where.push("note = ?");
      params.push(sourceNote);
    }
    params.push(count);
    const [rows] = await conn.query(
      `SELECT id, code_cipher, license_type, duration_days
       FROM \`${tables.codes}\`
       WHERE ${where.join(" AND ")}
       ORDER BY id ASC
       LIMIT ?
       FOR UPDATE`,
      params,
    );
    if (rows.length < count) {
      throw new Error(`库存不足：需要 ${count} 个，只有 ${rows.length} 个可发放`);
    }
    const now = toSqlDate(new Date());
    const ids = rows.map((row) => row.id);
    await conn.query(
      `UPDATE \`${tables.codes}\`
       SET status = 'issued', issued_to = ?, issued_at = ?, assigned_user_id = COALESCE(?, assigned_user_id),
         note = CASE WHEN ? = '' THEN note ELSE ? END, updated_at = ?
       WHERE id IN (${ids.map(() => "?").join(",")})`,
      [
        issuedTo || assignedAccount || null,
        now,
        assignedUserId,
        note,
        note,
        now,
        ...ids,
      ],
    );
    await conn.commit();
    const codes = rows.map((row) => ({
      id: Number(row.id),
      code: decryptCode(row.code_cipher),
      type: row.license_type,
      durationDays: Number(row.duration_days),
      status: "issued",
      issuedTo: issuedTo || assignedAccount,
    }));
    const output = render(codes);
    if (outputFile) writeFileSync(outputFile, output);
    process.stdout.write(output);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
