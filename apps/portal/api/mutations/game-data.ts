import { apiRequest } from "../client";

export function uploadGameData(jsonString: string): Promise<{ version: string }> {
  return apiRequest("/api/game-data", {
    method: "POST",
    body: jsonString,
    headers: { "Content-Type": "application/json" },
  });
}

export function rollbackGameData(versionId: number): Promise<{ version: string }> {
  return apiRequest("/api/game-data/rollback", {
    method: "POST",
    bodyJson: { version_id: versionId },
  });
}
