import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../core/error-handler.js";
import type { HttpEnv } from "../core/http-env.js";
import { createRequestContextMiddleware } from "../core/request-context-middleware.js";
import { createGalleryRoutes, type GalleryRouteDependencies } from "./gallery/gallery-routes.js";
import { createUsersRoutes, type UsersRoutesDependencies } from "./users/users-routes.js";

const MULTIPART_BODY = new TextEncoder().encode([
  "--upload-boundary",
  'Content-Disposition: form-data; name="titles"',
  "",
  "Untrusted upload",
  "--upload-boundary--",
  "",
].join("\r\n"));

describe("multipart upload authorization order", () => {
  it.each([
    ["anonymous", null, 401],
    ["authenticated without permission", [] as const, 403],
  ])("rejects %s requests without reading their body", async (_label, permissions, expectedStatus) => {
    const observed = observableBody(MULTIPART_BODY);
    const uploadImages = vi.fn();
    const service = { uploadImages } as unknown as GalleryRouteDependencies["service"];
    const app = appWithAuthorization(permissions);
    app.route("/api/gallery", createGalleryRoutes({
      service,
      getImagePolicy: () => ({ maxBytes: 1024, quota: 1 }),
    }));

    const response = await app.fetch(new Request("http://localhost/api/gallery/images", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=upload-boundary" },
      body: observed.body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }));

    expect(observed.bytesRead()).toBe(0);
    expect(response.status).toBe(expectedStatus);
    expect(uploadImages).not.toHaveBeenCalled();
  });

  it("rejects a cross-profile upload without edit permission before reading its body", async () => {
    const observed = observableBody(MULTIPART_BODY);
    const uploadImages = vi.fn();
    const service = { uploadImages } as unknown as UsersRoutesDependencies["service"];
    const app = appWithAuthorization([]);
    app.route("/api/users", createUsersRoutes({ service }));

    const response = await app.fetch(new Request("http://localhost/api/users/user-2/media/images", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=upload-boundary" },
      body: observed.body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }));

    expect(observed.bytesRead()).toBe(0);
    expect(response.status).toBe(403);
    expect(uploadImages).not.toHaveBeenCalled();
  });
});

function appWithAuthorization(permissions: readonly string[] | null): Hono<HttpEnv> {
  const authorization = createAuthorizationContext(permissions === null
    ? null
    : {
        userId: "user-1",
        sessionId: "session-1",
        roleId: "member",
        roleLevel: 1,
        permissions,
      });
  const request = createRequestContext({
    requestId: "request-upload-authorization",
    authorization,
    now: "2026-08-27T12:00:00.000Z",
  });
  const app = new Hono<HttpEnv>();
  app.use("*", createRequestContextMiddleware(() => request));
  app.onError(createHttpErrorHandler());
  return app;
}

function observableBody(bytes: Uint8Array): Readonly<{
  body: ReadableStream<Uint8Array>;
  bytesRead(): number;
}> {
  let consumed = 0;
  let emitted = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted) {
        controller.close();
        return;
      }
      emitted = true;
      consumed += bytes.byteLength;
      controller.enqueue(bytes);
      controller.close();
    },
  }, { highWaterMark: 0 });
  return { body, bytesRead: () => consumed };
}
