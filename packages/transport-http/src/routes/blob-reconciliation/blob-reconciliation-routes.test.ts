import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../../core/error-handler.js";
import type { HttpEnv } from "../../core/http-env.js";
import { createRequestContextMiddleware } from "../../core/request-context-middleware.js";
import { createBlobReconciliationRoutes } from "./blob-reconciliation-routes.js";

const SHA = "a".repeat(64);

describe("blob reconciliation admin route", () => {
  it.each(["admin.status.view", "admin.audit.export"])("allows %s and forwards a bounded checkpoint", async (permission) => {
    const scanPage = vi.fn().mockResolvedValue({
      scanned: 1,
      findings: [],
      nextCheckpoint: { phase: "inventory", prefix: "audit/" },
    });
    const response = await buildApp(scanPage, [permission]).request(
      "/api/admin/blob-reconciliation?phase=inventory&prefix=media%2F&checkpoint=next&limit=25",
    );

    expect(response.status).toBe(200);
    expect(scanPage).toHaveBeenCalledWith({
      now: "2026-08-09T12:00:00.000Z",
      limit: 25,
      checkpoint: { phase: "inventory", prefix: "media/", checkpoint: "next" },
    });
    expect(await response.json()).toMatchObject({ status: "incomplete", scanned: 1 });
  });

  it("reports drift without exposing a mutation capability", async () => {
    const scanPage = vi.fn().mockResolvedValue({
      scanned: 1,
      findings: [{
        kind: "missing_blob",
        expected: {
          source: "media",
          sourceId: "media-1",
          objectKey: "media/media-1/view.webp",
          byteSize: 10,
          contentType: "image/webp",
          sha256: SHA,
        },
      }],
      nextCheckpoint: null,
    });
    const response = await buildApp(scanPage, ["admin.status.view"]).request("/api/admin/blob-reconciliation");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "drift",
      findings: [{ kind: "missing_blob", expected: { object_key: "media/media-1/view.webp" } }],
      next_checkpoint: null,
    });
  });

  it("reports an unfinished scan before drift while preserving both findings and checkpoint", async () => {
    const scanPage = vi.fn().mockResolvedValue({
      scanned: 1,
      findings: [{
        kind: "missing_blob",
        expected: {
          source: "media",
          sourceId: "media-1",
          objectKey: "media/media-1/view.webp",
          byteSize: 10,
          contentType: "image/webp",
          sha256: SHA,
        },
      }],
      nextCheckpoint: { phase: "manifest", checkpoint: "media/media-1/view.webp" },
    });
    const response = await buildApp(scanPage, ["admin.status.view"]).request("/api/admin/blob-reconciliation");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "incomplete",
      findings: [{ kind: "missing_blob", expected: { object_key: "media/media-1/view.webp" } }],
      next_checkpoint: { phase: "manifest", checkpoint: "media/media-1/view.webp" },
    });
  });

  it("rejects callers without either permission and invalid limits", async () => {
    const scanPage = vi.fn();
    expect((await buildApp(scanPage, []).request("/api/admin/blob-reconciliation")).status).toBe(403);
    expect((await buildApp(scanPage, ["admin.status.view"]).request(
      "/api/admin/blob-reconciliation?limit=51",
    )).status).toBe(400);
    expect(scanPage).not.toHaveBeenCalled();
  });
});

function buildApp(scanPage: ReturnType<typeof vi.fn>, permissions: readonly string[]): Hono<HttpEnv> {
  const app = new Hono<HttpEnv>();
  app.use("*", createRequestContextMiddleware(() => createRequestContext({
    requestId: "blob-reconciliation-request",
    authorization: createAuthorizationContext({
      userId: "admin-1",
      sessionId: "session-1",
      roleId: "admin",
      roleLevel: 900,
      permissions: new Set(permissions),
    }),
    now: "2026-08-09T12:00:00.000Z",
  })));
  app.onError(createHttpErrorHandler());
  app.route("/api/admin", createBlobReconciliationRoutes({ service: { scanPage } as never }));
  return app;
}
