import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Log, Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLoggedCommand } from "./run-worker-slot.mjs";
import { serveWorkerSlot } from "./serve-worker-slot.mjs";

vi.mock("miniflare", async (importOriginal) => ({
  ...await importOriginal<typeof import("miniflare")>(),
  Miniflare: vi.fn(),
}));

let directory: string;
let options: Parameters<typeof serveWorkerSlot>[0];
let ready: Promise<URL>;
let resolveReady: (url: URL) => void;
let rejectReady: (error: Error) => void;
const dispose = vi.fn(async () => {});

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "infini-e2e-runtime-"));
  const configPath = join(directory, "wrangler.json");
  const workerBundlePath = join(directory, "worker.mjs");
  await writeFile(configPath, JSON.stringify({
    name: "e2e-lifecycle",
    main: workerBundlePath,
    compatibility_date: "2026-07-28",
  }));
  await writeFile(workerBundlePath, 'export default { fetch() { return new Response("ready"); } };');
  options = {
    configPath, workerBundlePath, persistPath: join(directory, "state"),
    name: "e2e-lifecycle", port: 0, inspectorPort: 0, origin: "http://127.0.0.1:8987",
  };
  ready = new Promise<URL>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  dispose.mockClear();
  vi.mocked(Miniflare).mockImplementation(function () {
    return { ready, dispose } as unknown as Miniflare;
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(Log.prototype, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  vi.mocked(Miniflare).mockClear();
});

describe("immutable E2E runtime lifecycle", () => {
  it("disposes normally and removes signal listeners when stopped", async () => {
    const serving = serveWorkerSlot(options);
    const stopListener = process.listeners("SIGTERM").at(-1);
    resolveReady(new URL(options.origin));
    process.emit("SIGTERM");

    await serving;
    expect(dispose).toHaveBeenCalledOnce();
    expect(process.listeners("SIGTERM")).not.toContain(stopListener);
    expect(process.listeners("SIGINT")).not.toContain(stopListener);
  });

  it("disposes and fails if Miniflare recovers a crashed runtime", async () => {
    const serving = serveWorkerSlot(options);
    const rejected = expect(serving).rejects.toThrow("restarted unexpectedly");
    resolveReady(new URL(options.origin));
    const runtimeOptions = vi.mocked(Miniflare).mock.calls.at(-1)?.[0];
    await runtimeOptions?.unsafeHandleRuntimeRestart?.();

    await rejected;
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("disposes and propagates runtime errors even while startup is pending", async () => {
    const error = new Error("The Workers runtime failed to restart");
    const serving = serveWorkerSlot(options);
    const rejected = expect(serving).rejects.toBe(error);
    const runtimeOptions = vi.mocked(Miniflare).mock.calls.at(-1)?.[0];
    runtimeOptions?.log?.error(error);

    await rejected;
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("disposes after a startup rejection", async () => {
    const error = new Error("invalid compiled worker");
    const serving = serveWorkerSlot(options);
    const rejected = expect(serving).rejects.toBe(error);
    rejectReady(error);

    await rejected;
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("returns a real non-zero process exit when the runtime cannot start", async () => {
    const invalidConfigPath = join(directory, "missing-config.json");
    await mkdir(join(directory, "logs"));
    const result = await runLoggedCommand({
      command: process.execPath,
      args: [join(process.cwd(), "scripts/e2e/serve-worker-slot.mjs"), JSON.stringify({
        ...options, configPath: invalidConfigPath,
      })],
      cwd: directory,
      logPath: join(directory, "logs/startup.log"),
      label: "startup",
      env: { ...process.env, WRANGLER_LOG_PATH: join(directory, "logs/config.log") },
    });

    expect(result).toMatchObject({ code: 1, signal: null });
  });
});
