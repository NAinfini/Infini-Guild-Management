import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const patterns = [
  { re: /SIGNING_SECRET\s*[:=]\s*["'][^"']+["']/i, label: "SIGNING_SECRET" },
  { re: /api[_-]?key\s*[:=]\s*["'][^"']+["']/i, label: "API key" },
  { re: /api[_-]?token\s*[:=]\s*["'][^"']+["']/i, label: "API token" },
  { re: /client[_-]?secret\s*[:=]\s*["'][^"']+["']/i, label: "client secret" },
  { re: /private[_-]?key\s*[:=]\s*["'][^"']+["']/i, label: "private key" },
];

const skipFile = [
  /\.dev\.vars$/,
  /\.env/,
  /node_modules/,
  /\.test\.(ts|tsx|js)$/,
  /tests?\//,
  /seed\.(ts|js)$/,
  /check-no-secrets\.mjs$/,
];

const ciMode = process.argv.includes("--ci");

let files;
if (ciMode) {
  const tracked = execSync("git ls-files -- apps/ scripts/", { encoding: "utf8" }).trim();
  files = tracked.split("\n").filter(Boolean);
} else {
  const staged = execSync("git diff --cached --name-only --diff-filter=ACM", { encoding: "utf8" }).trim();
  if (!staged) process.exit(0);
  files = staged.split("\n").filter(Boolean);
}

let failed = false;

for (const file of files) {
  if (skipFile.some((re) => re.test(file))) continue;
  if (!/\.(ts|tsx|js|mjs|json|jsonc|yaml|yml|toml|env)$/i.test(file)) continue;

  let content;
  try {
    content = ciMode ? readFileSync(file, "utf8") : execSync(`git show :${file}`, { encoding: "utf8" });
  } catch {
    continue;
  }

  for (const { re, label } of patterns) {
    const match = content.match(re);
    if (match) {
      console.error(`[secret-check] ❌ ${file}: found ${label} → ${match[0].slice(0, 60)}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error("\n[secret-check] Blocked. Move secrets to .dev.vars or use wrangler secret put.");
  process.exit(1);
} else {
  console.log("[secret-check] ✅ No secrets found in scanned files.");
}
