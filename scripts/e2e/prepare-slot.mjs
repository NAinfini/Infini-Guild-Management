import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");
const stateRoot = resolve(repoRoot, "apps", "portal", "e2e", ".state", "slots");
const configPath = resolve(scriptDir, "wrangler.e2e.jsonc");
const fixturePath = resolve(scriptDir, "fixture-seed.sql");
const migrationDirectory = resolve(
  repoRoot,
  "packages",
  "persistence-sqlite",
  "src",
  "migrations",
  "generated",
);
const manifestPath = resolve(migrationDirectory, "manifest.json");
const wranglerPath = resolve(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js");

const slot = Number(process.argv[2]);
if (!Number.isSafeInteger(slot) || slot < 0 || slot > 255) {
  throw new TypeError("E2E slot must be an integer between 0 and 255");
}

const slotRoot = resolve(stateRoot, `slot-${slot}`);
if (dirname(slotRoot) !== stateRoot) throw new Error("Refusing to reset an E2E path outside the slot root");
const persistPath = resolve(slotRoot, "wrangler");

await Promise.all([access(configPath), access(fixturePath), access(manifestPath), access(wranglerPath)]);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!Array.isArray(manifest) || manifest.length === 0) throw new TypeError("Migration manifest must not be empty");
await Promise.all(manifest.map(async (entry, ordinal) => {
  if (entry === null || typeof entry !== "object" || entry.ordinal !== ordinal
    || typeof entry.file !== "string" || !/^\d{4}_[a-z0-9_]+\.sql$/.test(entry.file)) {
    throw new TypeError(`Invalid migration manifest entry at ordinal ${ordinal}`);
  }
  const migrationPath = resolve(migrationDirectory, entry.file);
  if (dirname(migrationPath) !== migrationDirectory) throw new TypeError("Migration file escapes its directory");
  await access(migrationPath);
}));
await rm(slotRoot, { recursive: true, force: true });
await mkdir(persistPath, { recursive: true });

runWrangler([
  "d1",
  "migrations",
  "apply",
  "DB",
  "--local",
  "--config",
  configPath,
  "--persist-to",
  persistPath,
]);
runWrangler([
  "d1",
  "execute",
  "DB",
  "--local",
  "--config",
  configPath,
  "--persist-to",
  persistPath,
  "--file",
  fixturePath,
]);

function runWrangler(args) {
  const result = spawnSync(process.execPath, [wranglerPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, CI: "1" },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Local Wrangler command failed with exit code ${result.status}: ${args.join(" ")}`);
  }
}
