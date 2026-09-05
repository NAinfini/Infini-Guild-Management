import type {
  InboxNotification,
  InboxNotificationListResponse,
  InboxNotificationUnreadCountResponse,
  NotificationPreferences,
  UpdateNotificationPreferences,
} from "@guild/shared";
import { AppError, type DeferredTasks, type NotificationPublisher, type RequestContext } from "@guild/kernel";
import { createAuditEvent, type AuditEventWrite } from "../audit/public.js";

export type NotificationInboxCursor = Readonly<{ occurredAt: string; id: string }>;

export interface NotificationInboxStore {
  countUnread(input: Readonly<{ userId: string; now: string }>): Promise<number>;
  list(input: Readonly<{
    userId: string;
    limit: number;
    cursor: NotificationInboxCursor | null;
    now: string;
  }>): Promise<Readonly<{
    data: readonly InboxNotification[];
    nextCursor: NotificationInboxCursor | null;
    unreadCount: number;
  }>>;
  markRead(input: Readonly<{
    userId: string;
    ids: readonly string[] | null;
    now: string;
  }>): Promise<number>;
  getPreferences(userId: string): Promise<NotificationPreferences>;
  updatePreferences(input: Readonly<{
    userId: string;
    patch: UpdateNotificationPreferences;
    now: string;
    audit: AuditEventWrite;
  }>): Promise<NotificationPreferences>;
}

export class NotificationInboxService {
  constructor(
    private readonly store: NotificationInboxStore,
    private readonly notifications: NotificationPublisher,
    private readonly deferred: DeferredTasks,
  ) {}

  async getUnreadCount(context: RequestContext): Promise<InboxNotificationUnreadCountResponse> {
    const actor = context.authorization.requireAuthenticated();
    return { unread_count: await this.store.countUnread({ userId: actor.userId, now: context.now }) };
  }

  async list(
    context: RequestContext,
    input: Readonly<{ limit: number; cursor: NotificationInboxCursor | null }>,
  ): Promise<InboxNotificationListResponse> {
    const actor = context.authorization.requireAuthenticated();
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) {
      throw new RangeError("Notification inbox limit must be between 1 and 50");
    }
    const page = await this.store.list({ ...input, userId: actor.userId, now: context.now });
    return {
      data: [...page.data],
      next_cursor: page.nextCursor === null ? null : encodeCursor(page.nextCursor),
      unread_count: page.unreadCount,
    };
  }

  async markRead(
    context: RequestContext,
    input: Readonly<{ ids: readonly string[] | null }>,
  ): Promise<Readonly<{ ok: true; unread_count: number }>> {
    const actor = context.authorization.requireAuthenticated();
    const unreadCount = await this.store.markRead({ userId: actor.userId, ids: input.ids, now: context.now });
    this.signalChanged(actor.userId);
    return { ok: true, unread_count: unreadCount };
  }

  async getPreferences(context: RequestContext): Promise<NotificationPreferences> {
    const actor = context.authorization.requireAuthenticated();
    return this.store.getPreferences(actor.userId);
  }

  async updatePreferences(
    context: RequestContext,
    input: UpdateNotificationPreferences,
  ): Promise<NotificationPreferences> {
    const actor = context.authorization.requireAuthenticated();
    const before = await this.store.getPreferences(actor.userId);
    const changed = (Object.keys(input) as Array<keyof UpdateNotificationPreferences>)
      .filter((key) => input[key] !== undefined && input[key] !== before[key]);
    if (changed.length === 0) return before;
    const audit = createAuditEvent(context, {
      subjectType: "user",
      subjectId: actor.userId,
      subjectLabel: null,
      action: "update",
      context: [{
        field: "changed_sections",
        value: { type: "list", value: changed.map((value) => ({ type: "code", value })) },
      }],
    });
    return this.store.updatePreferences({ userId: actor.userId, patch: input, now: context.now, audit });
  }

  private signalChanged(userId: string): void {
    this.deferred.defer(() => this.notifications.publish({ type: "inbox_changed", user_id: userId }));
  }
}

export function decodeNotificationInboxCursor(value: string | undefined): NotificationInboxCursor | null {
  if (value === undefined) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Record<string, unknown>;
    if (
      typeof parsed.occurred_at !== "string"
      || !Number.isFinite(Date.parse(parsed.occurred_at))
      || typeof parsed.id !== "string"
      || parsed.id.length < 1
      || parsed.id.length > 200
    ) {
      throw new Error();
    }
    return { occurredAt: parsed.occurred_at, id: parsed.id };
  } catch {
    throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Invalid notification cursor" });
  }
}

function encodeCursor(cursor: NotificationInboxCursor): string {
  return encodeURIComponent(JSON.stringify({ occurred_at: cursor.occurredAt, id: cursor.id }));
}
