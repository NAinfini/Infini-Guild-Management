// Domain: Bot Delivery & Platform Integration
// Tables: bot_delivery_log, bot_discord_event_messages, bot_wechat_event_messages
// Dependencies: events
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { events } from "./events";
import { nowUtc } from "./shared";

export const botDeliveryLog = sqliteTable(
  "bot_delivery_log",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    platform: text("platform", { enum: ["discord", "wechat"] }).notNull(),
    taskType: text("task_type", { enum: ["event_notify", "team_comp", "reminder", "war_result"] }).notNull(),
    eventId: text("event_id").references(() => events.id),
    targetId: text("target_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status", { enum: ["queued", "sending", "sent", "failed"] }).notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: text("next_attempt_at"),
    createdAt: text("created_at").notNull().default(nowUtc),
    sentAt: text("sent_at"),
    messageId: text("message_id"),
  },
  (table) => ({
    idxStatusNextAttempt: index("idx_bot_delivery_status_next_attempt").on(table.status, table.nextAttemptAt),
    idxEventPlatformTaskStatus: index("idx_bot_delivery_event_platform_task").on(
      table.eventId,
      table.platform,
      table.taskType,
      table.status,
    ),
  }),
);

export const botDiscordEventMessages = sqliteTable(
  "bot_discord_event_messages",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id),
    channelId: text("channel_id").notNull(),
    messageId: text("message_id").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    uxEventChannel: uniqueIndex("ux_bot_discord_event_messages_event_channel").on(table.eventId, table.channelId),
  }),
);

export const botWechatEventMessages = sqliteTable(
  "bot_wechat_event_messages",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id),
    roomId: text("room_id").notNull(),
    messageId: text("message_id").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    uxEventRoom: uniqueIndex("ux_bot_wechat_event_messages_event_room").on(table.eventId, table.roomId),
  }),
);
