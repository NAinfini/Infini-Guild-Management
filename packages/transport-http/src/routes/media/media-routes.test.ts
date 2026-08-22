import {
  createAuthorizationContext,
  createRequestContext,
  type BlobMetadata,
  type BlobRead,
  type RequestContext,
} from "@guild/kernel";
import { MediaRangeError, type MediaRangeRequest } from "@guild/server/modules/media";
import type { MediaVariant } from "@guild/shared";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../../core/error-handler.js";
import type { HttpEnv } from "../../core/http-env.js";
import { createRequestContextMiddleware } from "../../core/request-context-middleware.js";
import { createMediaRoutes } from "./media-routes.js";

const bytes = new TextEncoder().encode("0123456789");

describe("media HTTP route", () => {
  it("shares only public non-range media at the edge", async () => {
    const publicMedia = buildApp("public");
    const publicResponse = await publicMedia.app.request("/api/media/media-1/view");
    expect(publicResponse.headers.get("Cache-Control")).toBe("public, max-age=3600, s-maxage=60");

    const ranged = await publicMedia.app.request("/api/media/media-1/view", {
      headers: { Range: "bytes=0-2" },
    });
    expect(ranged.headers.get("Cache-Control")).toBe("private, max-age=3600");

    const privateMedia = buildApp("private");
    const privateResponse = await privateMedia.app.request("/api/media/media-1/view");
    expect(privateResponse.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });

  it("pushes explicit and suffix ranges into the media service", async () => {
    const { app, head, read } = buildApp();

    const explicit = await app.request("/api/media/media-1/full", { headers: { Range: "bytes=2-5" } });
    expect(explicit.status).toBe(206);
    expect(await explicit.text()).toBe("2345");
    expect(explicit.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(head).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledWith(expect.anything(), "media-1", "full", {
      kind: "closed",
      offset: 2,
      length: 4,
    });

    head.mockClear();
    read.mockClear();
    const suffix = await app.request("/api/media/media-1/view", { headers: { Range: "bytes=-3" } });
    expect(suffix.status).toBe(206);
    expect(await suffix.text()).toBe("789");
    expect(suffix.headers.get("Content-Range")).toBe("bytes 7-9/10");
    expect(head).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(expect.anything(), "media-1", "view", { kind: "suffix", length: 3 });
  });

  it("uses one read for conditional GET and head without opening a body for HEAD", async () => {
    const { app, head, read } = buildApp();
    const cached = await app.request("/api/media/media-1/full", {
      headers: { "If-None-Match": "\"media-etag\"" },
    });
    expect(cached.status).toBe(304);
    expect(head).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledOnce();

    head.mockClear();
    read.mockClear();
    const response = await app.request("/api/media/media-1/full", {
      method: "HEAD",
      headers: { Range: "bytes=2-5" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(await response.text()).toBe("");
    expect(head).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  });

  it("streams ordinary GETs directly and returns the unified 404 envelope for invalid variants", async () => {
    const { app, head, read } = buildApp();
    const response = await app.request("/api/media/media-1/full");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("0123456789");
    expect(head).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledWith(expect.anything(), "media-1", "full", undefined);

    const invalid = await app.request("/api/media/media-1/original");
    expect(invalid.status).toBe(404);
    expect(await invalid.json()).toEqual({
      error_code: "NOT_FOUND",
      message: "Media not found",
      request_id: "request-media",
    });
  });

  it("returns total-aware 416 responses without requesting object bodies", async () => {
    const { app, head, read } = buildApp();
    for (const range of ["bytes=20-30", "bytes=invalid"]) {
      const invalid = await app.request("/api/media/media-1/full", { headers: { Range: range } });
      expect(invalid.status).toBe(416);
      expect(invalid.headers.get("Content-Range")).toBe("bytes */10");
    }
    expect(head).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
  });
});

function buildApp(audience: "public" | "authenticated" | "private" = "public") {
  const metadata: BlobMetadata = {
    key: "media/media-1/full.webp",
    size: bytes.byteLength,
    contentType: "image/webp",
    sha256: "digest",
    etag: "media-etag",
    lastModified: "2026-08-09T12:00:00.000Z",
  };
  const head = vi.fn(async () => ({ metadata, audience }));
  const read = vi.fn(async (
    _context: RequestContext,
    _mediaId: string,
    _variant: MediaVariant,
    range?: MediaRangeRequest,
  ) => {
    const offset = range?.kind === "suffix"
      ? Math.max(0, bytes.byteLength - range.length)
      : range?.offset ?? 0;
    if (offset >= bytes.byteLength) throw new MediaRangeError(bytes.byteLength);
    const requestedLength = range?.kind === "open"
      ? bytes.byteLength - offset
      : range?.length ?? bytes.byteLength;
    const length = Math.min(requestedLength, bytes.byteLength - offset);
    return {
      object: {
        metadata,
        body: byteStream(bytes.subarray(offset, offset + length)),
        ...(range ? { range: { offset, length, total: bytes.byteLength } } : {}),
      } satisfies BlobRead,
      audience,
    };
  });
  const app = new Hono<HttpEnv>();
  app.use("*", createRequestContextMiddleware(() => createRequestContext({
    requestId: "request-media",
    authorization: createAuthorizationContext(null),
    now: "2026-08-09T12:00:00.000Z",
  })));
  app.onError(createHttpErrorHandler());
  app.route("/api/media", createMediaRoutes({ service: { head, read } }));
  return { app, head, read };
}

function byteStream(value: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(value);
      controller.close();
    },
  });
}
