import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HIGH_CONFIDENCE_PATTERNS = [
  { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, label: "private key" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: "AWS access key" },
  { re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, label: "GitHub token" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, label: "GitHub fine-grained token" },
  { re: /\bnpm_[A-Za-z0-9]{36}\b/g, label: "npm token" },
  { re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, label: "API secret key" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, label: "Slack token" },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, label: "Google API key" },
  { re: /\/\/registry\.[^:\s]+\/:_authToken\s*=\s*\S+/gi, label: "registry auth token" },
];

const ASSIGNMENT_PATTERN =
  /\b(SIGNING_SECRET|api[_-]?key|api[_-]?token|client[_-]?secret|private[_-]?key|auth[_-]?token|access[_-]?token|secret[_-]?access[_-]?key)\b["']?\s*[:=]\s*["']([^"'\r\n]{8,})["']/gi;

const PLACEHOLDER_PATTERN =
  /^(?:test|fake|dummy|mock|example|placeholder|replace|your[_-]|change[_-]?me|not[-_ ]?a[-_ ]?real|development)/i;

const FIXTURE_PATH = /(^|\/)(?:tests?|__tests__|fixtures?|mocks?|db\/seed)(\/|$)|\.test\.[^/]+$/i;
const SCANNABLE_FILE = /\.(?:[cm]?[jt]sx?|jsonc?|ya?ml|toml|md|txt|ini|cfg|conf|properties|sh|ps1|sql)$/i;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function splitNull(value) {
  return value.split("\0").filter(Boolean);
}

export function isForbiddenTrackedFile(file) {
  const name = basename(file);
  if (/^\.env(?:\..+)?\.example$/i.test(name) || /^\.dev\.vars(?:\..+)?\.example$/i.test(name)) {
    return false;
  }
  // Every wrangler.jsonc is a deployment's private manifest (real resource IDs,
  // domains); only the wrangler.example.jsonc template belongs in the repo.
  return (
    /^\.env(?:\.|$)/i.test(name) ||
    /^\.dev\.vars(?:\.|$)/i.test(name) ||
    name === "wrangler.jsonc" ||
    /^(?:id_rsa|id_ed25519)/i.test(name) ||
    /\.(?:pem|key|p12|pfx|jks|keystore|tfstate|kdbx|sqlite3?|db(?:-wal|-shm)?|dump)$/i.test(name) ||
    /^(?:credentials|secrets|service-account)\.json$/i.test(name)
  );
}

export function findSecretLabels(content, includeAssignments = true) {
  const labels = new Set();
  for (const { re, label } of HIGH_CONFIDENCE_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(content)) labels.add(label);
  }
  if (includeAssignments) {
    ASSIGNMENT_PATTERN.lastIndex = 0;
    for (const match of content.matchAll(ASSIGNMENT_PATTERN)) {
      const value = match[2]?.trim() ?? "";
      if (!PLACEHOLDER_PATTERN.test(value) && !value.startsWith("${") && !value.startsWith("<")) {
        labels.add(match[1] ?? "secret assignment");
      }
    }
  }
  return [...labels];
}

function shouldScan(file) {
  return SCANNABLE_FILE.test(file) || [".npmrc", ".gitignore"].includes(basename(file));
}

export function main(args = process.argv.slice(2)) {
  const ciMode = args.includes("--ci");
  const files = ciMode
    ? splitNull(git(["ls-files", "-z"]))
    : splitNull(git(["diff", "--cached", "--name-only", "--diff-filter=ACM", "-z"]));
  const allTracked = splitNull(git(["ls-files", "-z"]));
  let failed = false;

  for (const file of allTracked) {
    if (!isForbiddenTrackedFile(file)) continue;
    console.error(`[secret-check] ❌ ${file}: sensitive file must not be tracked`);
    failed = true;
  }

  for (const file of files) {
    if (!shouldScan(file)) continue;
    let content;
    try {
      content = ciMode ? readFileSync(file, "utf8") : git(["show", `:${file}`]);
    } catch {
      continue;
    }
    if (content.includes("\0")) continue;
    const labels = findSecretLabels(content, !FIXTURE_PATH.test(file));
    for (const label of labels) {
      console.error(`[secret-check] ❌ ${file}: found ${label}`);
      failed = true;
    }
  }

  if (failed) {
    console.error("\n[secret-check] Blocked. Rotate exposed credentials and keep them in ignored environment files.");
    return 1;
  }
  console.log("[secret-check] ✅ No secrets found in scanned files.");
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main();
