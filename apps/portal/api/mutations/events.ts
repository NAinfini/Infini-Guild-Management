import type { Event } from "@guild/shared";
import { apiRequest } from "../client";

export type EventMutationPayload = {
  type?: string;
  title?: string;
  description?: string | null;
  start_at?: string;
  end_at?: string | null;
  capacity?: number | null;
  pinned?: boolean;
  signup_locked?: boolean;
  archived_at?: string | null;
  recurrence_rule?: {
    frequency: "daily" | "weekly" | "monthly";
    interval: number;
    daysOfWeek?: number[];
    endAfter?: number;
    endDate?: string;
  } | null;
  attachments?: string[];
  recurrence_scope?: "this" | "future" | "all";
};

export function joinEvent(eventId: string): Promise<{ id: string }> {
  return apiRequest<{ id: string }>(`/api/events/${eventId}/join`, {
    method: "POST",
  });
}

export function leaveEvent(eventId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/events/${eventId}/leave`, {
    method: "DELETE",
  });
}

export function createEvent(payload: EventMutationPayload): Promise<Event> {
  return apiRequest<Event>("/api/events", {
    method: "POST",
    bodyJson: payload,
  });
}

export function updateEvent(eventId: string, payload: EventMutationPayload): Promise<Event> {
  return apiRequest<Event>(`/api/events/${eventId}`, {
    method: "PATCH",
    bodyJson: payload,
  });
}

export function archiveEvent(eventId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/events/${eventId}`, {
    method: "DELETE",
  });
}

export function uploadEventImages(eventId: string, files: File[]): Promise<{ keys: string[]; attachments: string[] }> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  return apiRequest<{ keys: string[]; attachments: string[] }>(`/api/events/${eventId}/images`, {
    method: "POST",
    body: formData,
  });
}

export function addEventParticipant(
  eventId: string,
  userId: string,
): Promise<{ id: string; event_id: string; user_id: string; joined_at: string }> {
  return apiRequest<{ id: string; event_id: string; user_id: string; joined_at: string }>(`/api/events/${eventId}/participants`, {
    method: "POST",
    bodyJson: {
      user_id: userId,
    },
  });
}
