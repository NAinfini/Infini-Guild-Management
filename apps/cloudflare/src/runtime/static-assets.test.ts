import { describe, expect, it, vi } from "vitest";
import { createCloudflareStaticAssets } from "./static-assets.js";

const INDEX = "<!doctype html><title>{{SITE_NAME}}</title><img src=\"{{SITE_LOGO_URL}}\">";
const ASSET = "console.log('streamed asset')";
const ASSET_ETAG = '"asset-v1"';

function expectSecurityHeaders(response: Response): void {
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  expect(response.headers.get("Permissions-Policy")).toContain("camera=()");
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "connect-src 'self' wss://guild.test",
  );
}

function fixture(indexAvailable = true) {
  const pulls = { value: 0 };
  const assets = {
    fetch: vi.fn(async (request: Request): Promise<Response> => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/index.html" && indexAvailable) {
        return new Response(request.method === "HEAD" ? null : INDEX, {
          headers: {
            "Content-Length": String(new TextEncoder().encode(INDEX).byteLength),
            "Content-Type": "text/html; charset=utf-8",
            ETag: '"upstream-index"',
          },
        });
      }
      if (pathname === "/assets/app-abcdefgh.js") {
        if (request.headers.get("If-None-Match") === ASSET_ETAG) {
          return new Response(null, { status: 304, headers: { ETag: ASSET_ETAG } });
        }
        if (request.headers.get("Range") === "bytes=8-14") {
          return new Response(ASSET.slice(8, 15), {
            status: 206,
            headers: {
              "Accept-Ranges": "bytes",
              "Content-Length": "7",
              "Content-Range": `bytes 8-14/${ASSET.length}`,
              "Content-Type": "application/octet-stream",
              ETag: ASSET_ETAG,
            },
          });
        }
        if (request.method === "HEAD") {
          return new Response(null, {
            headers: {
              "Content-Length": String(ASSET.length),
              "Content-Type": "application/octet-stream",
              ETag: ASSET_ETAG,
            },
          });
        }
        let offset = 0;
        const bytes = new TextEncoder().encode(ASSET);
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls.value += 1;
            if (offset === bytes.byteLength) {
              controller.close();
              return;
            }
            const end = Math.min(offset + 5, bytes.byteLength);
            controller.enqueue(bytes.slice(offset, end));
            offset = end;
          },
        });
        return new Response(body, {
          headers: {
            "Content-Length": String(bytes.byteLength),
            "Content-Type": "application/octet-stream",
            ETag: ASSET_ETAG,
          },
        });
      }
      if (pathname === "/app.js") {
        return new Response("plain", { headers: { "Content-Type": "application/octet-stream" } });
      }
      return new Response("missing", { status: 404, headers: { "Content-Type": "text/plain" } });
    }),
  };
  return {
    assets,
    pulls,
    handler: createCloudflareStaticAssets({
      assets,
      getSiteBranding: () => ({ siteName: "Guild & Co", siteLogoUrl: "/brand?a=1&b=2" }),
    }),
  };
}

describe("Cloudflare static assets", () => {
  it("leaves API and websocket paths to their runtime handlers and rejects mutations", async () => {
    const { assets, handler } = fixture();

    await expect(handler(new Request("https://guild.test/api/members"))).resolves.toBeNull();
    await expect(handler(new Request("https://guild.test/ws/events"))).resolves.toBeNull();
    const mutation = await handler(new Request("https://guild.test/app.js", { method: "POST" }));

    expect(mutation?.status).toBe(405);
    expect(mutation?.headers.get("Allow")).toBe("GET, HEAD");
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("rejects decoded traversal without consulting the asset binding", async () => {
    const { assets, handler } = fixture();

    const traversal = await handler(new Request("https://guild.test/..%2Fsecret.txt"));
    const backslash = await handler(new Request("https://guild.test/%5Cserver%5Cshare"));

    expect(traversal?.status).toBe(400);
    expect(backslash?.status).toBe(400);
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("serves the branded index for roots, directories, and unknown application routes", async () => {
    const { handler } = fixture();

    for (const pathname of ["/", "/settings/", "/guild/members"]) {
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
    const { handler } = fixture();

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

  it("returns a unified plain-text server error when index.html is missing", async () => {
    const { handler } = fixture(false);
    const response = await handler(new Request("https://guild.test/index.html"));

    expect(response?.status).toBe(500);
    expect(response?.headers.get("Content-Type")).toBe("text/plain; charset=UTF-8");
    expect(await response?.text()).toBe("Static index unavailable");
  });

  it("streams assets with MIME and cache policy while preserving HEAD, ETag, and Range", async () => {
    const { handler, pulls } = fixture();

    const streamed = await handler(new Request("https://guild.test/assets/app-abcdefgh.js"));
    await Promise.resolve();
    expect(pulls.value).toBeLessThan(3);
    expect(streamed?.headers.get("Content-Type")).toBe("text/javascript; charset=UTF-8");
    expect(streamed?.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(await streamed?.text()).toBe(ASSET);
    expect(pulls.value).toBeGreaterThan(2);

    const plain = await handler(new Request("https://guild.test/app.js"));
    expect(plain?.headers.get("Cache-Control")).toBe("no-cache");

    const head = await handler(new Request("https://guild.test/assets/app-abcdefgh.js", { method: "HEAD" }));
    expect(head?.status).toBe(200);
    expect(head?.headers.get("Content-Length")).toBe(String(ASSET.length));
    expect(await head?.text()).toBe("");

    const notModified = await handler(new Request("https://guild.test/assets/app-abcdefgh.js", {
      headers: { "If-None-Match": ASSET_ETAG },
    }));
    expect(notModified?.status).toBe(304);
    expect(notModified?.headers.get("ETag")).toBe(ASSET_ETAG);

    const partial = await handler(new Request("https://guild.test/assets/app-abcdefgh.js", {
      headers: { Range: "bytes=8-14" },
    }));
    expect(partial?.status).toBe(206);
    expect(partial?.headers.get("Content-Range")).toBe(`bytes 8-14/${ASSET.length}`);
    expect(await partial?.text()).toBe(ASSET.slice(8, 15));
  });

  it("uses the transformed index ETag for conditional requests", async () => {
    const { handler } = fixture();
    const first = await handler(new Request("https://guild.test/", { headers: { Accept: "text/html" } }));
    const etag = first?.headers.get("ETag");
    const conditional = await handler(new Request("https://guild.test/", {
      headers: { Accept: "text/html", "If-None-Match": etag! },
    }));

    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
    expect(conditional?.status).toBe(304);
    expect(await conditional?.text()).toBe("");
  });
});
