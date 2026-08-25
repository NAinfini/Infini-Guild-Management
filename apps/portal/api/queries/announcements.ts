import type { Announcement, AnnouncementSummary, PaginatedResponse } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { apiRequest } from "../client";
export type AnnouncementSort = "updated_desc" | "updated_asc";

export function fetchAnnouncements(params: {
  page?: number;
  limit?: number;
  status?: string;
  pinned?: boolean;
  archived?: boolean;
  search?: string;
  sort?: AnnouncementSort;
}): Promise<PaginatedResponse<AnnouncementSummary>> {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("limit", String(params.limit ?? LIMITS.pagination.announcements));
  query.set("sort", params.sort ?? "updated_desc");
  if (params.status) query.set("status", params.status);
  if (params.pinned !== undefined) query.set("pinned", String(params.pinned));
  if (params.archived !== undefined) query.set("archived", String(params.archived));
  if (params.search) query.set("search", params.search);

  return apiRequest<PaginatedResponse<Announcement>>(`/api/announcements?${query.toString()}`);
}

export function fetchAnnouncement(id: string): Promise<Announcement> {
  return apiRequest<Announcement>(`/api/announcements/${id}`);
}
