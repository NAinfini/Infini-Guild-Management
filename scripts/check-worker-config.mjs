import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

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
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
    } else if (character === "\"") {
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
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
    } else if (character === "\"") {
      inString = true;
    }
  }

  return JSON.parse(withoutTrailingCommas);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasPlaceholder(value) {
  return typeof value === "string"
    && /(YOUR_[A-Z0-9_]+|[A-Z0-9_]+_HERE|replace-with)/i.test(value);
}

function validateBinding(bindings, bindingName, requiredFields, label, errors) {
  if (!Array.isArray(bindings)) {
    errors.push(`${label} binding list is missing.`);
    return;
  }

  const binding = bindings.find((item) => isObject(item) && item.binding === bindingName);
  if (!binding) {
    errors.push(`${label} binding "${bindingName}" is missing.`);
    return;
  }

  for (const field of requiredFields) {
    const value = binding[field];
    if (typeof value !== "string" || !value.trim()) {
      errors.push(`${label} ${field} is empty.`);
    } else if (hasPlaceholder(value)) {
      errors.push(`${label} ${field} still contains placeholder "${value}".`);
    }
  }
}

function hasEnabledSampledChannel(observability, channel) {
  const settings = isObject(observability[channel]) ? observability[channel] : {};
  const rate = settings.head_sampling_rate;
  return settings.enabled === true
    && typeof rate === "number"
    && rate > 0
    && rate <= 1;
}

export function validateWorkerConfig(config, environment, options = {}) {
  // allowPlaceholders lets CI validate the tracked template itself, where
  // unresolved YOUR_* resource IDs are the expected state. Every structural
  // rule still applies; only "still contains placeholder" findings are waived.
  const { allowPlaceholders = false } = options;
  const errors = [];

  if (environment !== "production") {
    return [`--env must be "production"; received "${environment || "missing"}".`];
  }

  const environmentMap = isObject(config.env) ? config.env : {};
  const target = environmentMap[environment];
  if (!isObject(target)) {
    return [`env.${environment} is missing from the Wrangler config.`];
  }

  const vars = isObject(target.vars) ? target.vars : {};
  if (vars.ENVIRONMENT !== environment) {
    errors.push(`env.${environment}.vars.ENVIRONMENT must be "${environment}".`);
  }

  for (const variableName of ["SITE_NAME", "SITE_LOGO_URL"]) {
    const value = vars[variableName];
    if (typeof value !== "string" || !value.trim()) {
      errors.push(`env.${environment}.vars.${variableName} is empty.`);
    } else if (hasPlaceholder(value)) {
      errors.push(`env.${environment}.vars.${variableName} still contains placeholder "${value}".`);
    }
  }

  validateBinding(
    target.d1_databases,
    "DB",
    ["database_name", "database_id"],
    `env.${environment} D1`,
    errors,
  );
  validateBinding(
    target.r2_buckets,
    "MEDIA",
    ["bucket_name"],
    `env.${environment} R2`,
    errors,
  );

  const durableObjects = isObject(target.durable_objects) ? target.durable_objects : {};
  const wsBinding = Array.isArray(durableObjects.bindings)
    ? durableObjects.bindings.find((binding) => isObject(binding) && binding.name === "WS")
    : undefined;
  if (!isObject(wsBinding) || wsBinding.class_name !== "WebSocketDO") {
    errors.push(`env.${environment} Durable Object binding "WS" must target WebSocketDO.`);
  }

  if (vars.MEDIA_ORPHAN_DELETE_MODE !== "report" && vars.MEDIA_ORPHAN_DELETE_MODE !== "delete") {
    errors.push(`env.${environment}.vars.MEDIA_ORPHAN_DELETE_MODE must be "report" or "delete".`);
  }

  const portalOrigin = vars.PORTAL_ORIGIN;
  if (typeof portalOrigin !== "string") {
    errors.push(`env.${environment}.vars.PORTAL_ORIGIN must be present (empty string for same-origin deployments).`);
  } else if (portalOrigin !== "") {
    // The worker compares request origins against this value verbatim, so a
    // path or trailing slash would silently never match.
    let parsedOrigin;
    try {
      parsedOrigin = new URL(portalOrigin);
    } catch {
      parsedOrigin = undefined;
    }
    if (!parsedOrigin
      || (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:")
      || parsedOrigin.pathname !== "/"
      || parsedOrigin.search !== ""
      || parsedOrigin.hash !== ""
      || portalOrigin.endsWith("/")) {
      errors.push(`env.${environment}.vars.PORTAL_ORIGIN must be a bare http(s) origin like "https://portal.example.com" (no path, query, or trailing slash), or empty for same-origin.`);
    }
  }

  if (vars.PBKDF2_ITERATIONS !== undefined && vars.PBKDF2_ITERATIONS !== "") {
    const iterations = Number(vars.PBKDF2_ITERATIONS);
    if (typeof vars.PBKDF2_ITERATIONS !== "string"
      || !/^\d+$/.test(vars.PBKDF2_ITERATIONS)
      || iterations < 1_000
      || iterations > 10_000_000) {
      errors.push(`env.${environment}.vars.PBKDF2_ITERATIONS must be an integer between 1000 and 10000000 when set.`);
    }
  }

  const assets = isObject(target.assets) ? target.assets : {};
  if (assets.binding !== "ASSETS"
    || assets.not_found_handling !== "single-page-application"
    || assets.run_worker_first !== true
    || typeof assets.directory !== "string"
    || !assets.directory.trim()) {
    errors.push(`env.${environment} SPA assets binding is incomplete.`);
  }

  const observability = isObject(target.observability) ? target.observability : {};
  if (observability.enabled !== true || !hasEnabledSampledChannel(observability, "logs")) {
    errors.push(`env.${environment}.observability.logs must be enabled with a sampling rate in (0, 1].`);
  }
  if (observability.enabled !== true || !hasEnabledSampledChannel(observability, "traces")) {
    errors.push(`env.${environment}.observability.traces must be enabled with a sampling rate in (0, 1].`);
  }

  const triggerConfig = isObject(target.triggers)
    ? target.triggers
    : (isObject(config.triggers) ? config.triggers : {});
  const crons = Array.isArray(triggerConfig.crons) ? triggerConfig.crons : [];
  for (const requiredCron of ["0 0 * * *", "*/15 * * * *"]) {
    if (!crons.includes(requiredCron)) {
      errors.push(`env.${environment} cron schedule "${requiredCron}" is missing.`);
    }
  }

  const secretConfig = isObject(target.secrets)
    ? target.secrets
    : (isObject(config.secrets) ? config.secrets : {});
  if (!Array.isArray(secretConfig.required) || !secretConfig.required.includes("SIGNING_SECRET")) {
    errors.push(`env.${environment} must declare SIGNING_SECRET in secrets.required.`);
  }

  const activeRoutes = Array.isArray(target.routes)
    ? target.routes.filter((route) => isObject(route) && !hasPlaceholder(route.pattern))
    : [];
  if (target.workers_dev !== true && activeRoutes.length === 0) {
    errors.push(`env.${environment} needs workers_dev: true or a configured custom-domain route.`);
  }

  return allowPlaceholders
    ? errors.filter((error) => !error.includes("still contains placeholder"))
    : errors;
}

function parseArguments(argv) {
  const envArgument = argv.find((argument) => argument.startsWith("--env="));
  const configArgument = argv.find((argument) => argument.startsWith("--config="));
  return {
    environment: envArgument?.slice("--env=".length) ?? "",
    configPath: resolve(repositoryRoot, configArgument?.slice("--config=".length) ?? "apps/worker/wrangler.jsonc"),
    allowPlaceholders: argv.includes("--allow-placeholders"),
  };
}

export async function runPreflight(argv = process.argv.slice(2)) {
  const { environment, configPath, allowPlaceholders } = parseArguments(argv);

  try {
    await access(configPath);
  } catch {
    throw new Error(
      `[config] ${configPath} not found.\n`
      + "  Run `pnpm setup:local` first, then configure your Cloudflare resources.",
    );
  }

  let config;
  try {
    config = parseJsonc(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(`[config] Could not parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const errors = validateWorkerConfig(config, environment, { allowPlaceholders });
  if (errors.length > 0) {
    throw new Error(
      `[config] ${environment || "target"} configuration is not ready:\n`
      + errors.map((error) => `  - ${error}`).join("\n"),
    );
  }

  return { environment, configPath };
}

const isMainModule = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  try {
    const result = await runPreflight();
    console.log(`[config] ${result.environment} configuration is ready.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
