import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { requirePermission } from "../middleware/rbac";
import { writeAuditLog } from "../services/audit";
import { GameDataService } from "../services/GameDataService";
import { buildError, handleResult, parseJsonBody } from "./_shared";

export const gameDataRoutes = new Hono();

function getService(c: Context): GameDataService {
  const env = c.env as Bindings;
  return new GameDataService(drizzle(env.DB), {
    writeAuditLog: (input) => writeAuditLog(c, input),
  });
}

async function requireGameDataManage(c: Context) {
  return requirePermission(c, "admin.gameData.manage");
}

// GET / — public, latest game data without rotations (see GameDataService.getLatest)
gameDataRoutes.get("/", async (c) => {
  const result = await getService(c).getLatest();
  return handleResult(c, result);
});

// GET /rotations/:classId — public, one class's rotation config
gameDataRoutes.get("/rotations/:classId", async (c) => {
  const result = await getService(c).getRotation(c.req.param("classId"));
  return handleResult(c, result);
});

// GET /full — admin only, the whole document for the editor and JSON download
gameDataRoutes.get("/full", async (c) => {
  await requireGameDataManage(c);
  const result = await getService(c).getFull();
  return handleResult(c, result);
});

// GET /versions — admin only, returns version list
gameDataRoutes.get("/versions", async (c) => {
  await requireGameDataManage(c);
  const result = await getService(c).getVersions();
  return handleResult(c, result);
});

// POST / — admin only, upload new game data JSON
gameDataRoutes.post("/", async (c) => {
  const sessionUser = await requireGameDataManage(c);
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
  const body = await parseJsonBody(c);
  const { version_id } = body as { version_id: number };
  if (typeof version_id !== "number" || !Number.isFinite(version_id)) {
    return buildError(c, "VALIDATION_ERROR", "version_id must be a number");
  }
  const result = await getService(c).rollback(version_id, sessionUser.id);
  return handleResult(c, result, 201);
});
