import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LIMITS } from "@guild/shared/config/limits.ts";

const runtimeConfigScriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(runtimeConfigScriptDirectory, "..");
/*
 * 限流额度的唯一事实来源是共享 LIMITS。wrangler 是静态平台配置、运行时读不到
 * LIMITS，预检强制它成为 LIMITS 的精确镜像——否则 Cloudflare 平台限流会和按
 * LIMITS 窗口计算的 Retry-After 脱节。
 */
export const RATE_LIMIT_EXPECTATIONS = {
  AUTH_RATE_LIMITER: LIMITS.rateLimit.auth,
  AUTH_IP_RATE_LIMITER: LIMITS.rateLimit.authIp,
  READ_RATE_LIMITER: LIMITS.rateLimit.reads,
  EXPENSIVE_READ_RATE_LIMITER: LIMITS.rateLimit.expensiveReads,
  MUTATION_RATE_LIMITER: LIMITS.rateLimit.mutations,
  UPLOAD_RATE_LIMITER: LIMITS.rateLimit.uploads,
  WEBSOCKET_RATE_LIMITER: LIMITS.websocket.handshakes,
};
const REQUIRED_SECRET_KEYS = ["IG_INVITE_TOKEN_SECRET", "IG_AUDIT_DOWNLOAD_SECRET"];
const SENSITIVE_ENV_KEYS = [
  "IG_INVITE_TOKEN_SECRET",
  "IG_AUDIT_DOWNLOAD_SECRET",
  "IG_OAUTH_GOOGLE_CLIENT_ID",
  "IG_OAUTH_GOOGLE_CLIENT_SECRET",
  "IG_OAUTH_DISCORD_CLIENT_ID",
  "IG_OAUTH_DISCORD_CLIENT_SECRET",
  "IG_OAUTH_KOOK_CLIENT_ID",
  "IG_OAUTH_KOOK_CLIENT_SECRET",
  "IG_OAUTH_WECHAT_APP_ID",
  "IG_OAUTH_WECHAT_APP_SECRET",
  "IG_CLOUDFLARE_EMAIL_API_TOKEN",
];
const OPTIONAL_CREDENTIAL_PAIRS = [
  ["IG_OAUTH_GOOGLE_CLIENT_ID", "IG_OAUTH_GOOGLE_CLIENT_SECRET"],
  ["IG_OAUTH_DISCORD_CLIENT_ID", "IG_OAUTH_DISCORD_CLIENT_SECRET"],
  ["IG_OAUTH_KOOK_CLIENT_ID", "IG_OAUTH_KOOK_CLIENT_SECRET"],
  ["IG_OAUTH_WECHAT_APP_ID", "IG_OAUTH_WECHAT_APP_SECRET"],
  ["IG_EMAIL_FROM", "IG_CLOUDFLARE_EMAIL_ACCOUNT_ID", "IG_CLOUDFLARE_EMAIL_API_TOKEN"],
];
const SHARED_MIGRATIONS_DIRECTORY = "../../packages/persistence-sqlite/src/migrations/generated";

export function parseJsonc(source) {
  source = source.replace(/^\uFEFF/, "");
  let result = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        result += character;
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      } else if (character === "\n") {
        result += character;
      }
      continue;
    }
    if (!inString && character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (!inString && character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    result += character;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
    }
  }

  let withoutTrailingCommas = "";
  inString = false;
  escaped = false;
  for (let index = 0; index < result.length; index += 1) {
    const character = result[index];
    if (!inString && character === ",") {
      let nextIndex = index + 1;
      while (/\s/.test(result[nextIndex] ?? "")) nextIndex += 1;
      if (result[nextIndex] === "}" || result[nextIndex] === "]") continue;
    }
    withoutTrailingCommas += character;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
    }
  }
  return JSON.parse(withoutTrailingCommas);
}

export function parseEnv(source) {
  const values = {};
  for (const [index, line] of source.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) throw new SyntaxError(`Invalid environment entry on line ${index + 1}`);
    const key = match[1];
    if (Object.hasOwn(values, key)) throw new SyntaxError(`Duplicate environment key: ${key}`);
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[key] = value;
  }
  return values;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function placeholder(value) {
  return typeof value === "string" && (
    /(?:replace-with|YOUR[_-]|CHANGE[_-]?ME|00000000-0000-0000-0000-000000000000)/i.test(value)
    || ["1001", "1002", "1003", "1004", "1005"].includes(value)
  );
}

function requiredString(object, key, label, errors, options) {
  const value = object[key];
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${label}.${key} is required.`);
  } else if (!options.allowPlaceholders && placeholder(value)) {
    errors.push(`${label}.${key} still contains a placeholder.`);
  }
  return typeof value === "string" ? value : "";
}

function validateIterations(value, label, errors) {
  if (value === undefined || value === "") return;
  const iterations = Number(value);
  if (typeof value !== "string" || !/^\d+$/.test(value)
    || !Number.isSafeInteger(iterations) || iterations < 10_000 || iterations > 10_000_000) {
    errors.push(`${label}.IG_PBKDF2_ITERATIONS must be an integer between 10000 and 10000000.`);
  }
}

function validOrigin(value, requireHttps) {
  try {
    const url = new URL(value);
    const loopbackHttp = url.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
    return (!requireHttps || url.protocol === "https:" || loopbackHttp)
      && (url.protocol === "http:" || url.protocol === "https:")
      && !url.username && !url.password
      && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function validateCloudflareConfig(config, options = {}) {
  const settings = { allowPlaceholders: options.allowPlaceholders === true };
  const errors = [];
  if (!isObject(config)) return ["Cloudflare config must be an object."];
  requiredString(config, "name", "cloudflare", errors, settings);
  if (config.main !== "src/index.ts") errors.push("cloudflare.main must be src/index.ts.");
  // Worker 通过 AsyncLocalStorage 取请求域 ExecutionContext；缺这个标志
  // workerd 直接拒绝加载产物，必须在构建期拦下来。
  const compatibilityFlags = Array.isArray(config.compatibility_flags) ? config.compatibility_flags : [];
  if (!compatibilityFlags.includes("nodejs_als")) {
    errors.push('cloudflare.compatibility_flags must include "nodejs_als" for AsyncLocalStorage support.');
  }

  const assets = isObject(config.assets) ? config.assets : {};
  if (assets.binding !== "ASSETS" || assets.run_worker_first !== true
    || assets.html_handling !== "none" || assets.not_found_handling !== "none") {
    errors.push("Cloudflare ASSETS binding must route through the Worker with native HTML fallbacks disabled.");
  }
  requiredString(assets, "directory", "cloudflare.assets", errors, settings);

  const d1 = Array.isArray(config.d1_databases)
    ? config.d1_databases.find((entry) => isObject(entry) && entry.binding === "DB")
    : undefined;
  if (!isObject(d1)) errors.push('Cloudflare D1 binding "DB" is missing.');
  else {
    requiredString(d1, "database_name", "cloudflare.DB", errors, settings);
    requiredString(d1, "database_id", "cloudflare.DB", errors, settings);
    if (d1.migrations_dir !== SHARED_MIGRATIONS_DIRECTORY) {
      errors.push(`cloudflare.DB.migrations_dir must be ${SHARED_MIGRATIONS_DIRECTORY}.`);
    }
    if (d1.remote !== false) errors.push("cloudflare.DB.remote must be false for local-safe configuration.");
  }

  const r2 = Array.isArray(config.r2_buckets)
    ? config.r2_buckets.find((entry) => isObject(entry) && entry.binding === "BLOBS")
    : undefined;
  if (!isObject(r2)) errors.push('Cloudflare R2 binding "BLOBS" is missing.');
  else {
    requiredString(r2, "bucket_name", "cloudflare.BLOBS", errors, settings);
    if (r2.remote !== false) errors.push("cloudflare.BLOBS.remote must be false for local-safe configuration.");
  }

  const durableBindings = isObject(config.durable_objects) && Array.isArray(config.durable_objects.bindings)
    ? config.durable_objects.bindings
    : [];
  if (!durableBindings.some((entry) => isObject(entry)
    && entry.name === "NOTIFICATIONS" && entry.class_name === "CloudflareNotificationDurableObject")) {
    errors.push('Cloudflare Durable Object binding "NOTIFICATIONS" is missing or targets the wrong class.');
  }
  if (!Array.isArray(config.migrations) || !config.migrations.some((entry) => isObject(entry)
    && Array.isArray(entry.new_sqlite_classes)
    && entry.new_sqlite_classes.includes("CloudflareNotificationDurableObject"))) {
    errors.push("Cloudflare Durable Object SQLite migration is missing.");
  }

  const rateLimits = Array.isArray(config.ratelimits) ? config.ratelimits : [];
  for (const [binding, expected] of Object.entries(RATE_LIMIT_EXPECTATIONS)) {
    const entry = rateLimits.find((candidate) => isObject(candidate) && candidate.name === binding);
    if (!isObject(entry)) {
      errors.push(`Cloudflare rate limiter ${binding} is missing.`);
      continue;
    }
    requiredString(entry, "namespace_id", `cloudflare.${binding}`, errors, settings);
    const simple = isObject(entry.simple) ? entry.simple : {};
    const expectedPeriod = expected.windowMs / 1000;
    if (simple.limit !== expected.maxRequests || simple.period !== expectedPeriod) {
      errors.push(
        `Cloudflare rate limiter ${binding} must mirror shared LIMITS: limit ${expected.maxRequests}, period ${expectedPeriod}s.`,
      );
    }
  }

  const crons = isObject(config.triggers) && Array.isArray(config.triggers.crons)
    ? config.triggers.crons
    : [];
  for (const cron of ["*/15 * * * *", "0 0 * * *"]) {
    if (!crons.includes(cron)) errors.push(`Cloudflare cron schedule ${cron} is missing.`);
  }

  const vars = isObject(config.vars) ? config.vars : {};
  const publicUrl = requiredString(vars, "IG_PUBLIC_URL", "cloudflare.vars", errors, settings);
  if (publicUrl && !validOrigin(publicUrl, true)) {
    errors.push("cloudflare.vars.IG_PUBLIC_URL must be a root HTTPS origin, except for loopback local development.");
  }
  for (const key of SENSITIVE_ENV_KEYS) {
    if (Object.hasOwn(vars, key)) errors.push(`cloudflare.vars.${key} must use Wrangler secret storage, not vars.`);
  }
  validateIterations(vars.IG_PBKDF2_ITERATIONS, "cloudflare.vars", errors);
  const emailBindings = Array.isArray(config.send_email) ? config.send_email : [];
  const hasEmailBinding = emailBindings.some((entry) => isObject(entry) && entry.name === "EMAIL");
  const hasEmailFrom = Boolean(optionalString(vars, "IG_EMAIL_FROM", settings));
  if (hasEmailBinding !== hasEmailFrom) {
    errors.push("cloudflare EMAIL send_email binding and vars.IG_EMAIL_FROM must be configured together.");
  }
  if (config.workers_dev !== true && !Array.isArray(config.routes)) {
    errors.push("Cloudflare config needs workers_dev: true or a routes list.");
  }
  return errors;
}

export function validateVpsConfig(config, options = {}) {
  const settings = { allowPlaceholders: options.allowPlaceholders === true };
  const errors = [];
  if (!isObject(config)) return ["VPS config must be an environment map."];
  const publicUrl = requiredString(config, "IG_PUBLIC_URL", "vps", errors, settings);
  // 与 VPS 运行时同一条规则：非回环地址必须 HTTPS，预检不得放行运行时会拒绝的配置。
  if (publicUrl && !validOrigin(publicUrl, true)) {
    errors.push("vps.IG_PUBLIC_URL must be a root HTTPS origin, except for loopback local development.");
  }
  for (const key of REQUIRED_SECRET_KEYS) {
    const value = requiredString(config, key, "vps", errors, settings);
    if (value && !settings.allowPlaceholders && new TextEncoder().encode(value).byteLength < 32) {
      errors.push(`vps.${key} must contain at least 32 UTF-8 bytes.`);
    }
  }
  for (const key of ["IG_DATABASE_PATH", "IG_BLOB_PATH", "IG_STATIC_PATH"]) {
    requiredString(config, key, "vps", errors, settings);
  }
  validateIterations(config.IG_PBKDF2_ITERATIONS, "vps", errors);
  validateCredentialPairs(config, "vps", errors, settings);
  if (config.IG_PORT !== undefined) {
    const port = Number(config.IG_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) errors.push("vps.IG_PORT must be an integer from 1 to 65535.");
  }
  return errors;
}

function validateCredentialPairs(config, label, errors, settings) {
  for (const keys of OPTIONAL_CREDENTIAL_PAIRS) {
    const configured = keys.map((key) => Boolean(optionalString(config, key, settings)));
    if (configured.some(Boolean) && !configured.every(Boolean)) {
      errors.push(`${label}.${keys.join(", ")} must be configured together.`);
    }
  }
}

function optionalString(config, key, settings) {
  const value = config[key];
  if (typeof value !== "string" || !value.trim()) return undefined;
  return settings.allowPlaceholders && value.includes("replace-with-") ? undefined : value.trim();
}

function parseArguments(argv) {
  const runtimeIndex = argv.indexOf("--runtime");
  const configIndex = argv.indexOf("--config");
  const runtime = runtimeIndex >= 0 ? argv[runtimeIndex + 1] : undefined;
  if (runtime !== "cloudflare" && runtime !== "vps") {
    throw new TypeError("--runtime must be cloudflare or vps");
  }
  const fallback = runtime === "cloudflare" ? "apps/cloudflare/wrangler.jsonc" : "apps/vps/.env";
  return {
    runtime,
    configPath: resolve(repositoryRoot, configIndex >= 0 ? argv[configIndex + 1] : fallback),
    allowPlaceholders: argv.includes("--allow-placeholders"),
  };
}

export async function runPreflight(argv = process.argv.slice(2)) {
  const { runtime, configPath, allowPlaceholders } = parseArguments(argv);
  try {
    await access(configPath);
  } catch {
    throw new Error(`[config] ${configPath} not found. Run pnpm setup:local --runtime ${runtime}.`);
  }
  const source = await readFile(configPath, "utf8");
  let config;
  try {
    config = runtime === "cloudflare" ? parseJsonc(source) : parseEnv(source);
  } catch (error) {
    throw new Error(`[config] Could not parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (runtime === "cloudflare") {
    const { unstable_readConfig: readWranglerConfig } = await import("wrangler");
    readWranglerConfig({ config: configPath }, { hideWarnings: true });
  }
  const errors = runtime === "cloudflare"
    ? validateCloudflareConfig(config, { allowPlaceholders })
    : validateVpsConfig(config, { allowPlaceholders });
  if (errors.length > 0) {
    throw new Error(`[config] ${runtime} configuration is not ready:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }
  const publicUrl = runtime === "cloudflare" ? config.vars?.IG_PUBLIC_URL : config.IG_PUBLIC_URL;
  return { runtime, configPath, oauthCallbacks: oauthCallbackUrls(publicUrl) };
}

export function oauthCallbackUrls(publicUrl) {
  const origin = new URL(publicUrl).origin;
  return Object.freeze({
    google: new URL("/api/auth/oauth/google/callback", origin).toString(),
    discord: new URL("/api/auth/oauth/discord/callback", origin).toString(),
    kook: new URL("/api/auth/oauth/kook/callback", origin).toString(),
  });
}

const isMainModule = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  try {
    const result = await runPreflight();
    console.log(`[config] ${result.runtime} configuration is ready.`);
    for (const [provider, callback] of Object.entries(result.oauthCallbacks)) {
      console.log(`[config] ${provider} OAuth callback: ${callback}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
