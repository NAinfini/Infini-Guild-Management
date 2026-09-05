import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Log, Miniflare, convertV4MiniflareOptions } from "miniflare";
import { unstable_getMiniflareWorkerOptions, unstable_readConfig } from "wrangler";

export function createRuntimeOptions({ configPath, workerBundlePath, persistPath, name, port, inspectorPort, origin }) {
  const config = unstable_readConfig({ config: configPath });
  const { workerOptions, externalWorkers } = unstable_getMiniflareWorkerOptions({
    ...config,
    name,
    vars: {
      ...config.vars,
      IG_PUBLIC_URL: origin,
      IG_ALLOWED_ORIGINS: origin,
      IG_PBKDF2_ITERATIONS: "10000",
    },
  });

  // Source globs have already been resolved by build:cloudflare. The runtime
  // receives that single compiled module, just as Wrangler's bundler emits it.
  delete workerOptions.modulesRules;

  // Wrangler's exported mapping uses V4 options; Miniflare's public converter
  // preserves its bindings in V5. Both packages are pinned to matching versions.
  return convertV4MiniflareOptions({
    host: "127.0.0.1",
    port,
    inspectorHost: "127.0.0.1",
    inspectorPort,
    resourcePersistencePath: resolve(persistPath, "v3"),
    workers: [{
      ...workerOptions,
      name,
      modulesRoot: dirname(workerBundlePath),
      modules: [{ type: "ESModule", path: workerBundlePath }],
    }, ...externalWorkers],
  });
}

export async function serveWorkerSlot(options) {
  const runtimeOptions = createRuntimeOptions(options);
  const { promise: stopped, resolve: stop, reject: fail } = Promise.withResolvers();
  const runtime = new Miniflare({
    ...runtimeOptions,
    log: new class extends Log {
      error(error) {
        super.error(error);
        fail(error);
      }
    }(),
    // Miniflare can recover a crashed development runtime. An immutable E2E
    // server must fail even when that recovery succeeds; errors fail it too.
    unsafeHandleRuntimeRestart() {
      fail(new Error("The E2E Workers runtime restarted unexpectedly."));
    },
  });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const url = await Promise.race([runtime.ready, stopped]);
    if (!url) return;
    console.log(`workerd ready at ${url.href}`);
    await stopped;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await runtime.dispose();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await serveWorkerSlot(JSON.parse(process.argv[2]));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
