import type { Event, PaginatedResponse, RecurringTemplate } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { apiRequest } from "../client";

export type EventDetailResponse = Event & {
  participants: Array<{ id: string; event_id: string; user_id: string; joined_at: string }>;
};

export function fetchEventsList(params: {
  page?: number;
  limit?: number;
  type?: string;
  archived?: boolean;
  pinned?: boolean;
  locked?: boolean;
  search?: string;
  start_after?: string;
  start_before?: string;
}): Promise<PaginatedResponse<Event>> {
  const page = params.page ?? 1;
  const limit = params.limit ?? LIMITS.pagination.events;
  const query = new URLSearchParams();
  query.set("page", String(page));
  query.set("limit", String(limit));
  if (params.type) {
    query.set("type", params.type);
  }
  if (params.archived !== undefined) {
    query.set("archived", String(params.archived));
  }
  if (params.pinned !== undefined) {
    query.set("pinned", String(params.pinned));
  }
  if (params.locked !== undefined) {
    query.set("locked", String(params.locked));
  }
  if (params.search) {
    query.set("search", params.search);
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

const BATCH_DETAIL_CHUNK_SIZE = 50;

export async function fetchEventDetailBatch(ids: string[]): Promise<{ data: EventDetailResponse[] }> {
  if (ids.length <= BATCH_DETAIL_CHUNK_SIZE) {
    return apiRequest<{ data: EventDetailResponse[] }>("/api/events/batch-details", {
      method: "POST",
      bodyJson: { ids },
    });
  }

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH_DETAIL_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + BATCH_DETAIL_CHUNK_SIZE));
  }

  const results = await Promise.allSettled(
    chunks.map((chunk) =>
      apiRequest<{ data: EventDetailResponse[] }>("/api/events/batch-details", {
        method: "POST",
        bodyJson: { ids: chunk },
      }),
    ),
  );

  return {
    data: results
      .filter((r): r is PromiseFulfilledResult<{ data: EventDetailResponse[] }> => r.status === "fulfilled")
      .flatMap((r) => r.value.data),
  };
}

export function fetchTemplatesList(): Promise<{ data: RecurringTemplate[] }> {
  return apiRequest<{ data: RecurringTemplate[] }>("/api/events/templates/list");
}
