import {
  loginLockStateSchema,
  type AuditEvent,
  type CursorResponse,
  type InviteLink,
} from "@guild/shared";
import {
  adminOperationsResponseSchema,
  type AdminOperationsResponse,
} from "@guild/shared/schemas/admin-operations";
import {
  blobReconciliationResponseSchema,
  type BlobReconciliationCheckpointWire,
  type BlobReconciliationResponse,
} from "@guild/shared/schemas/blob-reconciliation";
import { LIMITS } from "@guild/shared/config/limits";
import type { z } from "zod";
import { apiDownload, apiRequest } from "../client";

export type { AdminOperationsResponse };

export type AdminLoginLockState = z.infer<typeof loginLockStateSchema>;

export type InviteLinkStatsSummary = {
  total: number;
  active: number;
  revoked: number;
  expired: number;
};

export type InviteVisibility = "active" | "expired" | "revoked";

export type AdminInviteLinksResponse = CursorResponse<InviteLink> & {
  total: number;
};

export type AdminStatus = {
  db: string;
  r2: string;
  ws: string;
  crons: string;
};

export type AdminAuditArchiveDownloadFile = {
  key: string;
  row_count: number;
  size_bytes: number;
  expires_at: string;
  url: string;
};

export type AdminAuditArchiveDownloadResponse = {
  month: string;
  expires_in_seconds: number;
  files: AdminAuditArchiveDownloadFile[];
};

export type AdminAuditExportParams = {
  format: "csv" | "json";
  entity_type?: string;
  entity_id?: string;
  actor_id?: string;
  search?: string;
  start_at?: string;
  end_at?: string;
};

export function fetchAdminInviteLinks(params: {
  cursor?: string;
  limit?: number;
  visibility: InviteVisibility;
  search?: string;
}): Promise<AdminInviteLinksResponse> {
  const query = new URLSearchParams();
  if (params.cursor !== undefined) query.set("cursor", params.cursor);
  query.set("limit", String(params.limit ?? LIMITS.pagination.admin));
  query.set("visibility", params.visibility);
  if (params.search) query.set("search", params.search);

  return apiRequest<AdminInviteLinksResponse>(`/api/admin/invite-links?${query.toString()}`);
}

export function fetchAdminInviteStats(): Promise<InviteLinkStatsSummary> {
  return apiRequest<InviteLinkStatsSummary>("/api/admin/invite-links/stats");
}

export function fetchAdminAuditLog(params: {
  cursor?: string;
  limit?: number;
  entity_type?: string;
  entity_id?: string;
  actor_id?: string;
  search?: string;
  start_at?: string;
  end_at?: string;
}): Promise<CursorResponse<AuditEvent>> {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  query.set("limit", String(params.limit ?? LIMITS.pagination.admin));
  if (params.entity_type) query.set("entity_type", params.entity_type);
  if (params.entity_id) query.set("entity_id", params.entity_id);
  if (params.actor_id) query.set("actor_id", params.actor_id);
  if (params.search) query.set("search", params.search);
  if (params.start_at) query.set("start_at", params.start_at);
  if (params.end_at) query.set("end_at", params.end_at);

  return apiRequest<CursorResponse<AuditEvent>>(`/api/admin/audit-log?${query.toString()}`);
}

export async function downloadAdminAuditLogExport(params: AdminAuditExportParams): Promise<Blob> {
  const query = new URLSearchParams();
  query.set("format", params.format);
  if (params.entity_type) query.set("entity_type", params.entity_type);
  if (params.actor_id) query.set("actor_id", params.actor_id);
  if (params.search) query.set("search", params.search);
  if (params.start_at) query.set("start_at", params.start_at);
  if (params.end_at) query.set("end_at", params.end_at);

  const { blob } = await apiDownload(`/api/admin/audit-log/export?${query.toString()}`);
  return blob;
}

export function fetchAdminAuditArchiveMonths(): Promise<{ months: string[] }> {
  return apiRequest<{ months: string[] }>("/api/admin/audit-archive/months");
}

export function requestAdminAuditArchiveDownload(
  month: string,
): Promise<AdminAuditArchiveDownloadResponse> {
  const query = new URLSearchParams({ month });
  return apiRequest<AdminAuditArchiveDownloadResponse>(`/api/admin/audit-archive/download?${query.toString()}`);
}

export async function downloadAdminAuditArchiveFile(url: string): Promise<Blob> {
  const { blob } = await apiDownload(url);
  return blob;
}

export function fetchAdminStatus(): Promise<AdminStatus> {
  return apiRequest<AdminStatus>("/api/admin/status");
}

export async function fetchAdminOperations(): Promise<AdminOperationsResponse> {
  return adminOperationsResponseSchema.parse(
    await apiRequest<unknown>("/api/admin/operations"),
  );
}

export async function fetchBlobReconciliationPage(
  checkpoint: BlobReconciliationCheckpointWire = { phase: "manifest" },
): Promise<BlobReconciliationResponse> {
  const query = new URLSearchParams({ phase: checkpoint.phase, limit: "50" });
  if (checkpoint.phase === "inventory") query.set("prefix", checkpoint.prefix);
  if (checkpoint.checkpoint) query.set("checkpoint", checkpoint.checkpoint);
  return blobReconciliationResponseSchema.parse(
    await apiRequest<unknown>(`/api/admin/blob-reconciliation?${query.toString()}`),
  );
}

export function fetchAdminUserLoginLock(userId: string): Promise<AdminLoginLockState> {
  return apiRequest<AdminLoginLockState>(`/api/admin/users/${userId}/login-lock`);
}
