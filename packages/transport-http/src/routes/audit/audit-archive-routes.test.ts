import {
  createAuthorizationContext,
  createRequestContext,
  type BlobMetadata,
  type BlobRange,
  type RequestContext,
} from "@guild/kernel";
import { AuditArchiveDownloadTokens } from "@guild/server/modules/audit";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../../core/error-handler.js";
import type { HttpEnv } from "../../core/http-env.js";
import { createAuditArchiveRoutes } from "./audit-archive-routes.js";

const BYTES = new TextEncoder().encode("{}\n");
const METADATA: BlobMetadata = {
  key: "audit/2026/08/archive-1.ndjson",
  size: BYTES.byteLength,
  contentType: "application/x-ndjson; charset=UTF-8",
  sha256: "a".repeat(64),
  etag: "archive-etag",
  lastModified: "2026-08-09T12:00:00.000Z",
};
const TOKENS = new AuditArchiveDownloadTokens(new Uint8Array(32).fill(7));

describe("audit archive routes", () => {
  it("keeps the Portal token download wire with a real expiry", async () => {
    const { app } = testApp(authenticatedContext());
    expect(await (await app.request("/api/admin/audit-archive/months")).json())
      .toEqual({ months: ["2026-08"] });

    const download = await app.request("/api/admin/audit-archive/download?month=2026-08&format=raw_ndjson_gz");
    const payload = await download.json() as { files: Array<{ url: string; expires_at: string }> };
    expect(payload).toMatchObject({
      month: "2026-08",
      expires_in_seconds: 300,
      files: [{
        key: METADATA.key,
        row_count: 10,
        size_bytes: 3,
        expires_at: "2026-08-09T12:05:00.000Z",
      }],
    });
    expect(payload.files[0]?.url).toMatch(/^\/api\/admin\/audit-archive\/download\/file\?token=/);

    const file = await app.request(payload.files[0]?.url ?? "");
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toContain("archive-1.ndjson");
    expect(await file.text()).toBe("{}\n");
  });

  it("supports single ranges, HEAD without opening the body, and 416 totals", async () => {
    const { app, service } = testApp(authenticatedContext());
    const url = await downloadUrl(app);

    const range = await app.request(url, { headers: { Range: "bytes=1-2" } });
    expect(range.status).toBe(206);
    expect(range.headers.get("Content-Range")).toBe("bytes 1-2/3");
    expect(range.headers.get("Content-Length")).toBe("2");
    expect(await range.text()).toBe("}\n");
    expect(service.read).toHaveBeenLastCalledWith(expect.anything(), "archive-1", { offset: 1, length: 2, total: 3 });

    service.read.mockClear();
    const head = await app.request(url, { method: "HEAD", headers: { Range: "bytes=0-0" } });
    expect(head.status).toBe(206);
    expect(head.headers.get("Content-Range")).toBe("bytes 0-0/3");
    expect(head.headers.get("Content-Length")).toBe("1");
    expect(service.read).not.toHaveBeenCalled();

    const invalid = await app.request(url, { headers: { Range: "bytes=3-3" } });
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("Content-Range")).toBe("bytes */3");
  });

  it("rejects missing permission, cross-session tokens, and expired tokens", async () => {
    const denied = testApp(authenticatedContext({ permissions: [] })).app;
    expect((await denied.request("/api/admin/audit-archive/months")).status).toBe(403);

    const issuer = testApp(authenticatedContext()).app;
    const url = await downloadUrl(issuer);
    const otherSession = testApp(authenticatedContext({ sessionId: "session-2" })).app;
    expect((await otherSession.request(url)).status).toBe(403);

    const expired = testApp(authenticatedContext({ now: "2026-08-09T12:05:00.000Z" })).app;
    expect((await expired.request(url)).status).toBe(403);
  });
});

function testApp(request: RequestContext) {
  const service = {
    listMonths: vi.fn(async (context: RequestContext) => {
      context.authorization.require("admin.audit.export");
      return ["2026-08"];
    }),
    listFiles: vi.fn(async (context: RequestContext) => {
      context.authorization.require("admin.audit.export");
      return [{
        id: "archive-1",
        month: "2026-08",
        objectKey: METADATA.key,
        rowCount: 10,
        startsAt: "2026-06-01T00:00:00.000Z",
        endsAt: "2026-06-02T00:00:00.000Z",
        sizeBytes: METADATA.size,
        sha256: METADATA.sha256,
        completedAt: METADATA.lastModified,
      }];
    }),
    head: vi.fn(async (context: RequestContext) => {
      context.authorization.require("admin.audit.export");
      return METADATA;
    }),
    read: vi.fn(async (context: RequestContext, _archiveId: string, range?: BlobRange) => {
      context.authorization.require("admin.audit.export");
      const value = range ? BYTES.subarray(range.offset, range.offset + range.length) : BYTES;
      return {
        metadata: METADATA,
        body: new ReadableStream({ start(controller) { controller.enqueue(value); controller.close(); } }),
      };
    }),
  };
  const app = new Hono<HttpEnv>();
  app.onError(createHttpErrorHandler());
  app.use("*", async (context, next) => {
    context.set("requestContext", request);
    await next();
  });
  app.route("/api/admin", createAuditArchiveRoutes({ service, tokens: TOKENS }));
  return { app, service };
}

function authenticatedContext(input: Readonly<{
  now?: string;
  sessionId?: string;
  permissions?: readonly string[];
}> = {}): RequestContext {
  return createRequestContext({
    requestId: "archive-request",
    now: input.now ?? "2026-08-09T12:00:00.000Z",
    authorization: createAuthorizationContext({
      userId: "admin-1",
      sessionId: input.sessionId ?? "session-1",
      roleId: "admin",
      roleLevel: 999,
      permissions: new Set(input.permissions ?? ["admin.audit.export"]),
    }),
  });
}

async function downloadUrl(app: Hono<HttpEnv>): Promise<string> {
  const response = await app.request("/api/admin/audit-archive/download?month=2026-08");
  const payload = await response.json() as { files: Array<{ url: string }> };
  return payload.files[0]?.url ?? "";
}
