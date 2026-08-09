import { EventCrudService } from "./events/EventCrudService";
import { EventParticipantService } from "./events/EventParticipantService";
import { EventPollRaffleService } from "./events/EventPollRaffleService";
import { EventTemplateService } from "./events/EventTemplateService";
import type { TemplateRow, TemplateServiceDeps } from "./events/EventTemplateService";
import type {
  CreateEventInput,
  DatabaseLike,
  EventRow,
  EventServiceDeps,
  RawDbLike,
  UpdateEventInput,
} from "./events/EventCrudService";
import type { EventParticipantRow } from "./events/EventParticipantService";
import type { RaffleWinnerRow } from "./events/EventCrudService";
import type { ServiceResult } from "./result";
import type { ParsedImageMediaUpload } from "./MediaService";

export {
  parseAttachments,
  toEventPayload,
  toRaffleWinnerPayload,
  type EventRow,
  type RaffleWinnerRow,
} from "./events/EventCrudService";
export { toTemplatePayload, type TemplateRow } from "./events/EventTemplateService";
export { toParticipantPayload, type EventParticipantRow } from "./events/EventParticipantService";

export class EventService {
  private readonly crud: EventCrudService;
  private readonly participants: EventParticipantService;
  private readonly templates: EventTemplateService;
  private readonly pollRaffle: EventPollRaffleService;

  constructor(db: DatabaseLike, rawDb: RawDbLike, deps: EventServiceDeps, templateDeps: TemplateServiceDeps) {
    this.crud = new EventCrudService(db, rawDb, deps);
    this.participants = new EventParticipantService(db, rawDb, deps);
    this.templates = new EventTemplateService(db, rawDb, templateDeps);
    this.pollRaffle = new EventPollRaffleService(db, rawDb, deps);
  }

  static buildEventsWhereFilters = EventCrudService.buildEventsWhereFilters;

  createEvent(actorId: string, data: CreateEventInput, uploads: readonly ParsedImageMediaUpload[] = []): Promise<ServiceResult<EventRow>> {
    return this.crud.createEvent(actorId, data, uploads);
  }

  updateEvent(actorId: string, eventId: string, existing: EventRow, data: UpdateEventInput): Promise<ServiceResult<EventRow>> {
    return this.crud.updateEvent(actorId, eventId, existing, data);
  }

  archiveEvent(actorId: string, eventId: string, existing: EventRow) {
    return this.crud.archiveEvent(actorId, eventId, existing);
  }

  destroyEvent(actorId: string, eventId: string, existing: EventRow) {
    return this.crud.destroyEvent(actorId, eventId, existing);
  }

  uploadEventImages(actorId: string, eventId: string, existing: EventRow, uploads: readonly ParsedImageMediaUpload[]) {
    return this.crud.uploadEventImages(actorId, eventId, existing, uploads);
  }

  joinEvent(actorId: string, eventId: string): Promise<
    | { ok: true; participant: EventParticipantRow }
    | { ok: false; code: "NOT_FOUND" | "CONFLICT" | "SERVER_ERROR"; message: string }
  > {
    return this.participants.joinEvent(actorId, eventId);
  }

  leaveEvent(actorId: string, eventId: string): Promise<
    | { ok: true }
    | { ok: false; code: "NOT_FOUND" | "CONFLICT"; message: string }
  > {
    return this.participants.leaveEvent(actorId, eventId);
  }

  addParticipants(actorId: string, eventId: string, targetUserIds: string[]) {
    return this.participants.addParticipants(actorId, eventId, targetUserIds);
  }

  removeParticipants(actorId: string, eventId: string, targetUserIds: string[]) {
    return this.participants.removeParticipants(actorId, eventId, targetUserIds);
  }

  votePoll(actorId: string, eventId: string, optionIds: string[]) {
    return this.pollRaffle.votePoll(actorId, eventId, optionIds);
  }

  drawRaffleWinners(actorId: string, eventId: string): Promise<
    | { ok: true; winners: RaffleWinnerRow[] }
    | { ok: false; code: "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR"; message: string }
  > {
    return this.pollRaffle.drawRaffleWinners(actorId, eventId);
  }

  hasRaffleWinners(eventId: string): Promise<boolean> {
    return this.pollRaffle.hasRaffleWinners(eventId);
  }

  createTemplate(actorId: string, data: Parameters<EventTemplateService["createTemplate"]>[1]) {
    return this.templates.createTemplate(actorId, data);
  }

  updateTemplate(
    actorId: string,
    templateId: string,
    existing: TemplateRow,
    data: Parameters<EventTemplateService["updateTemplate"]>[3],
  ) {
    return this.templates.updateTemplate(actorId, templateId, existing, data);
  }

  pauseTemplate(actorId: string, templateId: string, existing: TemplateRow) {
    return this.templates.pauseTemplate(actorId, templateId, existing);
  }

  resumeTemplate(actorId: string, templateId: string, existing: TemplateRow) {
    return this.templates.resumeTemplate(actorId, templateId, existing);
  }

  deleteTemplate(actorId: string, templateId: string, existing: TemplateRow) {
    return this.templates.deleteTemplate(actorId, templateId, existing);
  }

  getEventById(eventId: string): Promise<EventRow | null> {
    return this.crud.getEventById(eventId);
  }

  getTemplateById(templateId: string): Promise<TemplateRow | null> {
    return this.templates.getTemplateById(templateId);
  }

  listEvents(params: Parameters<EventCrudService["listEvents"]>[0]) {
    return this.crud.listEvents(params);
  }

  getEventDetail(eventId: string, viewerId?: string | null, canManage = false) {
    return this.crud.getEventDetail(eventId, viewerId, canManage);
  }

  batchDetails(ids: string[], viewerId?: string | null, canManage = false) {
    return this.crud.batchDetails(ids, viewerId, canManage);
  }

  listTemplates() {
    return this.templates.listTemplates();
  }
}
