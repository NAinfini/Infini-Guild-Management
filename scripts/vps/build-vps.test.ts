import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { buildVpsServer } from "./build-vps.mjs";
import { runVpsMigration } from "./migrate-vps.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cacheRoot = path.join(root, ".cache/vps-build-tests");

describe("VPS production bundle", () => {
  it("starts under plain Node and serves health and authenticated WebSocket heartbeats", async () => {
    await mkdir(cacheRoot, { recursive: true });
    const directory = await mkdtemp(path.join(cacheRoot, "run-"));
    let server: ChildProcessWithoutNullStreams | undefined;
    let socket: WebSocket | undefined;
    try {
      const bundle = path.join(directory, "server.mjs");
      const databasePath = path.join(directory, "data/app.sqlite");
      await buildVpsServer(bundle);
      await runVpsMigration(["--database", databasePath]);
      const token = seedSession(databasePath);
      const port = await availablePort();
      const origin = `http://127.0.0.1:${port}`;
      const staticPath = path.join(directory, "static");
      await mkdir(staticPath);
      server = spawn(process.execPath, [bundle], {
        cwd: root,
        windowsHide: true,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          IG_PUBLIC_URL: origin,
          IG_ALLOWED_ORIGINS: origin,
          IG_SESSION_COOKIE_NAME: "ig_bundle_session",
          IG_PBKDF2_ITERATIONS: "10000",
          IG_HOST: "127.0.0.1",
          IG_PORT: String(port),
          IG_DATABASE_PATH: databasePath,
          IG_BLOB_PATH: path.join(directory, "data/blobs"),
          IG_STATIC_PATH: staticPath,
          IG_MAINTENANCE_MODE: "off",
        },
      });
      await waitForListening(server);

      const health = await fetch(`${origin}/api/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ ok: true });
      expect((await fetch(`${origin}/ws`)).status).toBe(426);

      socket = new WebSocket(`${origin.replace("http:", "ws:")}/ws`, {
        origin,
        headers: { Cookie: `ig_bundle_session=${token}` },
      });
      await once(socket, "open", { signal: AbortSignal.timeout(5_000) });
      const acknowledgement = once(socket, "message", { signal: AbortSignal.timeout(5_000) });
      socket.send(JSON.stringify({ type: "heartbeat", tab_id: "bundle-smoke", seq: 1, sent_at: new Date().toISOString() }));
      const [message] = await acknowledgement;
      expect(JSON.parse(String(message))).toMatchObject({
        type: "heartbeat_ack", tab_id: "bundle-smoke", seq: 1, connections: 1,
      });
      const closed = once(socket, "close", { signal: AbortSignal.timeout(5_000) });
      socket.close(1000, "test complete");
      await closed;
    } finally {
      socket?.terminate();
      if (server && server.exitCode === null && server.signalCode === null) {
        const stopped = once(server, "close", { signal: AbortSignal.timeout(10_000) });
        server.kill("SIGTERM");
        await stopped;
      }
      if (path.dirname(directory) !== cacheRoot) throw new Error("Build test cleanup escaped its cache root");
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});

function seedSession(databasePath: string): string {
  const database = new DatabaseSync(databasePath);
  const token = Buffer.from(randomBytes(32)).toString("base64url");
  const now = new Date().toISOString();
  try {
    database.prepare(`INSERT INTO users (id, display_name, role_id, is_active, revision_token, created_at, updated_at)
      VALUES ('bundle-user', 'Bundle User', 'member', 1, ?, ?, ?)`).run(randomUUID(), now, now);
    database.prepare(`INSERT INTO user_credentials (user_id, login_name, password_hash, updated_at)
      VALUES ('bundle-user', 'bundle-user', 'unused-test-credential', ?)`).run(now);
    database.prepare(`INSERT INTO member_profiles (user_id, power, revision_token, created_at, updated_at)
      VALUES ('bundle-user', 0, ?, ?, ?)`).run(randomUUID(), now, now);
    database.prepare(`INSERT INTO sessions (token_digest, user_id, expires_at, created_at, scope, auth_revision)
      VALUES (?, 'bundle-user', ?, ?, 'normal', 1)`)
      .run(createHash("sha256").update(token).digest("base64url"), new Date(Date.now() + 30 * 86400_000).toISOString(), now);
    return token;
  } finally {
    database.close();
  }
}

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(Number(process.env.VPS_BUILD_TEST_PORT ?? 0), "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing test server port");
  const closed = once(server, "close");
  server.close();
  await closed;
  return address.port;
}

function waitForListening(server: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Bundle did not start:\n${output}`)), 10_000);
    const fail = (error: Error) => { clearTimeout(timeout); reject(error); };
    server.once("error", fail);
    server.once("exit", (code) => fail(new Error(`Bundle exited (${code}):\n${output}`)));
    server.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    server.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("Infini Guild VPS listening on")) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}
