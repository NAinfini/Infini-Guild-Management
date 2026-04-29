import { botSettingsSchema } from "@guild/shared";
import { and, eq, gte, isNull, lte, or, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { eventParticipants, events, memberProfiles } from "../db/schema";
import type { Bindings } from "../index";
import { createBotTask, retryDueBotTasks } from "../services/bot-dispatch";
import { publishEventReminder } from "../services/push";

const BOT_SETTINGS_KEY = "config/bot-settings.json";
const REMINDER_WINDOW_MINUTES = 15;

type BotSettings = {
  discord: {
    guild_id: string;
    notification_channel_id: string;
    team_comp_channel_id: string;
    default_toggles: Record<string, boolean>;
  };
  wechat: {
    room_ids: string[];
    default_toggles: Record<string, boolean>;
  };
};

function defaultBotSettings(): BotSettings {
  return {
    discord: {
      guild_id: "",
      notification_channel_id: "",
      team_comp_channel_id: "",
      default_toggles: {},
    },
    wechat: {
      room_ids: [],
      default_toggles: {},
    },
  };
}

async function readBotSettings(env: Bindings): Promise<BotSettings> {
  const object = await env.MEDIA.get(BOT_SETTINGS_KEY);
  if (!object) {
    return defaultBotSettings();
  }

  try {
    const parsed = JSON.parse(await object.text()) as unknown;
    return botSettingsSchema.parse(parsed);
  } catch {
    return defaultBotSettings();
  }
}

export async function runBotReminderCron(env: Bindings): Promise<void> {
  const db = drizzle(env.DB);
  const settings = await readBotSettings(env);
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoff = new Date(now);
  cutoff.setUTCMinutes(cutoff.getUTCMinutes() + REMINDER_WINDOW_MINUTES);
  const cutoffIso = cutoff.toISOString();

  const upcomingEvents = await db
    .select({
      id: events.id,
      title: events.title,
      startAt: events.startAt,
      description: events.description,
    })
    .from(events)
    .where(
      and(
        isNull(events.archivedAt),
        gte(events.startAt, nowIso),
        lte(events.startAt, cutoffIso),
      ),
    );

  for (const eventRow of upcomingEvents) {
    const dispatchedPlatforms = new Set<"discord" | "wechat">();
    const recipients = await db
      .select({
        userId: eventParticipants.userId,
        discordId: memberProfiles.discordId,
        wechatName: memberProfiles.wechatName,
        discordReminderOptOut: memberProfiles.discordReminderOptOut,
      })
      .from(eventParticipants)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, eventParticipants.userId))
      .where(
        and(
          eq(eventParticipants.eventId, eventRow.id),
          or(
            isNull(memberProfiles.vacationStart),
            gt(memberProfiles.vacationStart, nowIso),
            lte(memberProfiles.vacationEnd, nowIso),
          ),
        ),
      );

    for (const recipient of recipients) {
      if (!recipient.discordId || recipient.discordReminderOptOut) {
        continue;
      }

      await createBotTask(env, {
        platform: "discord",
        taskType: "reminder",
        eventId: eventRow.id,
        targetId: recipient.discordId,
        idempotencyKey: `reminder:${eventRow.id}:${recipient.userId}:${eventRow.startAt}`,
        payload: {
          event_id: eventRow.id,
          title: eventRow.title,
          description: eventRow.description,
          start_at: eventRow.startAt,
          user_id: recipient.userId,
        },
        dispatchNow: true,
      });
      dispatchedPlatforms.add("discord");
    }

    const mentionNames = recipients
      .map((recipient) => recipient.wechatName?.trim())
      .filter((name): name is string => Boolean(name));

    const wechatRooms = Array.from(
      new Set(
        settings.wechat.room_ids
          .map((roomId) => roomId.trim())
          .filter((roomId): roomId is string => roomId.length > 0),
      ),
    );

    for (const roomId of wechatRooms) {
      await createBotTask(env, {
        platform: "wechat",
        taskType: "reminder",
        eventId: eventRow.id,
        targetId: roomId,
        idempotencyKey: `reminder:wechat:${eventRow.id}:${roomId}:${eventRow.startAt}`,
        payload: {
          event_id: eventRow.id,
          title: eventRow.title,
          description: eventRow.description,
          start_at: eventRow.startAt,
          mention_names: mentionNames,
        },
        dispatchNow: true,
      });
      dispatchedPlatforms.add("wechat");
    }

    if (dispatchedPlatforms.size > 0) {
      await publishEventReminder(env, {
        eventId: eventRow.id,
        title: eventRow.title,
        startsAt: eventRow.startAt,
        platforms: Array.from(dispatchedPlatforms),
      });
    }
  }

  await retryDueBotTasks(env, { limit: 100 });
}
