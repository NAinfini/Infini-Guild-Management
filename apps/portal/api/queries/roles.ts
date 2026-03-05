import type { AdminRole } from "@guild/shared";
import { apiRequest } from "../client";

export function fetchRoles(): Promise<AdminRole[]> {
  return apiRequest<AdminRole[]>("/api/admin/roles");
}
