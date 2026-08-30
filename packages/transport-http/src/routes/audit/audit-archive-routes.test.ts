import {
  createAuthorizationContext,
  createRequestContext,
  type BlobMetadata,
  type BlobRange,
  type RequestContext,
} from "@guild/kernel";
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
describe("audit archive routes", () => {
  it("lists protected archive files and downloads them through the authenticated route", async () => {
    const { app } = testApp(authenticatedContext());
    expect(await (await app.request("/api/admin/audit-archive/months")).json())
      .toEqual({ months: ["2026-08"] });

    const list = await app.request("/api/admin/audit-archive/files?month=2026-08");
    const payload = await list.json() as { files: Array<{ id: string; filename: string }> };
    expect(payload).toMatchObject({
      month: "2026-08",
      files: [{
        id: "archive-1",
        filename: "guild-audit-archive-1.ndjson",
        row_count: 10,
        size_bytes: 3,
        starts_at: "2026-06-01T00:00:00.000Z",
        ends_at: "2026-06-02T00:00:00.000Z",
        completed_at: METADATA.lastModified,
      }],
    });

    const file = await app.request(`/api/admin/audit-archive/files/${payload.files[0]?.id ?? ""}`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toContain("archive-1.ndjson");
    expect(await file.text()).toBe("{}\n");
  });

  it("supports single ranges, HEAD without opening the body, and 416 totals", async () => {
    const { app, service } = testApp(authenticatedContext());
    const url = "/api/admin/audit-archive/files/archive-1";

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

  it("rejects archive listing and downloads without export permission", async () => {
    const denied = testApp(authenticatedContext({ permissions: [] })).app;
    expect((await denied.request("/api/admin/audit-archive/months")).status).toBe(403);
    expect((await denied.request("/api/admin/audit-archive/files?month=2026-08")).status).toBe(403);
    expect((await denied.request("/api/admin/audit-archive/files/archive-1")).status).toBe(403);
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
  app.route("/api/admin", createAuditArchiveRoutes({ service }));
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
