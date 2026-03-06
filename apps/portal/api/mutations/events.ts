import { type Event, type RecurringTemplate, createEventSchema, createTemplateSchema, updateEventSchema, updateTemplateSchema } from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";

export type CreateEventPayload = z.input<typeof createEventSchema>;
export type UpdateEventPayload = z.input<typeof updateEventSchema>;
export type CreateTemplatePayload = z.input<typeof createTemplateSchema>;
export type UpdateTemplatePayload = z.input<typeof updateTemplateSchema>;

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

export function createEvent(payload: CreateEventPayload): Promise<Event> {
  const bodyJson = createEventSchema.parse(payload);
  return apiRequest<Event>("/api/events", {
    method: "POST",
    bodyJson,
  });
}

export function updateEvent(eventId: string, payload: UpdateEventPayload): Promise<Event> {
  const bodyJson = updateEventSchema.parse(payload);
  return apiRequest<Event>(`/api/events/${eventId}`, {
    method: "PATCH",
    bodyJson,
  });
}

export function archiveEvent(eventId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/events/${eventId}`, {
    method: "DELETE",
  });
}

export function deleteEvent(eventId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/events/${eventId}/destroy`, {
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

export function removeEventParticipant(eventId: string, userId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/events/${eventId}/participants/${userId}`, {
    method: "DELETE",
  });
}

// ── Recurring Templates ──

export function createTemplate(payload: CreateTemplatePayload): Promise<RecurringTemplate> {
  const bodyJson = createTemplateSchema.parse(payload);
  return apiRequest<RecurringTemplate>("/api/events/templates", {
    method: "POST",
    bodyJson,
  });
}

export function updateTemplate(templateId: string, payload: UpdateTemplatePayload): Promise<RecurringTemplate> {
  const bodyJson = updateTemplateSchema.parse(payload);
  return apiRequest<RecurringTemplate>(`/api/events/templates/${templateId}`, {
    method: "PATCH",
    bodyJson,
  });
}

export function pauseTemplate(templateId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/events/templates/${templateId}/pause`, {
    method: "POST",
  });
}

export function resumeTemplate(templateId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/events/templates/${templateId}/resume`, {
    method: "POST",
  });
}

export function deleteTemplate(templateId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/events/templates/${templateId}`, {
    method: "DELETE",
  });
}
