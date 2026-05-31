import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const configPath = resolve(root, "apps/worker/wrangler.jsonc");

try {
  await access(configPath);
} catch {
  console.error(
    "[config] apps/worker/wrangler.jsonc not found.\n" +
      "  Copy apps/worker/wrangler.example.jsonc → apps/worker/wrangler.jsonc\n" +
      "  and fill in your Cloudflare resource IDs."
  );
  process.exit(1);
}

const text = await readFile(configPath, "utf8");

const envArg = process.argv.find((arg) => arg.startsWith("--env="));
const env = envArg?.slice("--env=".length);

if (text.includes("YOUR_D1_DATABASE_ID") || text.includes("YOUR_DOMAIN") || text.includes("STAGING_DB_ID_HERE")) {
  console.error(
    `[config] wrangler.jsonc still contains placeholder values.\n` +
      `  Replace all YOUR_* placeholders with your Cloudflare resource IDs.`
  );
  process.exit(1);
}
