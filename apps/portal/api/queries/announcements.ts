import type { Announcement, PaginatedResponse } from "@guild/shared";
import { apiRequest } from "../client";

export function fetchAnnouncements(params: {
  page?: number;
  limit?: number;
  status?: string;
  pinned?: boolean;
  archived?: boolean;
  search?: string;
}): Promise<PaginatedResponse<Announcement>> {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("limit", String(params.limit ?? 50));
  if (params.status) query.set("status", params.status);
  if (params.pinned !== undefined) query.set("pinned", String(params.pinned));
  if (params.archived !== undefined) query.set("archived", String(params.archived));
  if (params.search) query.set("search", params.search);

  return apiRequest<PaginatedResponse<Announcement>>(`/api/announcements?${query.toString()}`);
}

export function fetchAnnouncement(id: string): Promise<Announcement> {
  return apiRequest<Announcement>(`/api/announcements/${id}`);
}
