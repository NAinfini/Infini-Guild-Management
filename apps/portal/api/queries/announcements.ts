import type { Announcement, AnnouncementSummary, PaginatedResponse } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { apiRequest } from "../client";
export type AnnouncementSort = "updated_desc" | "updated_asc";

export function fetchAnnouncements(params: {
  page?: number;
  limit?: number;
  status?: string;
  category?: AnnouncementSummary["category"];
  pinned?: boolean;
  search?: string;
  sort?: AnnouncementSort;
}): Promise<PaginatedResponse<AnnouncementSummary>> {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("limit", String(params.limit ?? LIMITS.pagination.announcements));
  query.set("sort", params.sort ?? "updated_desc");
  if (params.status) query.set("status", params.status);
  if (params.category) query.set("category", params.category);
  if (params.pinned !== undefined) query.set("pinned", String(params.pinned));
  if (params.search) query.set("search", params.search);

  return apiRequest<PaginatedResponse<AnnouncementSummary>>(`/api/announcements?${query.toString()}`);
}

export function recordAnnouncementView(id: string): Promise<{ view_count: number }> {
  return apiRequest<{ view_count: number }>(`/api/announcements/${id}/view`, { method: "POST" });
}

export function fetchAnnouncement(id: string): Promise<Announcement> {
  return apiRequest<Announcement>(`/api/announcements/${id}`);
}
