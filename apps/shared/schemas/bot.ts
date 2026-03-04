import { z } from "zod";

export const botTaskSchema = z.object({
  task_id: z.string(),
  idempotency_key: z.string(),
  platform: z.enum(["discord", "wechat"]),
  task_type: z.enum(["event_notify", "team_comp", "reminder", "war_result"]),
  target: z.record(z.string()),
  payload: z.record(z.unknown()),
  attempt: z.number().int().min(1),
  created_at: z.string(),
});

export const discordLinkStartSchema = z.object({
  username: z.string().min(3).max(50),
});

export const discordLinkVerifySchema = z.object({
  code: z.string().length(6),
});

export const botSettingsSchema = z.object({
  discord: z.object({
    guild_id: z.string(),
    notification_channel_id: z.string(),
    team_comp_channel_id: z.string(),
    default_toggles: z.record(z.boolean()),
  }),
  wechat: z.object({
    room_ids: z.array(z.string()),
    default_toggles: z.record(z.boolean()),
  }),
});
