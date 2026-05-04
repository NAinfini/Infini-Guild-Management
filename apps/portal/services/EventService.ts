import type { Event } from "@guild/shared";
import type { QueryClient } from "@tanstack/react-query";
import {
  addEventParticipant,
  addEventParticipants,
  archiveEvent,
  createEvent as createEventMutation,
  deleteEvent,
  type CreateEventPayload,
  joinEvent,
  leaveEvent,
  removeEventParticipant,
  removeEventParticipants,
  createTemplate,
  deleteTemplate,
  pauseTemplate,
  resumeTemplate,
  updateEvent as updateEventMutation,
  updateTemplate,
  uploadEventImages as uploadEventImagesMutation,
} from "../api/mutations/events";
import { queryKeys } from "../api/query-keys";
import {
  fetchEventDetail,
  fetchEventDetailBatch,
  fetchEventsList,
  fetchTemplatesList,
} from "../api/queries/events";
import type { EventDetailResponse } from "../api/queries/events";
import type { AttachmentItem, AttachmentService } from "./AttachmentService";

export {
  addEventParticipant,
  addEventParticipants,
  archiveEvent,
  createEventMutation as createEvent,
  createTemplate,
  deleteEvent,
  deleteTemplate,
  fetchEventDetail,
  fetchEventDetailBatch,
  fetchEventsList,
  fetchTemplatesList,
  joinEvent,
  leaveEvent,
  pauseTemplate,
  queryKeys,
  removeEventParticipant,
  removeEventParticipants,
  resumeTemplate,
  updateEventMutation as updateEvent,
  updateTemplate,
  uploadEventImagesMutation as uploadEventImages,
};
export type { CreateEventPayload, EventDetailResponse };

type EventValidationReason =
  | "missing_start"
  | "missing_title"
  | "invalid_capacity"
  | "missing_event_id";

export class EventValidationError extends Error {
  readonly reason: EventValidationReason;

  constructor(reason: EventValidationReason, message: string) {
    super(message);
    this.name = "EventValidationError";
    this.reason = reason;
  }
}

export type EventSaveInput = {
  mode: "create" | "edit";
  editingEventId: string | null;
  eventType: CreateEventPayload["type"];
  title: string;
  description: string;
  startAt: string;
  startIso: string | null;
  endAt: string;
  endIso: string | null;
  capacity: string;
  pinned: boolean;
  signupLocked: boolean;
  autoArchive: boolean;
  attachmentItems: AttachmentItem[];
};

type EventServiceDeps = {
  attachmentService: Pick<AttachmentService, "extractExistingUrls" | "extractNewFiles">;
  queryClient?: QueryClient;
  createEvent?: typeof createEventMutation;
  updateEvent?: typeof updateEventMutation;
  uploadEventImages?: typeof uploadEventImagesMutation;
};

export class EventService {
  private readonly attachmentService: Pick<AttachmentService, "extractExistingUrls" | "extractNewFiles">;
  private readonly queryClient?: QueryClient;
  private readonly createEventFn: typeof createEventMutation;
  private readonly updateEventFn: typeof updateEventMutation;
  private readonly uploadEventImagesFn: typeof uploadEventImagesMutation;

  constructor(deps: EventServiceDeps) {
    this.attachmentService = deps.attachmentService;
    this.queryClient = deps.queryClient;
    this.createEventFn = deps.createEvent ?? createEventMutation;
    this.updateEventFn = deps.updateEvent ?? updateEventMutation;
    this.uploadEventImagesFn = deps.uploadEventImages ?? uploadEventImagesMutation;
  }

  detectConflicts(input: Pick<EventSaveInput, "editingEventId" | "startIso" | "endIso">, events: Event[]): Event[] {
    if (!input.startIso) {
      return [];
    }

    const nextStart = Date.parse(input.startIso);
    const nextEnd = Date.parse(input.endIso ?? input.startIso);
    if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd)) {
      return [];
    }

    return events.filter((event) => {
      if (input.editingEventId && event.id === input.editingEventId) {
        return false;
      }
      const eventStart = Date.parse(event.start_at);
      const eventEnd = Date.parse(event.end_at ?? event.start_at);
      return Number.isFinite(eventStart) && Number.isFinite(eventEnd) && nextStart < eventEnd && eventStart < nextEnd;
    });
  }

  async saveEvent(input: EventSaveInput) {
    const payload = this.buildBasePayload(input);
    const filesToUpload = this.attachmentService.extractNewFiles(input.attachmentItems);

    if (input.mode === "create") {
      const response = await this.createEventFn(payload, filesToUpload);
      await this.invalidateEvents();
      return response;
    }

    if (!input.editingEventId) {
      throw new EventValidationError("missing_event_id", "Missing event id");
    }

    const existingAttachments = this.attachmentService.extractExistingUrls(input.attachmentItems);
    const nextAttachments = filesToUpload.length > 0
      ? (await this.uploadEventImagesFn(input.editingEventId, filesToUpload)).attachments ?? existingAttachments
      : existingAttachments;

    const response = await this.updateEventFn(input.editingEventId, {
      ...payload,
      pinned: input.pinned,
      signup_locked: input.signupLocked,
      auto_archive: input.autoArchive,
      attachments: nextAttachments,
    });
    await this.invalidateEvents();
    return response;
  }

  private buildBasePayload(input: EventSaveInput): CreateEventPayload {
    if (!input.startIso) {
      throw new EventValidationError("missing_start", "Start time required");
    }

    const title = input.title.trim();
    if (!title) {
      throw new EventValidationError("missing_title", "Title required");
    }

    let capacity: number | undefined;
    if (input.capacity.trim()) {
      const parsedCapacity = Number.parseInt(input.capacity, 10);
      if (Number.isNaN(parsedCapacity) || parsedCapacity < 1) {
        throw new EventValidationError("invalid_capacity", "Capacity must be positive");
      }
      capacity = parsedCapacity;
    }

    const description = input.description.trim();

    return {
      type: input.eventType,
      title,
      description: description || undefined,
      start_at: input.startIso,
      end_at: input.endIso ?? undefined,
      capacity,
      attachments: [],
      auto_archive: input.autoArchive,
    };
  }

  private async invalidateEvents() {
    await this.queryClient?.invalidateQueries({
      queryKey: queryKeys.events.all,
    });
  }
}
