import { z } from "zod";
import { PUSH_ENTITY_TYPES, PUSH_HINTS } from "../constants/push-hints";

export const entityChangedPushMessageSchema = z.object({
  type: z.literal("entity_changed"),
  entity_type: z.enum(PUSH_ENTITY_TYPES),
  entity_id: z.string().min(1).max(200),
  updated_at: z.string().datetime(),
  hint: z.enum(PUSH_HINTS),
  display_name: z.string().max(200).optional(),
}).strict();

export const memberOnlinePushMessageSchema = z.object({
  type: z.literal("member_online"),
  user_id: z.string().min(1).max(200),
  source: z.literal("portal"),
  online_at: z.string().datetime(),
}).strict();

export const announcementPublishedPushMessageSchema = z.object({
  type: z.literal("announcement_published"),
  announcement_id: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  published_at: z.string().datetime(),
}).strict();

export const inboxChangedPushMessageSchema = z.object({
  type: z.literal("inbox_changed"),
  user_id: z.string().min(1).max(200).optional(),
}).strict();

const inboxNotificationBaseSchema = z.object({
  id: z.string().min(1).max(200),
  entity_id: z.string().min(1).max(200),
  occurred_at: z.string().datetime({ offset: true }),
  read_at: z.string().datetime({ offset: true }).nullable(),
});

export const inboxNotificationSchema = z.discriminatedUnion("kind", [
  inboxNotificationBaseSchema.extend({
    kind: z.literal("member_joined"),
    entity_type: z.literal("member"),
    payload: z.object({ display_name: z.string().min(1).max(200) }).strict(),
  }).strict(),
  inboxNotificationBaseSchema.extend({
    kind: z.literal("announcement_published"),
    entity_type: z.literal("announcement"),
    payload: z.object({ title: z.string().min(1).max(200) }).strict(),
  }).strict(),
  inboxNotificationBaseSchema.extend({
    kind: z.literal("event_created"),
    entity_type: z.literal("event"),
    payload: z.object({
      title: z.string().min(1).max(200),
      start_at: z.string().datetime({ offset: true }),
    }).strict(),
  }).strict(),
  inboxNotificationBaseSchema.extend({
    kind: z.literal("wiki_article_created"),
    entity_type: z.literal("wiki_article"),
    payload: z.object({
      title: z.string().min(1).max(200),
      slug: z.string().min(1).max(200),
    }).strict(),
  }).strict(),
]);

export const inboxNotificationListResponseSchema = z.object({
  data: z.array(inboxNotificationSchema),
  next_cursor: z.string().max(512).nullable(),
  unread_count: z.number().int().nonnegative(),
}).strict();

export const markInboxNotificationsReadSchema = z.object({
  ids: z.array(z.string().min(1).max(200)).min(1).max(50).optional(),
  all: z.literal(true).optional(),
}).strict().refine((value) => value.all === true || value.ids !== undefined, {
  message: "Specify notification ids or all",
});

export const inboxNotificationMutationResponseSchema = z.object({
  ok: z.literal(true),
  unread_count: z.number().int().nonnegative(),
}).strict();

export const heartbeatMessageSchema = z.object({
  type: z.literal("heartbeat"),
  tab_id: z.string().min(1).max(64),
  seq: z.number().int().nonnegative(),
  sent_at: z.string().datetime(),
}).strict();

export const heartbeatAckMessageSchema = z.object({
  type: z.literal("heartbeat_ack"),
  tab_id: z.string().min(1).max(64),
  seq: z.number().int().nonnegative(),
  server_at: z.string().datetime(),
  connections: z.number().int().nonnegative(),
}).strict();

export const pushMessageSchema = z.discriminatedUnion("type", [
  entityChangedPushMessageSchema,
  memberOnlinePushMessageSchema,
  announcementPublishedPushMessageSchema,
  inboxChangedPushMessageSchema,
  heartbeatAckMessageSchema,
]);
