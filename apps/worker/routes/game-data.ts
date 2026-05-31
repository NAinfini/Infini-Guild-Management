import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { requirePermission } from "../middleware/rbac";
import { writeAuditLog } from "../services/audit";
import { GameDataService } from "../services/GameDataService";
import { buildError, handleResult, parseJsonBody, safeFormData } from "./_shared";

export const gameDataRoutes = new Hono();

function getService(c: Context): GameDataService {
  const env = c.env as Bindings;
  return new GameDataService(drizzle(env.DB), {
    writeAuditLog: (input) => writeAuditLog(c, input),
    putR2Object: async (key, body, options) => {
      await env.MEDIA.put(key, body, options);
    },
  });
}

async function requireGameDataManage(c: Context) {
  return requirePermission(c, "admin.gameData.manage");
}

// GET / — public, returns latest game data
gameDataRoutes.get("/", async (c) => {
  const result = await getService(c).getLatest();
  return handleResult(c, result);
});

// GET /versions — admin only, returns version list
gameDataRoutes.get("/versions", async (c) => {
  const sessionUser = await requireGameDataManage(c);
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getService(c).getVersions();
  return handleResult(c, result);
});

// POST / — admin only, upload new game data JSON
gameDataRoutes.post("/", async (c) => {
  const sessionUser = await requireGameDataManage(c);
  if (sessionUser instanceof Response) return sessionUser;
  let jsonString: string;
  try {
    jsonString = await c.req.text();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Failed to read request body");
  }
  if (!jsonString) return buildError(c, "VALIDATION_ERROR", "Empty request body");
  const result = await getService(c).upload(jsonString, sessionUser.id);
  return handleResult(c, result, 201);
});

// POST /rollback — admin only, body: { version_id: number }
gameDataRoutes.post("/rollback", async (c) => {
  const sessionUser = await requireGameDataManage(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const { version_id } = body as { version_id: number };
  if (typeof version_id !== "number" || !Number.isFinite(version_id)) {
    return buildError(c, "VALIDATION_ERROR", "version_id must be a number");
  }
  const result = await getService(c).rollback(version_id, sessionUser.id);
  return handleResult(c, result, 201);
});

// POST /icons — admin only, multipart form with key + file
gameDataRoutes.post("/icons", async (c) => {
  const sessionUser = await requireGameDataManage(c);
  if (sessionUser instanceof Response) return sessionUser;
  const form = await safeFormData(c);
  if (form instanceof Response) return form;
  const key = form.get("key");
  if (typeof key !== "string" || !key.trim()) {
    return buildError(c, "VALIDATION_ERROR", "Missing or empty 'key' field");
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return buildError(c, "VALIDATION_ERROR", "Missing 'file' field");
  }
  const result = await getService(c).uploadIcon(key.trim(), file, sessionUser.id);
  return handleResult(c, result, 201);
});
