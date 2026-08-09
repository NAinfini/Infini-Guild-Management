import { z } from "zod";
import { LIMITS } from "../config/limits";
import {
  WAR_MEMBER_STAT_KEYS,
  WAR_RESULTS,
  WAR_TEAM_OBJECTIVE_KEYS,
} from "../constants/guild-war";
import { eventSchema } from "./event";

const L = LIMITS.content;

const statValueSchema = z.number().nonnegative();
const warResultSchema = z.enum(WAR_RESULTS);
const writeTeamStatsObjectSchema = z.partialRecord(
  z.enum(WAR_TEAM_OBJECTIVE_KEYS),
  statValueSchema.nullable(),
) as z.ZodType<Record<string, number | null>>;
const teamStatsObjectSchema = writeTeamStatsObjectSchema.nullable();
const writeMemberStatsObjectSchema = z.partialRecord(
  z.enum(WAR_MEMBER_STAT_KEYS),
  statValueSchema.nullable(),
) as z.ZodType<Record<string, number | null>>;
const memberStatsObjectSchema = writeMemberStatsObjectSchema.nullable();

export const warHistorySchema = z.object({
  id: z.string(),
  event_id: z.string().nullable(),
  war_name: z.string().max(L.warName.max),
  enemy_name: z.string().max(L.warEnemyName.max).nullable(),
  result: warResultSchema.nullable(),
  own_stats: teamStatsObjectSchema,
  enemy_stats: teamStatsObjectSchema,
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
  result: warResultSchema.optional(),
  own_stats: writeTeamStatsObjectSchema.optional(),
  enemy_stats: writeTeamStatsObjectSchema.optional(),
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
  stats: memberStatsObjectSchema,
  note: z.string().nullable(),
});

export const saveTeamsPayloadSchema = z.object({
  event_id: z.string(),
  teams: z.array(
    z.object({
      id: z.string().optional(),
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
  stats: writeMemberStatsObjectSchema.optional(),
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
    result: warResultSchema,
    duration_minutes: z.number().positive().nullable().optional(),
    own_stats: writeTeamStatsObjectSchema.optional(),
    enemy_stats: writeTeamStatsObjectSchema.optional(),
  }),
  member_stats: z.array(
    z.object({
      user_id: z.string(),
      stats: z.partialRecord(
        z.enum(WAR_MEMBER_STAT_KEYS),
        statValueSchema,
      ) as z.ZodType<Record<string, number>>,
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
