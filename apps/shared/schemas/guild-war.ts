import { z } from "zod";
import { LIMITS } from "../config/limits";
import { eventSchema } from "./event";
import { activeGame } from "../games";

const L = LIMITS.content;

const statValueSchema = z.number();
const writeStatsObjectSchema = z.record(z.string(), statValueSchema.nullable());
const statsObjectSchema = writeStatsObjectSchema.nullable();

const WAR_RESULTS = activeGame.war.resultOptions as unknown as [string, ...string[]];

export const warHistorySchema = z.object({
  id: z.string(),
  event_id: z.string().nullable(),
  war_name: z.string().max(L.warName.max),
  enemy_name: z.string().max(L.warEnemyName.max).nullable(),
  result: z.enum(WAR_RESULTS).nullable(),
  own_stats: statsObjectSchema,
  enemy_stats: statsObjectSchema,
  duration_minutes: z.number().nullable(),
  notes: z.string().max(L.warNotes.max).nullable(),
  created_by: z.string(),
  updated_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const createWarHistorySchema = z.object({
  event_id: z.string().optional(),
  war_name: z.string().min(L.warName.min).max(L.warName.max),
  enemy_name: z.string().max(L.warEnemyName.max).optional(),
  result: z.enum(WAR_RESULTS).optional(),
  own_stats: writeStatsObjectSchema.optional(),
  enemy_stats: writeStatsObjectSchema.optional(),
  duration_minutes: z.number().positive().optional(),
  notes: z.string().max(L.warNotes.max).optional(),
});

export const updateWarHistorySchema = createWarHistorySchema.partial();

export const warTeamSchema = z.object({
  id: z.string(),
  war_history_id: z.string().nullable(),
  event_id: z.string().nullable(),
  team_name: z.string(),
  sort_order: z.number().int(),
  notes: z.string().nullable(),
  is_locked: z.boolean(),
});

export const warTeamMemberSchema = z.object({
  id: z.string(),
  war_team_id: z.string(),
  user_id: z.string(),
  role_tag: z.string().nullable(),
  sort_order: z.number().int(),
  stats: statsObjectSchema,
  note: z.string().nullable(),
});

export const saveTeamsPayloadSchema = z.object({
  event_id: z.string(),
  teams: z.array(
    z.object({
      team_name: z.string(),
      sort_order: z.number().int(),
      notes: z.string().optional(),
      is_locked: z.boolean().optional(),
      members: z.array(
        z.object({
          user_id: z.string(),
          role_tag: z.string().optional(),
          sort_order: z.number().int(),
        }),
      ),
    }),
  ),
  pool_members: z.array(
    z.object({
      user_id: z.string(),
    }),
  ),
});

export const updateMemberStatsSchema = z.object({
  stats: writeStatsObjectSchema.optional(),
  note: z.string().nullable().optional(),
});

export const moveGuildWarMemberSchema = z.object({
  event_id: z.string(),
  moves: z.array(
    z.object({
      user_id: z.string(),
      to: z.string(),
    }),
  ).min(1).max(100),
});

export const updateGuildWarRoleTagsSchema = z.object({
  event_id: z.string(),
  updates: z.array(
    z.object({
      user_id: z.string(),
      role_tag: z.string().nullable(),
    }),
  ).min(1).max(100),
});

export const concludeWarPayloadSchema = z.object({
  event_id: z.string(),
  war_info: z.object({
    enemy_name: z.string().max(L.warEnemyName.max).optional(),
    result: z.enum(WAR_RESULTS),
    duration_minutes: z.number().positive().nullable().optional(),
    own_stats: writeStatsObjectSchema.optional(),
    enemy_stats: writeStatsObjectSchema.optional(),
  }),
  member_stats: z.array(
    z.object({
      user_id: z.string(),
      stats: z.record(z.string(), statValueSchema),
    }),
  ).optional(),
});

const guildWarActivePoolMemberSchema = z.object({
  id: z.string(),
  warHistoryId: z.string().nullable(),
  eventId: z.string().nullable(),
  userId: z.string(),
});

export const guildWarActiveResponseSchema = z.object({
  war_history: warHistorySchema.nullable().optional(),
  event: eventSchema.nullable(),
  teams: z.array(
    warTeamSchema.extend({
      members: z.array(warTeamMemberSchema),
    }),
  ),
  pool: z.array(guildWarActivePoolMemberSchema),
  participants: z.array(z.object({ user_id: z.string() })).optional(),
  etag: z.string().nullable().optional(),
});
