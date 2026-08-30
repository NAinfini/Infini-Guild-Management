import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(scriptDirectory, "..");

async function writeIfMissing(path, content) {
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") return false;
    throw error;
  }
}

export function parseSetupArguments(args) {
  if (args.length !== 2 || args[0] !== "--runtime") {
    throw new TypeError("Usage: pnpm setup:local --runtime cloudflare|vps");
  }
  if (args[1] !== "cloudflare" && args[1] !== "vps") {
    throw new TypeError("--runtime must be cloudflare or vps");
  }
  return args[1];
}

export async function setupLocal({
  runtime,
  root = defaultRoot,
}) {
  if (runtime !== "cloudflare" && runtime !== "vps") {
    throw new TypeError("runtime must be cloudflare or vps");
  }
  const created = [];
  const kept = [];

  if (runtime === "cloudflare") {
    const directory = resolve(root, "apps/cloudflare");
    const configPath = resolve(directory, "wrangler.jsonc");
    const configTemplate = await readFile(resolve(directory, "wrangler.example.jsonc"), "utf8");
    if (await writeIfMissing(configPath, configTemplate
        .replaceAll("https://replace-with-public-origin.example", "http://localhost:5173")
        .replaceAll("https://replace-with-allowed-origin.example", "http://localhost:5173"))) {
      created.push("apps/cloudflare/wrangler.jsonc");
    } else {
      kept.push("apps/cloudflare/wrangler.jsonc");
    }

    const variablesPath = resolve(directory, ".dev.vars");
    const variablesTemplate = await readFile(resolve(directory, ".dev.vars.example"), "utf8");
    if (await writeIfMissing(variablesPath, variablesTemplate)) {
      created.push("apps/cloudflare/.dev.vars");
    } else {
      kept.push("apps/cloudflare/.dev.vars");
    }
  } else {
    const variablesPath = resolve(root, "apps/vps/.env");
    const template = await readFile(resolve(root, "scripts/templates/vps.env.example"), "utf8");
    if (await writeIfMissing(variablesPath, template)) {
      created.push("apps/vps/.env");
    } else {
      kept.push("apps/vps/.env");
    }
  }

  return { created, kept };
}

const isMainModule = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  try {
    const runtime = parseSetupArguments(process.argv.slice(2));
    const result = await setupLocal({ runtime });
    for (const path of result.created) console.log(`[setup] Created ${path}`);
    for (const path of result.kept) console.log(`[setup] Kept existing ${path}`);
    console.log(`[setup] ${runtime} local configuration is ready.`);
  } catch (error) {
    console.error(`[setup] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
