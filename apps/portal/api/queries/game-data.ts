import { apiRequest } from "../client";

export function fetchGameData(): Promise<{ data: unknown; version: string; schemaVersion: number }> {
  return apiRequest("/api/game-data");
}

export function fetchGameDataVersions(): Promise<
  Array<{ id: number; version: string; uploaded_by: string; created_at: string }>
> {
  return apiRequest("/api/game-data/versions");
}
