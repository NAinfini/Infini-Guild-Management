/**
 * Migrate ALL media from yyslsdata R2 → fanghuazhaoyun-media R2.
 *
 * Approach:
 *   - List all objects via Cloudflare API
 *   - Extract uid from filenames "(uid).ext" pattern
 *   - Extract username from Players/username(uid)/ directory names
 *   - Match username → user_id via fanghuazhaoyun-db
 *   - Copy Icon/, Players/ audio/photos to members/{userId}/...
 *   - Copy gallery/, announcements/, rewards/ as-is (not user-specific)
 *   - Update member_profiles with new R2 keys
 *
 * Usage: node apps/worker/scripts/migrate-media-v2.mjs
 */

import { execSync } from "node:child_process";
import { readFileSync, mkdtempSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ACCOUNT_ID = "e69d47a4652cc5b6f841332cf28f2170";
const OLD_BUCKET = "yyslsdata";
const NEW_BUCKET = "fanghuazhaoyun-media";
const NEW_DB = "fanghuazhaoyun-db";
const WRANGLER_DIR = "apps/worker";

const configPath = join(process.env.APPDATA, "xdg.config", ".wrangler", "config", "default.toml");
const configContent = readFileSync(configPath, "utf8");
const tokenMatch = configContent.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!tokenMatch) throw new Error("No oauth_token found");
const API_TOKEN = tokenMatch[1];

function extractUid(str) {
  const match = str.match(/\((\d+)\)/);
  return match ? parseInt(match[1], 10) : null;
}

async function listAllObjects() {
  const objects = [];
  let cursor = null;
  do {
    let url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${OLD_BUCKET}/objects?per_page=100`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${API_TOKEN}` } });
    const data = await resp.json();
    if (!data.success) throw new Error(JSON.stringify(data.errors));
    objects.push(...data.result);
    cursor = data.result_info?.is_truncated ? data.result_info.cursor : null;
  } while (cursor);
  return objects;
}

function r2Copy(oldKey, newKey, contentType) {
  const tmpDir = mkdtempSync(join(tmpdir(), "r2m-"));
  const tmpFile = join(tmpDir, "obj");
  try {
    execSync(
      `npx wrangler r2 object get "${OLD_BUCKET}/${oldKey}" --remote --file "${tmpFile}"`,
      { encoding: "utf8", timeout: 120_000, cwd: WRANGLER_DIR, stdio: "pipe" }
    );
  } catch (err) {
    console.warn(`  SKIP download ${oldKey}: ${err.stderr?.slice(0, 80) || err.message?.slice(0, 80)}`);
    return false;
  }
  try {
    let cmd = `npx wrangler r2 object put "${NEW_BUCKET}/${newKey}" --remote --file "${tmpFile}"`;
    if (contentType) cmd += ` --content-type "${contentType}"`;
    execSync(cmd, { encoding: "utf8", timeout: 120_000, cwd: WRANGLER_DIR, stdio: "pipe" });
  } catch (err) {
    console.warn(`  SKIP upload ${newKey}: ${err.stderr?.slice(0, 80) || err.message?.slice(0, 80)}`);
    return false;
  }
  try { unlinkSync(tmpFile); } catch {}
  return true;
}

function wranglerQuery(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute ${NEW_DB} --env production --remote --command "${escaped}" --json`;
  const result = execSync(cmd, { encoding: "utf8", timeout: 30_000, cwd: WRANGLER_DIR });
  const lines = result.split("\n");
  const jsonStart = lines.findIndex((l) => l.trim().startsWith("["));
  if (jsonStart === -1) throw new Error(`No JSON:\n${result}`);
  return JSON.parse(lines.slice(jsonStart).join("\n"));
}

function escSql(v) {
  if (v === null || v === undefined) return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function main() {
  console.log("=== Media Migration v2 ===\n");

  // 1. Build uid → user_id map from Players/ directory names + DB usernames
  console.log("Loading users from fanghuazhaoyun-db...");
  const usersResult = wranglerQuery("SELECT id, username FROM users");
  const usernameToId = new Map(usersResult[0].results.map(r => [r.username, r.id]));
  console.log(`  ${usernameToId.size} users in DB\n`);

  // 2. List all R2 objects
  console.log("Listing yyslsdata objects...");
  const allObjects = await listAllObjects();
  console.log(`  ${allObjects.length} objects\n`);

  // 3. Build uid → username from Players/ directory names
  const uidToUsername = new Map();
  for (const obj of allObjects) {
    const match = obj.key.match(/^Players\/([^/]+)\((\d+)\)\//);
    if (match) {
      uidToUsername.set(parseInt(match[2], 10), match[1]);
    }
  }
  // Also handle icons without Player directory (uid only from filename)
  // For icons like "Icon/longjinghe-6-20257212921_2.webp" without (uid) pattern,
  // we need special handling — skip for now, they're rare

  console.log("UID → Username mappings from Players/ dirs:");
  for (const [uid, name] of [...uidToUsername].sort((a, b) => a[0] - b[0])) {
    const userId = usernameToId.get(name);
    console.log(`  uid=${uid} → ${name} → ${userId ? "✓" : "NOT IN DB"}`);
  }

  // Build uid → user_id
  const uidToUserId = new Map();
  for (const [uid, username] of uidToUsername) {
    const userId = usernameToId.get(username);
    if (userId) uidToUserId.set(uid, userId);
  }

  // For Icons that only have (uid) in filename but no Players/ dir,
  // we can't map without the old DB. Log them as skipped.

  // 4. Process files
  let copied = 0, skipped = 0;
  const profileData = new Map(); // user_id → { images, audioKey }

  for (const obj of allObjects) {
    const key = obj.key;
    const ct = obj.http_metadata?.contentType || "application/octet-stream";

    // Skip empty directory markers and profile.json files
    if (obj.size === 0 || key.endsWith("profile.json") || key.endsWith("index.json") || key.endsWith("post.json")) {
      continue;
    }

    // === Icon files ===
    if (key.startsWith("Icon/")) {
      const uid = extractUid(key);
      if (!uid) {
        // Icons without (uid) like "longjinghe-6-..." or "user-3-3-icon.webp"
        // Try matching by known patterns
        console.log(`  SKIP Icon (no uid): ${key}`);
        skipped++;
        continue;
      }
      const userId = uidToUserId.get(uid);
      if (!userId) {
        console.log(`  SKIP Icon uid=${uid} (no user mapping): ${key}`);
        skipped++;
        continue;
      }
      const newKey = `members/${userId}/icon.webp`;
      console.log(`  Icon: ${key} → ${newKey}`);
      if (r2Copy(key, newKey, ct)) {
        if (!profileData.has(userId)) profileData.set(userId, { images: [], audioKey: null });
        profileData.get(userId).images.unshift(newKey);
        copied++;
      } else { skipped++; }
      continue;
    }

    // === Player files (photos, audio) ===
    if (key.startsWith("Players/")) {
      const dirMatch = key.match(/^Players\/[^/]+\((\d+)\)\//);
      if (!dirMatch) { continue; }
      const uid = parseInt(dirMatch[1], 10);
      const userId = uidToUserId.get(uid);
      if (!userId) {
        console.log(`  SKIP Player uid=${uid}: ${key}`);
        skipped++;
        continue;
      }
      const filename = key.split("/").pop();
      const isAudio = ct.startsWith("audio/") || /\.(mp3|opus|ogg|m4a|wav|flac|aac)$/i.test(filename);

      if (!profileData.has(userId)) profileData.set(userId, { images: [], audioKey: null });

      if (isAudio) {
        const newKey = `members/${userId}/audio/${filename}`;
        console.log(`  Audio: ${key} → ${newKey}`);
        if (r2Copy(key, newKey, ct)) {
          profileData.get(userId).audioKey = newKey;
          copied++;
        } else { skipped++; }
      } else {
        const newKey = `members/${userId}/photos/${filename}`;
        console.log(`  Photo: ${key} → ${newKey}`);
        if (r2Copy(key, newKey, ct)) {
          profileData.get(userId).images.push(newKey);
          copied++;
        } else { skipped++; }
      }
      continue;
    }

    // === Gallery, announcements, rewards, etc — copy as-is ===
    if (key.startsWith("gallery/") || key.startsWith("announcements/") ||
        key.startsWith("rewards/") || key.startsWith("other-events/") ||
        key.startsWith("bugs/")) {
      console.log(`  Shared: ${key}`);
      if (r2Copy(key, key, ct)) { copied++; } else { skipped++; }
      continue;
    }
  }

  // 5. Update member_profiles
  console.log("\n--- Updating member_profiles ---");
  let updatedCount = 0;
  for (const [userId, data] of profileData) {
    if (data.images.length === 0 && !data.audioKey) continue;
    const imagesJson = JSON.stringify(data.images);
    const audioVal = data.audioKey ? escSql(data.audioKey) : "NULL";
    const sql = `UPDATE member_profiles SET images = ${escSql(imagesJson)}, audio_key = ${audioVal} WHERE user_id = ${escSql(userId)}`;
    try {
      wranglerQuery(sql);
      console.log(`  ${userId}: images=${data.images.length}, audio=${data.audioKey ? "yes" : "no"}`);
      updatedCount++;
    } catch (err) {
      console.error(`  FAILED ${userId}: ${err.message?.slice(0, 100)}`);
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Copied: ${copied}, Updated: ${updatedCount} profiles, Skipped: ${skipped}`);
}

main().catch(err => { console.error("Failed:", err); process.exit(1); });
