import { access, copyFile, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(scriptDirectory, "..");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function generateSigningSecret() {
  return randomBytes(32).toString("base64url");
}

export async function setupLocal(root = defaultRoot, secret = generateSigningSecret()) {
  const workerDirectory = resolve(root, "apps/worker");
  const wranglerExamplePath = resolve(workerDirectory, "wrangler.example.jsonc");
  const wranglerPath = resolve(workerDirectory, "wrangler.jsonc");
  const varsExamplePath = resolve(workerDirectory, ".dev.vars.example");
  const varsPath = resolve(workerDirectory, ".dev.vars");
  const created = [];
  const kept = [];

  if (await exists(wranglerPath)) {
    kept.push("apps/worker/wrangler.jsonc");
  } else {
    await copyFile(wranglerExamplePath, wranglerPath);
    created.push("apps/worker/wrangler.jsonc");
  }

  if (await exists(varsPath)) {
    kept.push("apps/worker/.dev.vars");
  } else {
    const template = await readFile(varsExamplePath, "utf8");
    if (!template.includes("replace-with-a-random-secret")) {
      throw new Error("The .dev.vars template does not contain the expected secret placeholder.");
    }
    await writeFile(varsPath, template.replace("replace-with-a-random-secret", secret), {
      encoding: "utf8",
      mode: 0o600,
    });
    created.push("apps/worker/.dev.vars");
  }

  return { created, kept };
}

const isMainModule = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  try {
    const result = await setupLocal();
    for (const path of result.created) console.log(`[setup] Created ${path}`);
    for (const path of result.kept) console.log(`[setup] Kept existing ${path}`);
    console.log("[setup] Local configuration is ready. Next: pnpm dev");
  } catch (error) {
    console.error(`[setup] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
