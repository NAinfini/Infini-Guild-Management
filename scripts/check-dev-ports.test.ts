import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkDevPorts,
  endpointsForRuntime,
  parseRuntime,
} from "./check-dev-ports.mjs";

const openServers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolveClose) => {
    server.close(() => resolveClose());
  })));
});

describe("development port preflight", () => {
  it("pins each runtime to its documented local entrypoint", () => {
    expect(endpointsForRuntime("cloudflare")).toEqual([
      expect.objectContaining({ port: 8787 }),
      expect.objectContaining({ port: 5173, url: "http://localhost:5173" }),
    ]);
    expect(endpointsForRuntime("vps")).toEqual([
      expect.objectContaining({ port: 8787 }),
      expect.objectContaining({ port: 5173, url: "http://localhost:5173" }),
    ]);
    expect(parseRuntime(["--runtime", "vps"])).toBe("vps");
    expect(() => parseRuntime(["--runtime", "worker"])).toThrow(/cloudflare|vps/);
  });

  it("fails before startup when a required port is already occupied", async () => {
    const server = createServer();
    openServers.push(server);
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address");

    await expect(checkDevPorts("vps", [{
      label: "Portal/Vite",
      host: "127.0.0.1",
      port: address.port,
      url: `http://localhost:${address.port}`,
    }])).rejects.toThrow(/already in use/);
  });

  it("keeps both public pnpm dev commands on strict preflighted ports", () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
    const cloudflareDev = packageJson.scripts["dev:cloudflare"] as string;
    expect(packageJson.scripts.dev).toBe("pnpm dev:cloudflare");
    expect(cloudflareDev).toContain("check-dev-ports.mjs --runtime cloudflare");
    expect(cloudflareDev).toContain("pnpm dev:cloudflare:server");
    expect(cloudflareDev).toContain("pnpm dev:portal");
    expect(cloudflareDev.indexOf("pnpm db:migrate:cloudflare:local"))
      .toBeLessThan(cloudflareDev.indexOf("pnpm db:seed:cloudflare:local"));
    expect(cloudflareDev.indexOf("pnpm db:seed:cloudflare:local"))
      .toBeLessThan(cloudflareDev.indexOf("concurrently"));
    expect(packageJson.scripts["dev:cloudflare:server"])
      .toBe("node scripts/dev/cloudflare-local.mjs serve");
    expect(packageJson.scripts["db:migrate:cloudflare:local"])
      .toBe("node scripts/dev/cloudflare-local.mjs migrate");
    expect(packageJson.scripts["db:seed:cloudflare:local"])
      .toBe("node scripts/dev/cloudflare-local.mjs seed");
    expect(packageJson.scripts["dev:vps"]).toContain("check-dev-ports.mjs --runtime vps");
    expect(packageJson.scripts["dev:vps"]).toContain("pnpm db:seed:vps");
  });
});
