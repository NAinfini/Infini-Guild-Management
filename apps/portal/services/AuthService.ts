import { apiRequest } from "../api/client";

export function logout(): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>("/api/auth/logout", {
    method: "POST",
  });
}
