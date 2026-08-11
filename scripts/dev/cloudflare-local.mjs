import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(scriptDirectory, "../..");

export function parseCloudflareLocalAction(args) {
  if (args.length !== 1 || !["migrate", "seed", "serve"].includes(args[0])) {
    throw new TypeError("Usage: node scripts/dev/cloudflare-local.mjs migrate|seed|serve");
  }
  return args[0];
}

export function deriveLocalStateVersion(manifest) {
  if (!Array.isArray(manifest) || manifest.length === 0) {
    throw new TypeError("Migration manifest must be a non-empty array");
  }
  const entries = manifest.map((candidate, ordinal) => {
    if (
      candidate === null
      || typeof candidate !== "object"
      || candidate.ordinal !== ordinal
      || typeof candidate.id !== "string"
      || typeof candidate.checksum !== "string"
      || !/^[0-9a-f]{64}$/.test(candidate.checksum)
    ) {
      throw new TypeError(`Migration manifest entry ${ordinal} is invalid`);
    }
    return `${candidate.ordinal}:${candidate.id}:${candidate.checksum}`;
  });
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

export async function cloudflareLocalPaths(root = defaultRoot) {
  const manifestPath = resolve(
    root,
    "packages/persistence-sqlite/src/migrations/generated/manifest.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const stateVersion = deriveLocalStateVersion(manifest);
  const stateDirectory = stateVersion.slice(0, 16);
  return Object.freeze({
    cloudflareDirectory: resolve(root, "apps/cloudflare"),
    configPath: resolve(root, "apps/cloudflare/wrangler.jsonc"),
    seedPath: resolve(root, "scripts/dev/seed.sql"),
    statePath: resolve(root, "apps/cloudflare/.wrangler/local-state", stateDirectory),
    stateVersion,
  });
}

export function wranglerArguments(action, paths) {
  const shared = [
    "--local",
    "--persist-to",
    paths.statePath,
    "--config",
    paths.configPath,
  ];
  if (action === "migrate") return ["d1", "migrations", "apply", "DB", ...shared];
  if (action === "seed") {
    return ["d1", "execute", "DB", ...shared, "--file", paths.seedPath];
  }
  if (action === "serve") {
    return [
      "dev",
      ...shared,
      "--ip",
      "127.0.0.1",
      "--port",
      "8787",
      "--local-protocol",
      "http",
    ];
  }
  throw new TypeError("Cloudflare local action must be migrate, seed, or serve");
}

export function cloudflareMediaSeedArguments(paths, root = defaultRoot) {
  return [
    resolve(root, "node_modules/tsx/dist/cli.mjs"),
    resolve(root, "apps/cloudflare/scripts/seed-local-media.ts"),
    "--persist-to",
    paths.statePath,
  ];
}

export async function runCloudflareLocal(action, root = defaultRoot) {
  const paths = await cloudflareLocalPaths(root);
  const wranglerPath = resolve(root, "node_modules/wrangler/bin/wrangler.js");
  console.log(`[cloudflare-local] schema state ${paths.stateVersion.slice(0, 12)}`);
  await runChild(process.execPath, [wranglerPath, ...wranglerArguments(action, paths)], root);
  if (action === "seed") {
    await runChild(process.execPath, cloudflareMediaSeedArguments(paths, root), root, "media seed");
  }
  return 0;
}

function runChild(command, args, cwd, label = actionLabel(args)) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", windowsHide: true });
    const forward = (signal) => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    };
    const onSigint = () => forward("SIGINT");
    const onSigterm = () => forward("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    child.once("error", finishError);
    child.once("exit", finishExit);

    function cleanup() {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      child.off("error", finishError);
      child.off("exit", finishExit);
    }
    function finishError(error) {
      cleanup();
      rejectRun(error);
    }
    function finishExit(code, signal) {
      cleanup();
      if (code === 0) resolveRun(0);
      else rejectRun(new Error(
        signal
          ? `${label} stopped by ${signal}`
          : `${label} failed with exit code ${code ?? "unknown"}`,
      ));
    }
  });
}

function actionLabel(args) {
  return args.includes("migrations") ? "migration" : args.includes("execute") ? "seed" : "dev";
}

const isMainModule = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  try {
    const action = parseCloudflareLocalAction(process.argv.slice(2));
    await runCloudflareLocal(action);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
