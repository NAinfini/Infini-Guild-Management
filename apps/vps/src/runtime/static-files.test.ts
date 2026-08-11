import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createVpsStaticFiles } from "./static-files.js";

const INDEX = "<!doctype html><title>{{SITE_NAME}}</title><img src=\"{{SITE_LOGO_URL}}\">";
const ASSET = Buffer.alloc(2 * 1024 * 1024, "a");
ASSET.set(Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz"), 0);

function expectSecurityHeaders(response: Response): void {
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  expect(response.headers.get("Permissions-Policy")).toContain("camera=()");
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "connect-src 'self' wss://guild.test",
  );
}

describe("VPS static files", () => {
  const sandboxes: string[] = [];

  afterEach(async () => {
    await Promise.all(sandboxes.splice(0).map((sandbox) => rm(sandbox, { recursive: true, force: true })));
  });

  async function fixture(): Promise<{
    root: string;
    sandbox: string;
    handler: ReturnType<typeof createVpsStaticFiles>;
  }> {
    const sandbox = await mkdtemp(path.join(tmpdir(), "guild-static-"));
    sandboxes.push(sandbox);
    const root = path.join(sandbox, "dist");
    await mkdir(path.join(root, "assets"), { recursive: true });
    await mkdir(path.join(root, "existing-directory"));
    await writeFile(path.join(root, "index.html"), INDEX);
    await writeFile(path.join(root, "assets", "app-abcdefgh.js"), ASSET);
    await writeFile(path.join(root, "app.js"), "plain");
    return {
      root,
      sandbox,
      handler: createVpsStaticFiles({
        distRoot: root,
        getSiteBranding: () => ({ siteName: "Guild & Co", siteLogoUrl: "/brand?a=1&b=2" }),
      }),
    };
  }

  it("leaves API and websocket paths to their runtime handlers and rejects mutations", async () => {
    const { handler } = await fixture();

    await expect(handler(new Request("https://guild.test/api/members"))).resolves.toBeNull();
    await expect(handler(new Request("https://guild.test/ws/events"))).resolves.toBeNull();
    const mutation = await handler(new Request("https://guild.test/app.js", { method: "DELETE" }));

    expect(mutation?.status).toBe(405);
    expect(mutation?.headers.get("Allow")).toBe("GET, HEAD");
  });

  it("rejects decoded traversal and prevents symlinks from escaping dist", async () => {
    const { handler, root, sandbox } = await fixture();
    const outside = path.join(sandbox, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(outside, path.join(root, "escape"), "junction");

    const traversal = await handler(new Request("https://guild.test/..%2Foutside%2Fsecret.txt"));
    const backslash = await handler(new Request("https://guild.test/%5Coutside%5Csecret.txt"));
    const symlinkEscape = await handler(new Request("https://guild.test/escape/secret.txt"));

    expect(traversal?.status).toBe(400);
    expect(backslash?.status).toBe(400);
    expect(symlinkEscape?.status).toBe(404);

    const live = path.join(root, "live");
    const moved = path.join(root, "moved");
    await mkdir(live);
    await writeFile(path.join(live, "asset.txt"), "opened inside dist");
    const opened = await handler(new Request("https://guild.test/live/asset.txt"));
    await rename(live, moved);
    await symlink(outside, live, "junction");
    expect(await opened?.text()).toBe("opened inside dist");
  });

  it("serves the branded index for roots, directories, and unknown application routes", async () => {
    const { handler } = await fixture();

    for (const pathname of ["/", "/existing-directory", "/settings/", "/guild/members"]) {
      const response = await handler(new Request(`https://guild.test${pathname}`, {
        headers: { Accept: "text/html" },
      }));
      expect(response?.status).toBe(200);
      const html = await response?.text();
      expect(html).toContain("<title>Guild &amp; Co</title>");
      expect(html).toContain("src=\"/brand?a=1&amp;b=2\"");
      expect(response?.headers.get("Cache-Control")).toContain("no-cache");
      expectSecurityHeaders(response!);
    }
    expect((await handler(new Request("https://guild.test/missing.js")))?.status).toBe(404);
    const head = await handler(new Request("https://guild.test/settings", {
      method: "HEAD",
      headers: { Accept: "text/html" },
    }));
    expect(head?.status).toBe(200);
    expect(await head?.text()).toBe("");
  });

  it("does not use the SPA fallback for JSON, wildcard, or rejected HTML requests", async () => {
    const { handler } = await fixture();

    for (const accept of [undefined, "application/json", "*/*", "text/html;q=0"]) {
      const headers = accept ? { Accept: accept } : undefined;
      const response = await handler(new Request("https://guild.test/guild/members", { headers }));
      expect(response?.status).toBe(404);
      expect(response?.headers.get("Content-Type")).toBe("text/plain; charset=UTF-8");
      expect(await response?.text()).toBe("Static asset not found");
    }

    const root = await handler(new Request("https://guild.test/", { headers: { Accept: "application/json" } }));
    expect(root?.status).toBe(404);
    const missingAsset = await handler(new Request("https://guild.test/missing.js", {
      headers: { Accept: "text/html" },
    }));
    expect(missingAsset?.status).toBe(404);
    expect(missingAsset?.headers.get("Content-Type")).toBe("text/plain; charset=UTF-8");
    const corsFetch = await handler(new Request("https://guild.test/guild/members", {
      headers: { Accept: "text/html", "Sec-Fetch-Mode": "cors" },
    }));
    expect(corsFetch?.status).toBe(404);
  });

  it("returns a unified server error when index.html is missing or crosses a junction", async () => {
    const { handler, root } = await fixture();
    await rm(path.join(root, "index.html"));
    const response = await handler(new Request("https://guild.test/index.html"));

    expect(response?.status).toBe(500);
    expect(response?.headers.get("Content-Type")).toBe("text/plain; charset=UTF-8");
    expect(await response?.text()).toBe("Static index unavailable");

    const swapped = await fixture();
    const prime = await swapped.handler(new Request("https://guild.test/app.js"));
    await prime?.body?.cancel();
    const originalRoot = path.join(swapped.sandbox, "original-dist");
    const outsideRoot = path.join(swapped.sandbox, "outside-index");
    await mkdir(outsideRoot);
    await writeFile(path.join(outsideRoot, "index.html"), "must not be served");
    await rename(swapped.root, originalRoot);
    await symlink(outsideRoot, swapped.root, "junction");
    const escaped = await swapped.handler(new Request("https://guild.test/index.html"));
    expect(escaped?.status).toBe(500);
    expect(await escaped?.text()).toBe("Static index unavailable");
  });

  it("streams files with MIME and cache policy and implements HEAD, ETag, and single ranges", async () => {
    const { handler } = await fixture();
    const assetUrl = "https://guild.test/assets/app-abcdefgh.js";

    const full = await handler(new Request(assetUrl));
    expect(full?.headers.get("Content-Type")).toBe("text/javascript; charset=UTF-8");
    expect(full?.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    const etag = full?.headers.get("ETag");
    await full?.body?.cancel();

    const plain = await handler(new Request("https://guild.test/app.js"));
    expect(plain?.headers.get("Cache-Control")).toBe("no-cache");

    const head = await handler(new Request(assetUrl, { method: "HEAD" }));
    expect(head?.status).toBe(200);
    expect(head?.headers.get("Content-Length")).toBe(String(ASSET.byteLength));
    expect(await head?.text()).toBe("");

    const notModified = await handler(new Request(assetUrl, { headers: { "If-None-Match": etag! } }));
    expect(notModified?.status).toBe(304);
    expect(await notModified?.text()).toBe("");

    const partial = await handler(new Request(assetUrl, { headers: { Range: "bytes=8-14" } }));
    expect(partial?.status).toBe(206);
    expect(partial?.headers.get("Content-Range")).toBe(`bytes 8-14/${ASSET.byteLength}`);
    expect(await partial?.text()).toBe(ASSET.subarray(8, 15).toString());

    const invalid = await handler(new Request(assetUrl, { headers: { Range: "bytes=0-1,3-4" } }));
    expect(invalid?.status).toBe(416);
    expect(invalid?.headers.get("Content-Range")).toBe(`bytes */${ASSET.byteLength}`);
    expectSecurityHeaders(invalid!);
  });

  it("uses the transformed index ETag for HEAD and conditional requests", async () => {
    const { handler } = await fixture();
    const first = await handler(new Request("https://guild.test/", { headers: { Accept: "text/html" } }));
    const etag = first?.headers.get("ETag");
    const head = await handler(new Request("https://guild.test/", {
      method: "HEAD",
      headers: { Accept: "text/html" },
    }));
    const conditional = await handler(new Request("https://guild.test/", {
      headers: { Accept: "text/html", "If-None-Match": etag! },
    }));

    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
    expect(head?.headers.get("ETag")).toBe(etag);
    expect(await head?.text()).toBe("");
    expect(conditional?.status).toBe(304);
  });
});
