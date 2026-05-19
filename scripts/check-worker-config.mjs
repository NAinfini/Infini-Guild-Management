import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const configPath = resolve(root, "apps/worker/wrangler.jsonc");
const text = await readFile(configPath, "utf8");

const envArg = process.argv.find((arg) => arg.startsWith("--env="));
const env = envArg?.slice("--env=".length);

if (env === "staging" && text.includes('"database_id": "STAGING_DB_ID_HERE"')) {
  console.error("[config] staging D1 database_id is still STAGING_DB_ID_HERE");
  process.exit(1);
}
