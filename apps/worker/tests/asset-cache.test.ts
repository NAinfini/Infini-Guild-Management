import { describe, expect, it } from "vitest";
import worker, { isImmutableBuildAssetPath, type Bindings } from "../index";

describe("isImmutableBuildAssetPath", () => {
  it("recognizes Vite hashed JS and CSS asset filenames", () => {
    expect(isImmutableBuildAssetPath("/assets/index-B-bDPaKE.js")).toBe(true);
    expect(isImmutableBuildAssetPath("/assets/mantine-core-CKg0vgt5.css")).toBe(true);
    expect(isImmutableBuildAssetPath("/assets/react-core-CfhOZ969.js")).toBe(true);
  });

  it("does not mark non-hashed static paths immutable", () => {
    expect(isImmutableBuildAssetPath("/splash.js")).toBe(false);
    expect(isImmutableBuildAssetPath("/guild-logo.webp")).toBe(false);
    expect(isImmutableBuildAssetPath("/assets/index.js")).toBe(false);
  });
});

function createAssetEnv(response: Response): Bindings {
  return {
    DB: {} as D1Database,
    MEDIA: {} as R2Bucket,
    WS: {} as DurableObjectNamespace,
    ASSETS: { fetch: async () => response } as unknown as Fetcher,
    PORTAL_ORIGIN: "https://guild.example.com",
    ENVIRONMENT: "production",
    SIGNING_SECRET: "test-secret",
    SITE_NAME: "Guild",
    SITE_LOGO_URL: "/guild-logo.webp",
  };
}

describe("asset response headers", () => {
  it("prevents Cloudflare HTML transformation on the SPA shell", async () => {
    const env = createAssetEnv(new Response("<title>{{SITE_NAME}}</title>", {
      headers: { "Content-Type": "text/html" },
    }));

    const response = await worker.fetch(new Request("https://guild.example.com/"), env, {} as ExecutionContext);

    expect(await response.text()).toContain("<title>Guild</title>");
    expect(response.headers.get("Cache-Control")).toContain("no-transform");
  });

  it("marks Vite hashed build assets as immutable in browser cache", async () => {
    const env = createAssetEnv(new Response("console.log('asset')", {
      headers: { "Content-Type": "text/javascript" },
    }));

    const response = await worker.fetch(
      new Request("https://guild.example.com/assets/index-B-bDPaKE.js"),
      env,
      {} as ExecutionContext,
    );

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });
});
