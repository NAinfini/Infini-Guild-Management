import type {
  AuditLogEntry,
  BotSettings,
  InviteLink,
  InviteLinkStats,
  PaginatedResponse,
} from "@guild/shared";
import { apiDownload, apiRequest } from "../client";

export type InviteLinkStatsSummary = {
  total: number;
  active: number;
  revoked: number;
  expired: number;
  data: InviteLinkStats[];
};

export type AdminStatus = {
  db: string;
  r2: string;
  ws: string;
  crons: string;
};

export type AdminDiscordChannel = {
  id: string;
  name: string;
  type: string;
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
  format: "raw_ndjson_gz" | "csv";
  expires_in_seconds: number;
  files: AdminAuditArchiveDownloadFile[];
};

export type AdminAuditArchiveMonthResponse = {
  month: string;
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  data: AuditLogEntry[];
  source?: "r2_manifest";
  manifest?: {
    generated_at: string;
    total_rows: number;
    file_count: number;
    total_size_bytes?: number;
  } | null;
};

export type AdminAuditExportParams = {
  format: "csv" | "json";
  entity_type?: string;
  actor_id?: string;
  search?: string;
  start_at?: string;
  end_at?: string;
};

export function fetchAdminInviteLinks(params: {
  include_expired?: boolean;
  include_revoked?: boolean;
} = {}): Promise<InviteLink[]> {
  const query = new URLSearchParams();
  if (params.include_expired !== undefined) {
    query.set("include_expired", String(params.include_expired));
  }
  if (params.include_revoked !== undefined) {
    query.set("include_revoked", String(params.include_revoked));
  }

  return apiRequest<InviteLink[]>(
    `/api/admin/invite-links${query.size > 0 ? `?${query.toString()}` : ""}`,
  );
}

export function fetchAdminInviteStats(): Promise<InviteLinkStatsSummary> {
  return apiRequest<InviteLinkStatsSummary>("/api/admin/invite-links/stats");
}

export function fetchAdminAuditLog(params: {
  page?: number;
  limit?: number;
  entity_type?: string;
  actor_id?: string;
  search?: string;
  start_at?: string;
  end_at?: string;
}): Promise<PaginatedResponse<AuditLogEntry>> {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("limit", String(params.limit ?? 50));
  if (params.entity_type) query.set("entity_type", params.entity_type);
  if (params.actor_id) query.set("actor_id", params.actor_id);
  if (params.search) query.set("search", params.search);
  if (params.start_at) query.set("start_at", params.start_at);
  if (params.end_at) query.set("end_at", params.end_at);

  return apiRequest<PaginatedResponse<AuditLogEntry>>(`/api/admin/audit-log?${query.toString()}`);
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

export function fetchAdminAuditArchiveMonth(
  month: string,
  params?: { page?: number; limit?: number },
): Promise<AdminAuditArchiveMonthResponse> {
  const query = new URLSearchParams();
  if (params?.page !== undefined) query.set("page", String(params.page));
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return apiRequest<AdminAuditArchiveMonthResponse>(`/api/admin/audit-archive/${month}${suffix}`);
}

export function requestAdminAuditArchiveDownload(
  month: string,
  format: "raw_ndjson_gz" | "csv" = "raw_ndjson_gz",
): Promise<AdminAuditArchiveDownloadResponse> {
  const query = new URLSearchParams({
    month,
    format,
  });
  return apiRequest<AdminAuditArchiveDownloadResponse>(`/api/admin/audit-archive/download?${query.toString()}`);
}

export async function downloadAdminAuditArchiveFile(url: string): Promise<Blob> {
  const { blob } = await apiDownload(url);
  return blob;
}

export function fetchAdminBotSettings(): Promise<BotSettings> {
  return apiRequest<BotSettings>("/api/admin/bot-settings");
}

export function fetchAdminDiscordChannels(guildId?: string): Promise<{ guild_id: string; channels: AdminDiscordChannel[] }> {
  const query = new URLSearchParams();
  if (guildId && guildId.trim()) {
    query.set("guild_id", guildId.trim());
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return apiRequest<{ guild_id: string; channels: AdminDiscordChannel[] }>(
    `/api/admin/bot-settings/discord/channels${suffix}`,
  );
}

export function fetchAdminStatus(): Promise<AdminStatus> {
  return apiRequest<AdminStatus>("/api/admin/status");
}
