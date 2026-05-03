/**
 * Migrate media from yyslsdata R2 → infini-guild-media R2
 * and update member_profiles in infini-guild-db.
 *
 * Usage: node apps/worker/scripts/migrate-media.mjs
 * Must run from repo root.
 *
 * Strategy:
 *   1. Read user_profile from yyslssql (icon, photos, audio, videos)
 *   2. For each file, download from yyslsdata via wrangler r2 object get
 *   3. Upload to infini-guild-media via wrangler r2 object put
 *   4. Update member_profiles.images, audio_key, video_urls in infini-guild-db
 */

import { execSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OLD_DB = "yyslssql";
const NEW_DB = "fanghuazhaoyun-db";
const OLD_BUCKET = "yyslsdata";
const NEW_BUCKET = "fanghuazhaoyun-media";
const WRANGLER_DIR = "apps/worker";

const SKIP_USERNAMES = new Set([
  "user1","user2","user3","user4","user5","user6","user7","user8","user9","user10",
  "user11","user12","user13","user14","user15","user16","user17","user18","user19","user20",
  "11", "4",
]);

function wranglerQuery(db, sql, opts = {}) {
  const escaped = sql.replace(/"/g, '\\"');
  const envFlag = opts.env ? ` --env ${opts.env}` : "";
  const cmd = `npx wrangler d1 execute ${db}${envFlag} --remote --command "${escaped}" --json`;
  const result = execSync(cmd, { encoding: "utf8", timeout: 30_000, cwd: WRANGLER_DIR });
  const lines = result.split("\n");
  const jsonStart = lines.findIndex((l) => l.trim().startsWith("["));
  if (jsonStart === -1) throw new Error(`No JSON:\n${result}`);
  return JSON.parse(lines.slice(jsonStart).join("\n"));
}

function escSql(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function r2Download(bucket, key, localPath) {
  try {
    execSync(
      `npx wrangler r2 object get ${bucket}/${key} --file "${localPath}"`,
      { encoding: "utf8", timeout: 60_000, cwd: WRANGLER_DIR, stdio: "pipe" }
    );
    return true;
  } catch (err) {
    console.warn(`  SKIP download ${bucket}/${key}: ${err.message?.slice(0, 100)}`);
    return false;
  }
}

function r2Upload(bucket, key, localPath, contentType) {
  try {
    let cmd = `npx wrangler r2 object put ${bucket}/${key} --file "${localPath}"`;
    if (contentType) cmd += ` --content-type "${contentType}"`;
    execSync(cmd, { encoding: "utf8", timeout: 60_000, cwd: WRANGLER_DIR, stdio: "pipe" });
    return true;
  } catch (err) {
    console.warn(`  SKIP upload ${bucket}/${key}: ${err.message?.slice(0, 100)}`);
    return false;
  }
}

function guessContentType(filename) {
  const ext = filename.toLowerCase().split(".").pop();
  const map = {
    webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", svg: "image/svg+xml",
    mp3: "audio/mpeg", opus: "audio/opus", ogg: "audio/ogg",
    m4a: "audio/mp4", wav: "audio/wav", flac: "audio/flac", aac: "audio/aac",
  };
  return map[ext] || "application/octet-stream";
}

function copyR2Object(oldKey, newKey) {
  const tmpDir = mkdtempSync(join(tmpdir(), "r2-migrate-"));
  const tmpFile = join(tmpDir, "obj");
  const ok = r2Download(OLD_BUCKET, oldKey, tmpFile);
  if (!ok) return false;
  const ct = guessContentType(oldKey);
  const uploaded = r2Upload(NEW_BUCKET, newKey, tmpFile, ct);
  try { unlinkSync(tmpFile); } catch {}
  return uploaded;
}

function parseJsonArray(str) {
  if (!str || str === "[]") return [];
  try {
    const arr = JSON.parse(str);
    if (Array.isArray(arr)) return arr.filter(Boolean);
  } catch {}
  return [];
}

async function main() {
  console.log("=== Media Migration: yyslsdata → infini-guild-media ===\n");

  // 1. Read old profiles
  console.log("Reading user_profile from yyslssql...");
  const profileResult = wranglerQuery(OLD_DB,
    "SELECT uid, username, icon, photos, audio, videos FROM user_profile WHERE icon != '' OR photos != '' OR audio != '' OR videos != ''");
  const oldProfiles = profileResult[0].results;
  console.log(`Found ${oldProfiles.length} users with media.\n`);

  // 2. Read username → user_id mapping from new DB
  console.log("Reading username mapping from infini-guild-db...");
  const usersResult = wranglerQuery(NEW_DB, "SELECT id, username FROM users", { env: "production" });
  const usernameToId = new Map(usersResult[0].results.map((r) => [r.username, r.id]));

  // 3. Read existing profiles from new DB
  const profilesResult = wranglerQuery(NEW_DB, "SELECT id, user_id, images, audio_key, video_urls FROM member_profiles", { env: "production" });
  const userIdToProfile = new Map(profilesResult[0].results.map((r) => [r.user_id, r]));

  let copiedCount = 0;
  let skippedCount = 0;
  let updatedCount = 0;

  for (const old of oldProfiles) {
    if (SKIP_USERNAMES.has(old.username) || !old.username?.trim()) {
      console.log(`  SKIP: ${old.username || `uid=${old.uid}`} (test/empty)`);
      skippedCount++;
      continue;
    }

    const userId = usernameToId.get(old.username);
    if (!userId) {
      console.log(`  SKIP: ${old.username} (not in new DB)`);
      skippedCount++;
      continue;
    }

    const profile = userIdToProfile.get(userId);
    if (!profile) {
      console.log(`  SKIP: ${old.username} (no profile in new DB)`);
      skippedCount++;
      continue;
    }

    console.log(`\nMigrating: ${old.username} (uid=${old.uid})...`);

    const newImages = [];
    let newAudioKey = null;
    const newVideoUrls = [];

    // Icon → images[0]
    if (old.icon && old.icon.trim()) {
      const oldKey = `icon/${old.icon}`;
      const newKey = `members/${userId}/icon.webp`;
      console.log(`  icon: ${oldKey} → ${newKey}`);
      if (copyR2Object(oldKey, newKey)) {
        newImages.push(newKey);
        copiedCount++;
      }
    }

    // Photos → images[1..N]
    const photos = parseJsonArray(old.photos);
    for (const photo of photos) {
      const oldKey = `Players/${old.uid}/${photo}`;
      const ext = photo.split(".").pop() || "webp";
      const newKey = `members/${userId}/photos/${photo}`;
      console.log(`  photo: ${oldKey} → ${newKey}`);
      if (copyR2Object(oldKey, newKey)) {
        newImages.push(newKey);
        copiedCount++;
      }
    }

    // Audio
    if (old.audio && old.audio.trim()) {
      const oldKey = old.audio;
      const newKey = `members/${userId}/audio/${old.audio}`;
      console.log(`  audio: ${oldKey} → ${newKey}`);
      if (copyR2Object(oldKey, newKey)) {
        newAudioKey = newKey;
        copiedCount++;
      }
    }

    // Videos (YouTube URLs, no R2 copy needed)
    const videos = parseJsonArray(old.videos);
    for (const url of videos) {
      if (url.startsWith("http")) {
        newVideoUrls.push(url);
      }
    }

    // 4. Update member_profiles in new DB
    const imagesJson = JSON.stringify(newImages);
    const videosJson = JSON.stringify(newVideoUrls);
    const audioVal = newAudioKey ? escSql(newAudioKey) : "NULL";

    const updateSql = `UPDATE member_profiles SET images = ${escSql(imagesJson)}, audio_key = ${audioVal}, video_urls = ${escSql(videosJson)} WHERE user_id = ${escSql(userId)}`;
    try {
      wranglerQuery(NEW_DB, updateSql, { env: "production" });
      console.log(`  DB updated: images=${newImages.length}, audio=${newAudioKey ? "yes" : "no"}, videos=${newVideoUrls.length}`);
      updatedCount++;
    } catch (err) {
      console.error(`  DB UPDATE FAILED: ${err.message?.slice(0, 100)}`);
    }
  }

  console.log(`\n=== Migration complete ===`);
  console.log(`Copied: ${copiedCount} files`);
  console.log(`Updated: ${updatedCount} profiles`);
  console.log(`Skipped: ${skippedCount} users`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
