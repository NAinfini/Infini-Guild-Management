import type { ClassRotationConfigInput, GameDataBaseInput } from "@guild/shared/schemas/equipment-calc";
import { apiRequest } from "../client";

/** Everything except `rotations` — see fetchGameDataRotation for those. */
export function fetchGameData(): Promise<{ data: GameDataBaseInput; version: string; schemaVersion: number } | null> {
  return apiRequest("/api/game-data");
}

/** One class's rotation config. Fetched only for the class being calculated. */
export function fetchGameDataRotation(
  classId: string,
): Promise<{ class_id: string; version: string; rotation: ClassRotationConfigInput }> {
  return apiRequest(`/api/game-data/rotations/${encodeURIComponent(classId)}`);
}

/** The complete document, for the admin editor and JSON download. Admin only. */
export function fetchGameDataFull(): Promise<{ data: unknown; version: string; schemaVersion: number } | null> {
  return apiRequest("/api/game-data/full");
}

export function fetchGameDataVersions(): Promise<
  Array<{ id: number; version: string; uploaded_by: string; uploaded_by_name: string | null; created_at: string }>
> {
  return apiRequest("/api/game-data/versions");
}
