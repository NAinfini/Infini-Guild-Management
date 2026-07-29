import type { Context, Next } from "hono";
import { SYSTEM_TEST_HEADER, SYSTEM_TEST_HEADER_VALUE, SYSTEM_TEST_RUN_ID_HEADER } from "@guild/shared/config/system-test";
import type { Bindings } from "../index";
import { SystemTestService, type SystemTestArtifact, type SystemTestArtifactType } from "../services/SystemTestService";
import { getRequestUser } from "./rbac";

function string(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function keys(value: Record<string, unknown>): string[] {
  const array = Array.isArray(value.keys) ? value.keys.filter((key): key is string => typeof key === "string") : [];
  const single = string(value.key);
  return single ? [...array, single] : array;
}
function artifacts(type: SystemTestArtifactType, values: readonly (string | null)[]): SystemTestArtifact[] {
  return values.filter((key): key is string => Boolean(key)).map((key) => ({ type, key }));
}

/** The only response shapes that may register test-created resources. */
export function extractSystemTestArtifacts(method: string, path: string, body: unknown): SystemTestArtifact[] {
  if (method !== "POST") return [];
  const json = record(body);
  const id = string(json?.id);
  const responseKeys = json ? artifacts("r2_key", keys(json)) : [];
  if (path === "/api/admin/invite-links") return artifacts("invite_link", [id]);
  if (/^\/api\/auth\/register\/[^/]+$/.test(path)) return artifacts("user", [string(record(json?.user)?.id), string(json?.user_id)]);
  if (path === "/api/admin/users") return artifacts("user", [string(json?.user_id), string(record(json?.user)?.id)]);
  if (path === "/api/admin/roles") return artifacts("role", [id]);
  if (path === "/api/events") return artifacts("event", [id]);
  if (path === "/api/events/templates") return artifacts("event_template", [id]);
  if (path === "/api/announcements") return artifacts("announcement", [id]);
  if (path === "/api/gallery/videos") return artifacts("gallery_item", [id]);
  if (path === "/api/guild-war/history") return artifacts("war_history", [id]);
  if (path === "/api/guild-war/conclude") return artifacts("war_history", [string(json?.war_history_id)]);
  if (path === "/api/wiki/categories") return artifacts("wiki_category", [id]);
  if (path === "/api/wiki/articles") return artifacts("wiki_article", [id]);
  if (path === "/api/badges") return artifacts("badge", [id]);
  if (path === "/api/storage/storages") return artifacts("storage", [id]);
  if (/^\/api\/storage\/storages\/[^/]+\/categories$/.test(path)) return artifacts("storage_category", [id]);
  if (path === "/api/storage/items") return artifacts("storage_item", [id]);
  if (/^\/api\/storage\/items\/[^/]+\/images$/.test(path)) {
    const images = Array.isArray(body) ? body : [];
    return images.flatMap((item) => {
      const image = record(item);
      return image ? [...artifacts("storage_item_image", [string(image.id)]), ...artifacts("r2_key", [string(image.r2_key)])] : [];
    });
  }
  if (path === "/api/gallery/images") {
    const items = Array.isArray(body) ? body : Array.isArray(json?.data) ? json.data : [];
    return items.flatMap((item) => {
      const image = record(item);
      return image ? [...artifacts("gallery_item", [string(image.id)]), ...artifacts("r2_key", [string(image.url)])] : [];
    });
  }
  if (
    path === "/api/announcements/images/stage" ||
    /^\/api\/(?:announcements|events)\/[^/]+\/images$/.test(path) ||
    /^\/api\/wiki\/articles\/[^/]+\/images$/.test(path) ||
    /^\/api\/users\/[^/]+\/media\/(?:images|avatar|audio)$/.test(path)
  ) return responseKeys;
  return [];
}

function isRunManagement(path: string): boolean {
  return path === "/api/admin/status/system-test-runs"
    || path === "/api/admin/status/system-test-audit"
    || /^\/api\/admin\/status\/system-test-runs\/[^/]+\/(?:cleanup|finalize)$/.test(path);
}

export function isAnonymousSystemTestPath(method: string, path: string): boolean {
  return method === "POST"
    && (path === "/api/auth/login" || /^\/api\/auth\/register\/[^/]+$/.test(path));
}

export async function systemTestTrackingMiddleware(c: Context, next: Next): Promise<Response | void> {
  if (c.req.header(SYSTEM_TEST_HEADER) !== SYSTEM_TEST_HEADER_VALUE || isRunManagement(c.req.path)) return next();
  const runId = c.req.header(SYSTEM_TEST_RUN_ID_HEADER);
  const service = new SystemTestService(c.env as Bindings);
  const sessionUser = await getRequestUser(c);
  const run = runId ? await service.beginRequest(runId) : null;
  if (
    !run
    || !runId
    || (sessionUser ? run.actorId !== sessionUser.id : !isAnonymousSystemTestPath(c.req.method, c.req.path))
  ) {
    if (run && runId) await service.endRequest(runId);
    return c.json({ error_code: "FORBIDDEN", message: "A valid active system-test run is required", request_id: c.get("requestId") }, 403);
  }
  const validRunId = runId;
  c.set("systemTestRunId" as never, validRunId as never);
  try {
    await next();
    if (c.res.status < 200 || c.res.status >= 300) return;
    const response = c.res.clone();
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) return;
    let body: unknown;
    try { body = await response.json(); } catch { return; }
    const created = extractSystemTestArtifacts(c.req.method, c.req.path, body);
    if (created.length === 0) return;
    let registered = false;
    for (let attempt = 0; attempt < 3 && !registered; attempt += 1) {
      try { await service.registerArtifacts(validRunId, created); registered = true; } catch { /* bounded retry below */ }
    }
    if (!registered) {
      // The response must never claim success when its exact cleanup locator could not be recorded.
      try {
        await service.cleanupExactArtifacts(created);
      } catch {
        await service.markCleanupFailed(
          validRunId,
          "artifact registration and exact compensation failed",
          created,
        );
      }
      c.res = c.json({ error_code: "SERVER_ERROR", message: "System-test artifact registration failed", request_id: c.get("requestId") }, 500);
    }
  } finally {
    await service.endRequest(validRunId);
  }
}
