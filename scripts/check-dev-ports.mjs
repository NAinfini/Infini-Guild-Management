import { createServer } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RUNTIME_ENDPOINTS = Object.freeze({
  cloudflare: Object.freeze([
    Object.freeze({
      label: "Cloudflare backend",
      host: "127.0.0.1",
      port: 8787,
      url: "http://localhost:8787",
    }),
    Object.freeze({
      label: "Portal/Vite",
      host: "127.0.0.1",
      port: 5173,
      url: "http://localhost:5173",
    }),
  ]),
  vps: Object.freeze([
    Object.freeze({
      label: "VPS backend",
      host: "127.0.0.1",
      port: 8787,
      url: "http://localhost:8787",
    }),
    Object.freeze({
      label: "Portal/Vite",
      host: "127.0.0.1",
      port: 5173,
      url: "http://localhost:5173",
    }),
  ]),
});

export function parseRuntime(args) {
  if (args.length !== 2 || args[0] !== "--runtime") {
    throw new TypeError("Usage: node scripts/check-dev-ports.mjs --runtime cloudflare|vps");
  }
  if (args[1] !== "cloudflare" && args[1] !== "vps") {
    throw new TypeError("--runtime must be cloudflare or vps");
  }
  return args[1];
}

export function endpointsForRuntime(runtime) {
  const endpoints = RUNTIME_ENDPOINTS[runtime];
  if (!endpoints) throw new TypeError("runtime must be cloudflare or vps");
  return endpoints;
}

async function assertEndpointAvailable(runtime, endpoint) {
  await new Promise((resolveCheck, rejectCheck) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      const reason = error?.code === "EADDRINUSE"
        ? "already in use"
        : `unavailable (${error?.code ?? error})`;
      rejectCheck(new Error(
        `[dev] Cannot start ${runtime}: ${endpoint.label} port ${endpoint.port} is ${reason}.\n`
        + `       Stop the process using ${endpoint.url}, then run pnpm ${runtime} dev again.\n`
        + "       Dev ports are fixed so origins, cookies, API proxying, and WebSockets stay consistent.",
      ));
    });
    server.listen({ host: endpoint.host, port: endpoint.port, exclusive: true }, () => {
      server.close((error) => error ? rejectCheck(error) : resolveCheck());
    });
  });
}

export async function checkDevPorts(runtime, endpoints = endpointsForRuntime(runtime)) {
  await Promise.all(endpoints.map((endpoint) => assertEndpointAvailable(runtime, endpoint)));
  return endpoints;
}

const isMainModule = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  try {
    const runtime = parseRuntime(process.argv.slice(2));
    const endpoints = await checkDevPorts(runtime);
    console.log(`[dev] ${runtime} ports are available.`);
    console.log(`[dev] Open ${endpoints.at(-1).url} after the services report ready.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
