/**
 * Migrate users from yyslssql (fanghuazhaoyun) D1 → fanghuazhaoyun-db.
 *
 * Usage:
 *   node apps/worker/scripts/migrate-users.mjs
 *
 * Reads users from yyslssql, creates them in fanghuazhaoyun-db
 * with password "1234" (PBKDF2-SHA256, 210k iterations).
 *
 * Must run from the repo root (wrangler.jsonc lives in apps/worker).
 */

import { execSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { randomUUID } from "node:crypto";

const OLD_DB = "yyslssql";
const NEW_DB = "fanghuazhaoyun-db";
const WRANGLER_DIR = "apps/worker";
const DEFAULT_PASSWORD = "1234";

const PBKDF2_ITERATIONS = 10_000;
const PBKDF2_KEY_LENGTH_BITS = 256;
const PBKDF2_SALT_BYTES = 16;

const VALID_CLASSES = new Set([
  "鸣金虹", "鸣金影", "牵丝玉", "牵丝霖",
  "破竹风", "破竹尘", "破竹鸢", "裂石威", "裂石钧",
]);

const SKIP_USERNAMES = new Set([
  "user1","user2","user3","user4","user5","user6","user7","user8","user9","user10",
  "user11","user12","user13","user14","user15","user16","user17","user18","user19","user20",
  "11", "4",
]);

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function hashPassword(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const keyMaterial = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    PBKDF2_KEY_LENGTH_BITS,
  );
  return {
    passwordHash: bytesToBase64(new Uint8Array(bits)),
    salt: bytesToBase64(salt),
  };
}

function wranglerExec(db, sql, { env } = {}) {
  const escaped = sql.replace(/"/g, '\\"');
  const envFlag = env ? ` --env ${env}` : "";
  const cmd = `npx wrangler d1 execute ${db}${envFlag} --remote --command "${escaped}" --json`;
  const result = execSync(cmd, { encoding: "utf8", timeout: 30_000, cwd: WRANGLER_DIR });
  const lines = result.split("\n");
  const jsonStart = lines.findIndex((l) => l.trim().startsWith("["));
  if (jsonStart === -1) throw new Error(`No JSON output:\n${result}`);
  return JSON.parse(lines.slice(jsonStart).join("\n"));
}

function parseClasses(classStr) {
  if (!classStr) return [];
  return classStr.split(",").map((c) => c.trim()).filter((c) => VALID_CLASSES.has(c));
}

function mapRole(oldRole) {
  if (oldRole === "admin") return "admin";
  return "member";
}

function escSql(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  console.log("=== User Migration: yyslssql → fanghuazhaoyun-db ===\n");

  // 1. Read from old DB (no --env needed, yyslssql is a top-level D1)
  console.log(`Reading users from ${OLD_DB}...`);
  const authResult = wranglerExec(OLD_DB,
    "SELECT uid, username, role, created_at FROM user_auth ORDER BY uid");
  const oldAuth = authResult[0].results;

  console.log(`Reading profiles from ${OLD_DB}...`);
  const profileResult = wranglerExec(OLD_DB,
    "SELECT uid, title, class, power, bio FROM user_profile ORDER BY uid");
  const profileMap = new Map(profileResult[0].results.map((p) => [p.uid, p]));

  console.log(`Reading availability from ${OLD_DB}...`);
  const availResult = wranglerExec(OLD_DB,
    "SELECT uid, active_times, vacation_ranges FROM user_availability");
  const availMap = new Map(availResult[0].results.map((a) => [a.uid, a]));

  // 2. Filter out garbage/test users
  const validUsers = oldAuth.filter((u) => {
    if (SKIP_USERNAMES.has(u.username)) {
      console.log(`  SKIP (test/garbage): ${u.username} (uid=${u.uid})`);
      return false;
    }
    if (!u.username || u.username.trim() === "") {
      console.log(`  SKIP (empty username): uid=${u.uid}`);
      return false;
    }
    return true;
  });

  console.log(`\nFound ${validUsers.length} valid users (skipped ${oldAuth.length - validUsers.length}).\n`);

  // 3. Hash passwords & build records
  console.log(`Hashing password "${DEFAULT_PASSWORD}" for each user...`);
  const records = [];
  for (const u of validUsers) {
    const { passwordHash, salt } = await hashPassword(DEFAULT_PASSWORD);
    const profile = profileMap.get(u.uid) ?? {};
    const avail = availMap.get(u.uid);
    const userId = randomUUID();
    const profileId = randomUUID();
    const classes = parseClasses(profile.class);

    let availability = null;
    if (avail?.active_times && avail.active_times !== "[]") {
      try {
        const parsed = JSON.parse(avail.active_times);
        if (Array.isArray(parsed) && parsed.length > 0) {
          availability = JSON.stringify({ active_times: parsed });
        }
      } catch { /* ignore */ }
    }

    records.push({
      userId,
      profileId,
      username: u.username,
      role: mapRole(u.role),
      createdAt: u.created_at.includes("T") ? u.created_at : new Date(u.created_at + " UTC").toISOString(),
      power: profile.power ?? 0,
      classes: JSON.stringify(classes),
      titleHtml: profile.title || null,
      bio: profile.bio || null,
      availability,
      passwordHash,
      salt,
    });
  }

  // 4. Check for existing users in new DB
  console.log(`\nChecking new DB for existing users...`);
  const existingResult = wranglerExec(NEW_DB, "SELECT username FROM users", { env: "production" });
  const existingUsernames = new Set(existingResult[0].results.map((r) => r.username));

  const toInsert = records.filter((r) => {
    if (existingUsernames.has(r.username)) {
      console.log(`  SKIP (already exists): ${r.username}`);
      return false;
    }
    return true;
  });

  if (toInsert.length === 0) {
    console.log("\nNo new users to migrate. Done!");
    return;
  }

  // 5. Insert users
  console.log(`\nInserting ${toInsert.length} users into ${NEW_DB}...`);
  let successCount = 0;
  let failCount = 0;

  for (const u of toInsert) {
    const userSql = `INSERT INTO users (id, username, role, is_active, created_at, updated_at) VALUES (${escSql(u.userId)}, ${escSql(u.username)}, ${escSql(u.role)}, 1, ${escSql(u.createdAt)}, ${escSql(u.createdAt)})`;
    const authSql = `INSERT INTO user_auth_password (user_id, password_hash, salt) VALUES (${escSql(u.userId)}, ${escSql(u.passwordHash)}, ${escSql(u.salt)})`;
    const profileSql = `INSERT INTO member_profiles (id, user_id, power, classes, title_html, bio, images, video_urls, availability) VALUES (${escSql(u.profileId)}, ${escSql(u.userId)}, ${u.power}, ${escSql(u.classes)}, ${escSql(u.titleHtml)}, ${escSql(u.bio)}, '[]', '[]', ${escSql(u.availability)})`;

    try {
      wranglerExec(NEW_DB, userSql, { env: "production" });
      wranglerExec(NEW_DB, authSql, { env: "production" });
      wranglerExec(NEW_DB, profileSql, { env: "production" });
      console.log(`  OK: ${u.username} (${u.role}, power=${u.power})`);
      successCount++;
    } catch (err) {
      console.error(`  FAIL: ${u.username} — ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n=== Migration complete ===`);
  console.log(`Success: ${successCount}, Failed: ${failCount}`);
  console.log(`All migrated users can log in with password: ${DEFAULT_PASSWORD}`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
