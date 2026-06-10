import { gameDataSchema, type GameDataInput } from "@guild/shared/schemas/equipment-calc";
import type { WriteAuditLogInput as AuditLogInput } from "./audit";
import { desc, eq, inArray, not } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { gameData } from "../db/schema/game-data";
import { users } from "../db/schema/auth";
import { ok, err, type ServiceResult } from "./result";
import { validateUploadBytes } from "./media";

type DrizzleDb = DrizzleD1Database<Record<string, never>>;
type SemanticValidationResult = { ok: true } | { ok: false; message: string };

export type GameDataServiceDeps = {
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  putR2Object: (key: string, body: ArrayBuffer | ReadableStream, options?: { httpMetadata?: { contentType: string } }) => Promise<void>;
};

const MAX_JSON_SIZE = 1024 * 1024; // 1 MB
const MAX_VERSIONS = 5;
const ALLOWED_ICON_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const NON_STAT_SLOT_RULE_VALUES = new Set(["无", "生存类词条", "生存向"]);

export class GameDataService {
  private db: DrizzleDb;
  private deps: GameDataServiceDeps;

  constructor(db: DrizzleDb, deps: GameDataServiceDeps) {
    this.db = db;
    this.deps = deps;
  }

  async getLatest(): Promise<ServiceResult<{ data: GameDataInput; version: string; schemaVersion: number } | null>> {
    const [latest] = await this.db
      .select({ id: gameData.id, data: gameData.data, version: gameData.version })
      .from(gameData)
      .orderBy(desc(gameData.createdAt))
      .limit(1);

    if (!latest) return ok(null);

    const parsed = this.parseStoredGameData(latest.data);
    if (!parsed.ok) return parsed;

    return ok({ data: parsed.data, version: parsed.data.version, schemaVersion: parsed.data.schemaVersion });
  }

  async getVersions(): Promise<ServiceResult<{ id: number; version: string; uploaded_by: string; uploaded_by_name: string | null; created_at: string }[]>> {
    const rows = await this.db
      .select({
        id: gameData.id,
        version: gameData.version,
        uploadedBy: gameData.uploadedBy,
        uploadedByName: users.username,
        createdAt: gameData.createdAt,
      })
      .from(gameData)
      .leftJoin(users, eq(users.id, gameData.uploadedBy))
      .orderBy(desc(gameData.createdAt))
      .limit(MAX_VERSIONS);

    return ok(rows.map((r) => ({ id: r.id, version: r.version, uploaded_by: r.uploadedBy, uploaded_by_name: r.uploadedByName, created_at: r.createdAt })));
  }

  async upload(jsonString: string, uploadedBy: string): Promise<ServiceResult<{ version: string; id: number }>> {
    if (new TextEncoder().encode(jsonString).byteLength > MAX_JSON_SIZE) {
      return err("VALIDATION_ERROR", "Game data JSON exceeds 1 MB limit");
    }

    let raw: unknown;
    try {
      raw = JSON.parse(jsonString);
    } catch {
      return err("VALIDATION_ERROR", "Invalid JSON");
    }

    const parsed = gameDataSchema.safeParse(raw);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Game data validation failed", parsed.error.flatten());
    }
    const data = parsed.data;

    const semanticValidation = this.validateGameDataSemantics(data);
    if (!semanticValidation.ok) return err("VALIDATION_ERROR", semanticValidation.message);

    const rows = await this.db
      .insert(gameData)
      .values({
        data: jsonString,
        version: data.version,
        uploadedBy,
      })
      .returning({ id: gameData.id });

    const insertedId = rows[0]?.id;
    if (insertedId === undefined) return err("SERVER_ERROR", "Failed to insert game data");

    await this.pruneOldVersions();

    await this.deps.writeAuditLog({
      entityType: "game_data",
      action: "upload",
      actorId: uploadedBy,
      entityId: String(insertedId),
      diffTitle: data.version,
    });

    return ok({ version: data.version, id: insertedId });
  }

  async rollback(versionId: number, actorId: string): Promise<ServiceResult<{ version: string; id: number }>> {
    const row = (
      await this.db
        .select({ id: gameData.id, data: gameData.data, version: gameData.version })
        .from(gameData)
        .where(eq(gameData.id, versionId))
        .limit(1)
    )[0];
    if (!row) return err("NOT_FOUND", "Version not found");

    const parsed = this.parseStoredGameData(row.data);
    if (!parsed.ok) return parsed;

    // Clone as new latest
    const rows = await this.db
      .insert(gameData)
      .values({
        data: row.data,
        version: row.version,
        uploadedBy: actorId,
      })
      .returning({ id: gameData.id });

    const insertedId = rows[0]?.id;
    if (insertedId === undefined) return err("SERVER_ERROR", "Failed to clone version");

    await this.pruneOldVersions();

    await this.deps.writeAuditLog({
      entityType: "game_data",
      action: "rollback",
      actorId,
      entityId: String(insertedId),
      diffTitle: row.version,
      detailText: JSON.stringify({ from_version_id: versionId }),
    });

    return ok({ version: row.version, id: insertedId });
  }

  async uploadIcon(key: string, file: File, actorId: string): Promise<ServiceResult<{ key: string }>> {
    if (!ALLOWED_ICON_TYPES.has(file.type)) {
      return err("VALIDATION_ERROR", `Invalid icon MIME type: ${file.type}. Allowed: png, jpeg, webp, svg+xml`);
    }

    const r2Key = `game-data/icons/${key}`;
    const buffer = await file.arrayBuffer();
    const validation = validateUploadBytes(buffer, file.type, ALLOWED_ICON_TYPES);
    if (!validation.ok) return err("VALIDATION_ERROR", validation.message);

    await this.deps.putR2Object(r2Key, buffer, {
      httpMetadata: { contentType: validation.contentType },
    });

    await this.deps.writeAuditLog({
      entityType: "game_data",
      action: "upload_icon",
      actorId,
      entityId: key,
      diffTitle: key,
    });

    return ok({ key: r2Key });
  }

  private async pruneOldVersions(): Promise<void> {
    const keepRows = await this.db
      .select({ id: gameData.id })
      .from(gameData)
      .orderBy(desc(gameData.createdAt))
      .limit(MAX_VERSIONS);

    if (keepRows.length < MAX_VERSIONS) return;

    const keepIds = keepRows.map((r) => r.id);
    await this.db.delete(gameData).where(not(inArray(gameData.id, keepIds)));
  }

  private parseStoredGameData(data: string): ServiceResult<GameDataInput> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return err("SERVER_ERROR", "Stored game data is corrupted");
    }

    const validated = gameDataSchema.safeParse(parsed);
    if (!validated.success) {
      return err("SERVER_ERROR", "Stored game data failed validation", validated.error.flatten());
    }
    const semanticValidation = this.validateGameDataSemantics(validated.data);
    if (!semanticValidation.ok) {
      return err("SERVER_ERROR", "Stored game data failed semantic validation", { validation_error: semanticValidation.message });
    }
    return ok(validated.data);
  }

  private validateGameDataSemantics(data: GameDataInput): SemanticValidationResult {
    const maxValueKeys = new Set(Object.keys(data.maxValues));
    for (const [slotId, stats] of Object.entries(data.slotRules.mainStats)) {
      for (const stat of stats) {
        if (NON_STAT_SLOT_RULE_VALUES.has(stat)) continue;
        if (!maxValueKeys.has(stat)) {
          return { ok: false, message: `slotRules.mainStats["${slotId}"] references stat "${stat}" not found in maxValues` };
        }
      }
    }
    for (const [slotId, stats] of Object.entries(data.slotRules.dingyinStats)) {
      for (const stat of stats) {
        if (NON_STAT_SLOT_RULE_VALUES.has(stat)) continue;
        if (!maxValueKeys.has(stat)) {
          return { ok: false, message: `slotRules.dingyinStats["${slotId}"] references stat "${stat}" not found in maxValues` };
        }
      }
    }

    for (const [classId, config] of Object.entries(data.rotations)) {
      const skillNames = new Set(Object.keys(config.skillDatabase));
      let executableCount = 0;
      for (const entry of config.rotation) {
        if (skillNames.has(entry.name)) {
          executableCount += 1;
        }
      }
      if (executableCount === 0) {
        return { ok: false, message: `rotations["${classId}"] has no executable skill entries` };
      }
    }

    return { ok: true };
  }
}
