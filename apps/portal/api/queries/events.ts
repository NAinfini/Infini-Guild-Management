import type { Event, PaginatedResponse } from "@guild/shared";
import { apiRequest } from "../client";

export type EventDetailResponse = Event & {
  participants: Array<{ id: string; event_id: string; user_id: string; joined_at: string }>;
};

export function fetchEventsList(params: {
  page?: number;
  limit?: number;
  type?: string;
  archived?: boolean;
  start_after?: string;
  start_before?: string;
}): Promise<PaginatedResponse<Event>> {
  const page = params.page ?? 1;
  const limit = params.limit ?? 100;
  const query = new URLSearchParams();
  query.set("page", String(page));
  query.set("limit", String(limit));
  if (params.type) {
    query.set("type", params.type);
  }
  if (params.archived !== undefined) {
    query.set("archived", String(params.archived));
  }
  if (params.start_after) {
    query.set("start_after", params.start_after);
  }
  if (params.start_before) {
    query.set("start_before", params.start_before);
  }

  return apiRequest<PaginatedResponse<Event>>(`/api/events?${query.toString()}`);
}

export function fetchEventDetail(eventId: string): Promise<EventDetailResponse> {
  return apiRequest<EventDetailResponse>(`/api/events/${eventId}`);
}
