import { AppError, createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { LIMITS, MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES } from "@guild/shared";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createRequestBodyLimitMiddleware, HttpPayloadTooLargeError } from "./body-limit.js";
import { createHttpErrorHandler } from "./error-handler.js";
import type { HttpEnv } from "./http-env.js";
import { requestContext } from "./http-env.js";
import { isMultipartFilePart, parseFormData, parseImageUploads, parseJsonBody } from "./parsing.js";
import { createMutationSecurityMiddleware } from "./mutation-security.js";
import { createRequestContextMiddleware } from "./request-context-middleware.js";

describe("HTTP transport foundation", () => {
  it("resolves one RequestContext per request and reuses it in handlers", async () => {
    const injected = createRequestContext({
      requestId: "request-core",
      authorization: createAuthorizationContext(null),
      now: "2026-08-09T12:00:00.000Z",
    });
    const resolve = vi.fn().mockResolvedValue(injected);
    const app = new Hono<HttpEnv>();
    app.use("*", createRequestContextMiddleware(resolve));
    app.get("/", (context) => context.json({ same: requestContext(context) === injected }));

    const response = await app.request("/");

    expect(await response.json()).toEqual({ same: true });
    expect(response.headers.get("X-Request-Id")).toBe("request-core");
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("uses one AppError envelope for domain and Zod failures", async () => {
    const app = errorApp();
    app.post("/parse", async (context) => context.json(await parseJsonBody(
      context.req.raw,
      z.object({ count: z.number().int().positive() }),
    )));
    app.get("/forbidden", () => {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "Denied" });
    });

    const invalid = await app.request("/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: 0 }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error_code: "VALIDATION_ERROR",
      request_id: "request-errors",
    });

    const forbidden = await app.request("/forbidden");
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({
      error_code: "FORBIDDEN",
      message: "Denied",
      request_id: "request-errors",
    });
    expect(forbidden.headers.get("Cache-Control")).toBe("no-store");
    expect(forbidden.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(forbidden.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("mirrors a rate-limit delay into the Retry-After header", async () => {
    const app = errorApp();
    app.get("/limited", () => {
      throw new AppError({
        code: "RATE_LIMITED",
        status: 429,
        message: "Slow down",
        details: { retry_after_seconds: 7 },
      });
    });

    const response = await app.request("/limited");

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("7");
    expect(await response.json()).toMatchObject({ details: { retry_after_seconds: 7 } });
  });

  it("requires an explicit allowed Origin and XMLHttpRequest marker for mutations", async () => {
    const app = errorApp();
    app.use("*", createMutationSecurityMiddleware({
      allowedOrigins: ["https://guild.example"],
    }));
    app.get("/resource", (context) => context.json({ ok: true }));
    app.post("/resource", (context) => context.json({ ok: true }));
    app.put("/resource", (context) => context.json({ ok: true }));

    expect((await app.request("/resource")).status).toBe(200);
    const missing = await app.request("/resource", { method: "POST" });
    expect(missing.status).toBe(403);
    expect(await missing.json()).toMatchObject({
      error_code: "FORBIDDEN",
      request_id: "request-errors",
    });
    expect((await app.request("/resource", {
      method: "POST",
      headers: { Origin: "https://other.example", "X-Requested-With": "XMLHttpRequest" },
    })).status).toBe(403);
    expect((await app.request("/resource", {
      method: "POST",
      headers: { Origin: "https://guild.example" },
    })).status).toBe(403);
    expect((await app.request("/resource", {
      method: "POST",
      headers: { Origin: "https://guild.example", "X-Requested-With": "XMLHttpRequest" },
    })).status).toBe(200);
    expect((await app.request("/resource", {
      method: "PUT",
      headers: { Origin: "https://guild.example", "X-Requested-With": "XMLHttpRequest" },
    })).status).toBe(200);
    expect((await app.request("/resource", { method: "PUT" })).status).toBe(403);
  });

  it("rejects declared and streamed ordinary bodies over one MiB", async () => {
    const app = errorApp();
    app.use("*", createRequestBodyLimitMiddleware());
    app.post("/body", async (context) => context.json(await parseJsonBody(
      context.req.raw,
      z.object({ value: z.string() }),
    )));

    const declared = await app.request("/body", {
      method: "POST",
      headers: {
        "Content-Length": String(1024 * 1024 + 1),
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(declared.status).toBe(413);

    const streamed = await app.request(oversizedJsonRequest());
    expect(streamed.status).toBe(413);
    expect(await streamed.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });

    const parserOnly = errorApp();
    parserOnly.post("/body", async (context) => context.json(await parseJsonBody(
      context.req.raw,
      z.object({ value: z.string() }),
    )));
    expect((await parserOnly.request(oversizedJsonRequest())).status).toBe(413);
  });

  it("buffers a request once and lets parsers reuse the bounded bytes", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"once"}'));
        controller.close();
      },
    });
    const getReader = vi.spyOn(body, "getReader");
    const app = errorApp();
    app.use("*", createRequestBodyLimitMiddleware());
    app.post("/body", async (context) => {
      const parserRead = vi.spyOn(context.req.raw.body!, "getReader");
      const readsBeforeParsing = parserRead.mock.calls.length;
      const first = await parseJsonBody(context.req.raw, z.object({ value: z.string() }));
      const second = await parseJsonBody(context.req.raw, z.object({ value: z.string() }));
      return context.json({ first, second, parserReads: parserRead.mock.calls.length - readsBeforeParsing });
    });

    const response = await app.request(new Request("http://localhost/body", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      first: { value: "once" },
      second: { value: "once" },
      parserReads: 0,
    });
    expect(getReader).toHaveBeenCalledOnce();
  });

  it("parses split multipart boundaries without retaining one whole-request buffer", async () => {
    const boundary = "one-bounded-upload";
    const source = new TextEncoder().encode([
      `--${boundary}\r\nContent-Disposition: form-data; name="data"\r\n\r\n{"title":"Event"}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="captions"\r\n\r\nPortrait\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="full"; filename="portrait.webp"\r\nContent-Type: image/webp\r\n\r\nFULL\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="view"; filename="portrait-view.webp"\r\nContent-Type: image/webp\r\n\r\nVIEW\r\n`,
      `--${boundary}--\r\n`,
    ].join(""));
    const chunks = Array.from({ length: Math.ceil(source.byteLength / 7) }, (_, index) =>
      source.subarray(index * 7, Math.min(source.byteLength, (index + 1) * 7)));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const getReader = vi.spyOn(body, "getReader");
    const blobArrayBuffer = vi.spyOn(Blob.prototype, "arrayBuffer");
    const app = errorApp();
    app.use("*", createRequestBodyLimitMiddleware());
    app.post("/form", async (context) => {
      let peakTransientBytes = 0;
      const form = await parseFormData(context.req.raw, {
        observeTransientBytes(bytes) {
          peakTransientBytes = Math.max(peakTransientBytes, bytes);
        },
      });
      const full = form.get("full");
      if (!isMultipartFilePart(full)) throw new Error("Expected a file part");
      const uploads = await parseImageUploads(form);
      return context.json({
        data: form.get("data"),
        captions: form.getAll("captions"),
        filename: full.filename,
        full: new TextDecoder().decode(uploads[0]!.full),
        view: new TextDecoder().decode(uploads[0]!.view),
        peakTransientBytes,
      });
    });

    try {
      const response = await app.request(new Request("http://localhost/form", {
        method: "POST",
        headers: {
          "Content-Length": String(source.byteLength),
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" }));

      expect(response.status).toBe(200);
      const payload = await response.json() as { peakTransientBytes: number };
      expect(payload).toEqual({
        data: "{\"title\":\"Event\"}",
        captions: ["Portrait"],
        filename: "portrait.webp",
        full: "FULL",
        view: "VIEW",
        peakTransientBytes: expect.any(Number),
      });
      expect(payload.peakTransientBytes).toBeLessThan(source.byteLength);
      expect(getReader).toHaveBeenCalledOnce();
      expect(blobArrayBuffer).not.toHaveBeenCalled();
    } finally {
      blobArrayBuffer.mockRestore();
    }
  });

  it("keeps native FormData as a bounded image-upload adapter", async () => {
    const form = new FormData();
    form.append("full", new File(["full"], "full.webp", { type: "image/webp" }));
    form.append("view", new File(["view"], "view.webp", { type: "image/webp" }));
    const uploads = await parseImageUploads(form);
    expect(new TextDecoder().decode(uploads[0]!.full)).toBe("full");

    const unaligned = new FormData();
    unaligned.append("full", new File(["full"], "full.webp", { type: "image/webp" }));
    await expect(parseImageUploads(unaligned)).rejects.toThrow("aligned");

    const wrongMime = new FormData();
    wrongMime.append("full", new File(["full"], "full.png", { type: "image/png" }));
    wrongMime.append("view", new File(["view"], "view.webp", { type: "image/webp" }));
    await expect(parseImageUploads(wrongMime)).rejects.toThrow("image/webp");
  });

  it("bounds multipart totals, part counts, and each image variant before parsing", async () => {
    const app = errorApp();
    app.use("*", createRequestBodyLimitMiddleware());
    app.post("/form", async (context) => {
      const form = await parseFormData(context.req.raw);
      return context.json({ parts: [...form].length });
    });

    const declared = await app.request("/form", {
      method: "POST",
      headers: {
        "Content-Length": String(LIMITS.requestBody.upload + 1),
        "Content-Type": "multipart/form-data; boundary=limit",
      },
      body: "--limit--\r\n",
    });
    expect(declared.status).toBe(413);

    const tooMany = new FormData();
    for (let index = 0; index < 151; index += 1) tooMany.append("captions", String(index));
    expect((await app.request("/form", { method: "POST", body: tooMany })).status).toBe(400);

    const largeVariant = new FormData();
    largeVariant.append("full", new File(
      [new Uint8Array(MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES + 1)],
      "full.webp",
      { type: "image/webp" },
    ));
    expect((await app.request("/form", { method: "POST", body: largeVariant })).status).toBe(413);
  });

  it("cancels the multipart source as soon as a streamed variant exceeds its bound", async () => {
    const boundary = "cancel-over-limit";
    const header = new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="full"; filename="full.webp"\r\nContent-Type: image/webp\r\n\r\n`,
    );
    let cancelled = false;
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return;
        sent = true;
        controller.enqueue(header);
        controller.enqueue(new Uint8Array(MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES + 128));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("http://localhost/form", {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(parseFormData(request)).rejects.toBeInstanceOf(HttpPayloadTooLargeError);
    expect(cancelled).toBe(true);
  });
});

function errorApp(): Hono<HttpEnv> {
  const app = new Hono<HttpEnv>();
  app.use("*", createRequestContextMiddleware(() => createRequestContext({
    requestId: "request-errors",
    authorization: createAuthorizationContext(null),
    now: "2026-08-09T12:00:00.000Z",
  })));
  app.onError(createHttpErrorHandler());
  return app;
}

function oversizedJsonRequest(): Request {
  return new Request("http://localhost/body", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}
