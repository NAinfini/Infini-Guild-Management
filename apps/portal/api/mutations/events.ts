import { type Event, type EventParticipant, type EventRaffleWinner, type RecurringTemplate, createEventSchema, createTemplateSchema, eventParticipantsBatchSchema, pollVoteSchema, updateEventSchema, updateTemplateSchema } from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";
import { convertFilesForUpload } from "@guild/shared/utils/media";

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

export function votePoll(eventId: string, optionIds: string[]): Promise<{ ok: true }> {
  const bodyJson = pollVoteSchema.parse({ option_ids: optionIds });
  return apiRequest<{ ok: true }>(`/api/events/${eventId}/poll/vote`, {
    method: "POST",
    bodyJson,
  });
}

export async function createEvent(payload: CreateEventPayload, files?: File[]): Promise<Event> {
  const bodyJson = createEventSchema.parse(payload);
  if (!files || files.length === 0) {
    return apiRequest<Event>("/api/events", {
      method: "POST",
      bodyJson,
    });
  }
  const converted = await convertFilesForUpload(files);
  const formData = new FormData();
  formData.append("data", JSON.stringify(bodyJson));
  for (const file of converted) {
    formData.append("files", file);
  }
  return apiRequest<Event>("/api/events", {
    method: "POST",
    body: formData,
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

export async function uploadEventImages(eventId: string, files: File[]): Promise<{ keys: string[]; attachments: string[] }> {
  const converted = await convertFilesForUpload(files);
  const formData = new FormData();
  for (const file of converted) {
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
  return addEventParticipants(eventId, [userId]).then((result) => {
    const participant = result.data[0];
    if (!participant) throw new Error("Participant was not added");
    return participant;
  });
}

export function removeEventParticipant(eventId: string, userId: string): Promise<{ ok: true }> {
  return removeEventParticipants(eventId, [userId]).then(() => ({ ok: true as const }));
}

export function addEventParticipants(eventId: string, userIds: string[]): Promise<{ data: EventParticipant[] }> {
  const bodyJson = eventParticipantsBatchSchema.parse({ user_ids: userIds });
  return apiRequest<{ data: EventParticipant[] }>(`/api/events/${eventId}/participants`, {
    method: "POST",
    bodyJson,
  });
}

export function removeEventParticipants(eventId: string, userIds: string[]): Promise<{ ok: true; removed: number }> {
  const bodyJson = eventParticipantsBatchSchema.parse({ user_ids: userIds });
  return apiRequest<{ ok: true; removed: number }>(`/api/events/${eventId}/participants`, {
    method: "DELETE",
    bodyJson,
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

export function drawRaffle(eventId: string): Promise<{ data: EventRaffleWinner[] }> {
  return apiRequest<{ data: EventRaffleWinner[] }>(`/api/events/${eventId}/raffle/draw`, {
    method: "POST",
  });
}
