import { createVpsServerRuntime } from "./runtime/server-runtime.js";
import type { VpsServerRuntime } from "./runtime/server-runtime.js";
import { readVpsRuntimeConfig } from "./runtime/config.js";
import { pathToFileURL } from "node:url";
import path from "node:path";

const PRIVATE_UMASK = 0o077;

function configureVpsProcess(): void {
  if (process.platform !== "win32") process.umask(PRIVATE_UMASK);
}

export async function main(
  runtime: VpsServerRuntime = createVpsServerRuntime(readVpsRuntimeConfig()),
): Promise<void> {
  let shutdown: Promise<void> | null = null;
  const handlers = new Map<NodeJS.Signals, () => void>();
  const requestShutdown = () => {
    if (shutdown) return;
    shutdown = runtime.stop();
    void shutdown.then(
      () => process.exit(0),
      (error: unknown) => {
        console.error("VPS shutdown failed", error);
        process.exit(1);
      },
    );
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const handler = () => requestShutdown();
    handlers.set(signal, handler);
    process.once(signal, handler);
  }

  try {
    await runtime.start();
  } catch (error) {
    for (const [signal, handler] of handlers) process.off(signal, handler);
    throw error;
  }
}

export function isDirectExecution(moduleUrl: string, entry = process.argv[1]): boolean {
  return typeof entry === "string" && pathToFileURL(path.resolve(entry)).href === moduleUrl;
}

if (isDirectExecution(import.meta.url)) {
  try {
    configureVpsProcess();
    await main();
  } catch (error) {
    console.error("VPS startup failed", error);
    process.exit(1);
  }
}
