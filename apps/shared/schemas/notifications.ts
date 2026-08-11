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
  heartbeatAckMessageSchema,
]);
