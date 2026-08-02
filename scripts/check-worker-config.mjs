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

export function validateWorkerConfig(config, environment) {
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

  return errors;
}

function parseArguments(argv) {
  const envArgument = argv.find((argument) => argument.startsWith("--env="));
  const configArgument = argv.find((argument) => argument.startsWith("--config="));
  return {
    environment: envArgument?.slice("--env=".length) ?? "",
    configPath: resolve(repositoryRoot, configArgument?.slice("--config=".length) ?? "apps/worker/wrangler.jsonc"),
  };
}

export async function runPreflight(argv = process.argv.slice(2)) {
  const { environment, configPath } = parseArguments(argv);

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

  const errors = validateWorkerConfig(config, environment);
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
