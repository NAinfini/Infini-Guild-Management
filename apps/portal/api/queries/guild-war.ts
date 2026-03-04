import type { PaginatedResponse, WarHistory, WarTemplate } from "@guild/shared";
import { apiDownload, apiRequest } from "../client";

type WarTeamMember = {
  id: string;
  war_team_id: string;
  user_id: string;
  role_tag: string | null;
  sort_order: number;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  damage: number | null;
  healing: number | null;
  building_damage: number | null;
  credits: number | null;
  damage_taken: number | null;
  note: string | null;
};

type WarTeam = {
  id: string;
  war_history_id: string;
  team_name: string;
  sort_order: number;
  notes: string | null;
  is_locked: boolean;
  members: WarTeamMember[];
};

export type GuildWarAnalyticsMemberStat = {
  user_id: string;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  healing: number;
  building_damage: number;
  credits: number;
  damage_taken: number;
};

export type GuildWarActiveResponse = {
  event: unknown;
  teams: WarTeam[];
  pool: Array<{ id: string; warHistoryId: string; userId: string }>;
  etag?: string | null;
};

export type GuildWarHistoryDetailResponse = WarHistory & {
  teams: WarTeam[];
  pool: Array<{ id: string; warHistoryId: string; userId: string }>;
  member_stats: WarTeamMember[];
};

export function fetchGuildWarActive(eventId?: string): Promise<GuildWarActiveResponse> {
  const query = new URLSearchParams();
  if (eventId) query.set("event_id", eventId);
  return apiRequest<GuildWarActiveResponse>(`/api/guild-war/active${query.size > 0 ? `?${query.toString()}` : ""}`);
}

export function fetchGuildWarHistory(params: {
  page?: number;
  limit?: number;
  date_from?: string;
  date_to?: string;
}): Promise<PaginatedResponse<WarHistory>> {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("limit", String(params.limit ?? 20));
  if (params.date_from) query.set("date_from", params.date_from);
  if (params.date_to) query.set("date_to", params.date_to);

  return apiRequest<PaginatedResponse<WarHistory>>(`/api/guild-war/history?${query.toString()}`);
}

export function fetchGuildWarHistoryDetail(id: string): Promise<GuildWarHistoryDetailResponse> {
  return apiRequest<GuildWarHistoryDetailResponse>(`/api/guild-war/history/${id}`);
}

export function fetchGuildWarAnalytics(params: {
  war_ids?: string[];
  user_ids?: string[];
}): Promise<{ wars: WarHistory[]; member_stats: GuildWarAnalyticsMemberStat[] }> {
  const query = new URLSearchParams();
  if (params.war_ids && params.war_ids.length > 0) query.set("war_ids", params.war_ids.join(","));
  if (params.user_ids && params.user_ids.length > 0) query.set("user_ids", params.user_ids.join(","));

  return apiRequest<{ wars: WarHistory[]; member_stats: GuildWarAnalyticsMemberStat[] }>(
    `/api/guild-war/analytics${query.size > 0 ? `?${query.toString()}` : ""}`,
  );
}

export function fetchGuildWarTemplates(eventId?: string): Promise<WarTemplate[]> {
  const query = new URLSearchParams();
  if (eventId) query.set("event_id", eventId);

  return apiRequest<WarTemplate[]>(`/api/guild-war/templates${query.size > 0 ? `?${query.toString()}` : ""}`);
}

function parseFilenameFromContentDisposition(headerValue: string | null, fallback: string): string {
  if (!headerValue) {
    return fallback;
  }

  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const plainMatch = /filename="?([^";]+)"?/i.exec(headerValue);
  if (plainMatch?.[1]) {
    return plainMatch[1];
  }

  return fallback;
}

export async function downloadGuildWarExport(params: {
  format: "csv" | "json";
  event_id?: string;
  date_from?: string;
  date_to?: string;
}): Promise<{ filename: string; blob: Blob }> {
  const query = new URLSearchParams({
    format: params.format,
  });
  if (params.event_id) {
    query.set("event_id", params.event_id);
  }
  if (params.date_from) {
    query.set("date_from", params.date_from);
  }
  if (params.date_to) {
    query.set("date_to", params.date_to);
  }

  const { blob, headers } = await apiDownload(`/api/guild-war/export?${query.toString()}`);
  const fallback = `guild-war-history.${params.format}`;
  return {
    filename: parseFilenameFromContentDisposition(headers.get("Content-Disposition"), fallback),
    blob,
  };
}
