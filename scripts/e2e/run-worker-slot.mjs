import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");

export function parseSlotArgument(value) {
  const slot = Number(value);
  if (!Number.isSafeInteger(slot) || slot < 0 || slot > 255) {
    throw new TypeError("E2E slot must be an integer between 0 and 255");
  }
  return slot;
}

export function logPathForSlot(slot, root = repoRoot) {
  return resolve(root, "apps", "portal", "e2e", ".logs", `worker-slot-${slot}.log`);
}

function slotSetting(environment, name, fallback) {
  const value = environment[name] ?? fallback;
  if (typeof value !== "string" || !value) throw new TypeError(`${name} must be set`);
  return value;
}

function writeEvent(log, label, message) {
  log.write(`${new Date().toISOString()} [${label}] ${message}\n`);
}

function writeOutput(log, label, channel, chunk) {
  writeEvent(log, label, `${channel}:`);
  log.write(chunk);
  if (!chunk.toString().endsWith("\n")) log.write("\n");
}

/**
 * Runs exactly one child and leaves an append-only account of its output and
 * termination in `logPath`. It deliberately neither restarts nor masks a
 * failed child: the caller receives its actual exit result.
 */
export async function runLoggedCommand({ command, args, cwd, logPath, label, append = false, env = process.env }) {
  await mkdir(dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath, { flags: append ? "a" : "w" });
  try {
    return await new Promise((resolveResult) => {
      let settled = false;
      let child;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        process.off("SIGINT", onSigint);
        process.off("SIGTERM", onSigterm);
        writeEvent(log, label, `exit code=${result.code ?? "none"} signal=${result.signal ?? "none"}`);
        resolveResult(result);
      };
      const forwardSignal = (signal) => {
        writeEvent(log, label, `received ${signal}; forwarding to child`);
        if (child?.exitCode === null && child.signalCode === null) child.kill(signal);
      };
      const onSigint = () => forwardSignal("SIGINT");
      const onSigterm = () => forwardSignal("SIGTERM");

      try {
        child = spawn(command, args, {
          cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        writeEvent(log, label, `spawn error=${String(error)}`);
        finish({ code: 1, signal: null, pid: null });
        return;
      }

      writeEvent(log, label, `pid=${child.pid ?? "none"}`);
      child.stdout?.on("data", (chunk) => {
        writeOutput(log, label, "stdout", chunk);
        process.stdout.write(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        writeOutput(log, label, "stderr", chunk);
        process.stderr.write(chunk);
      });
      child.once("error", (error) => {
        writeEvent(log, label, `spawn error=${String(error)}`);
        finish({ code: 1, signal: null, pid: child.pid ?? null });
      });
      child.once("close", (code, signal) => finish({ code, signal, pid: child.pid ?? null }));
      process.once("SIGINT", onSigint);
      process.once("SIGTERM", onSigterm);
    });
  } finally {
    log.end();
    await finished(log);
  }
}

export async function runWorkerSlot(slot, root = repoRoot, environment = process.env) {
  const port = slotSetting(environment, "E2E_SLOT_PORT", String(8787 + slot));
  const inspectorPort = slotSetting(environment, "E2E_SLOT_INSPECTOR_PORT", String(9329 + slot));
  const origin = slotSetting(environment, "E2E_SLOT_ORIGIN", `http://127.0.0.1:${port}`);
  const persistPath = resolve(root, "apps", "portal", "e2e", ".state", "slots", `slot-${slot}`, "wrangler");
  const logPath = logPathForSlot(slot, root);
  const slotEnvironment = {
    ...environment,
    WRANGLER_LOG_PATH: resolve(dirname(logPath), `slot-${slot}-config.debug.log`),
  };
  const preparePath = resolve(root, "scripts", "e2e", "prepare-slot.mjs");
  const serverPath = resolve(root, "scripts", "e2e", "serve-worker-slot.mjs");
  const configPath = resolve(root, "scripts", "e2e", "wrangler.e2e.jsonc");
  const workerBundlePath = resolve(root, "apps", "cloudflare", "dist", "worker.mjs");

  /* Run the immutable deployment bundle directly in workerd. Wrangler's dev
     proxy has its own pooled HTTP hop, where an expired connection can kill
     the whole dev session. E2E needs neither that hop nor a source watcher. */
  await access(workerBundlePath);

  const prepared = await runLoggedCommand({
    command: process.execPath,
    args: [preparePath, String(slot)],
    cwd: root,
    logPath,
    label: "prepare-slot",
    env: slotEnvironment,
  });
  if (prepared.code !== 0 || prepared.signal !== null) return prepared.code ?? 1;

  const served = await runLoggedCommand({
    command: process.execPath,
    args: [serverPath, JSON.stringify({
      configPath,
      workerBundlePath,
      persistPath,
      name: `infini-guild-e2e-${slot}`,
      port: Number(port),
      inspectorPort: Number(inspectorPort),
      origin,
    })],
    cwd: root,
    logPath,
    label: "workerd",
    append: true,
    env: slotEnvironment,
  });
  return served.code ?? 1;
}

const isMainModule = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  try {
    process.exitCode = await runWorkerSlot(parseSlotArgument(process.argv[2]));
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}
