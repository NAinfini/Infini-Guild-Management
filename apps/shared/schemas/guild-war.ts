import { z } from "zod";
import { LIMITS, MAX_OFFSET_PAGE } from "../config/limits";
import {
  WAR_MEMBER_STAT_KEYS,
  WAR_RESULTS,
  WAR_TEAM_OBJECTIVE_KEYS,
} from "../constants/guild-war";
import { eventSchema } from "./event";
import { mediaIdSchema } from "./media";
import { siteAnalyticsSettingsSchema } from "./site-config";
import { isPortableLikeSearch } from "../utils/portable-search";

const L = LIMITS.content;
export const MAX_GUILD_WAR_MEMBERS = 100;

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
  result: warResultSchema,
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
  result: warResultSchema,
  own_stats: writeTeamStatsObjectSchema.optional(),
  enemy_stats: writeTeamStatsObjectSchema.optional(),
  duration_minutes: z.number().positive().optional(),
  notes: z.string().max(L.warNotes.max).optional(),
});

export const updateWarHistorySchema = createWarHistorySchema.partial().extend({
  event_id: z.string().nullable().optional(),
  duration_minutes: z.number().positive().nullable().optional(),
});

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

const guildWarMemberReadSchema = warTeamMemberSchema.extend({
  display_name: z.string().optional(),
  avatar_media_id: mediaIdSchema.nullable(),
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
      ).max(MAX_GUILD_WAR_MEMBERS),
    }),
  ),
  pool_members: z.array(
    z.object({
      user_id: z.string(),
    }),
  ).max(MAX_GUILD_WAR_MEMBERS),
}).superRefine((payload, ctx) => {
  const rosterMemberCount = payload.teams.reduce((count, team) => count + team.members.length, 0)
    + payload.pool_members.length;
  if (rosterMemberCount > MAX_GUILD_WAR_MEMBERS) {
    ctx.addIssue({
      code: "custom",
      path: ["teams"],
      message: `Guild war roster supports at most ${MAX_GUILD_WAR_MEMBERS} members`,
    });
  }
  const teamIds = new Set<string>();
  const userIds = new Set<string>();
  payload.teams.forEach((team, teamIndex) => {
    if (team.id) {
      if (teamIds.has(team.id)) {
        ctx.addIssue({ code: "custom", path: ["teams", teamIndex, "id"], message: "Duplicate team id" });
      }
      teamIds.add(team.id);
    }
    team.members.forEach((member, memberIndex) => {
      if (userIds.has(member.user_id)) {
        ctx.addIssue({ code: "custom", path: ["teams", teamIndex, "members", memberIndex, "user_id"], message: "Member appears more than once" });
      }
      userIds.add(member.user_id);
    });
  });
  payload.pool_members.forEach((member, memberIndex) => {
    if (userIds.has(member.user_id)) {
      ctx.addIssue({ code: "custom", path: ["pool_members", memberIndex, "user_id"], message: "Member appears more than once" });
    }
    userIds.add(member.user_id);
  });
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
  ).min(1).max(MAX_GUILD_WAR_MEMBERS),
}).superRefine((payload, ctx) => {
  const seen = new Set<string>();
  payload.moves.forEach((move, index) => {
    if (seen.has(move.user_id)) {
      ctx.addIssue({ code: "custom", path: ["moves", index, "user_id"], message: "Member can only move once" });
    }
    seen.add(move.user_id);
  });
});

export const updateGuildWarRoleTagsSchema = z.object({
  event_id: z.string(),
  updates: z.array(
    z.object({
      user_id: z.string(),
      role_tag: z.string().nullable(),
    }),
  ).min(1).max(MAX_GUILD_WAR_MEMBERS),
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
  ).max(MAX_GUILD_WAR_MEMBERS).optional(),
}).superRefine((payload, ctx) => {
  const seen = new Set<string>();
  payload.member_stats?.forEach((member, index) => {
    if (seen.has(member.user_id)) {
      ctx.addIssue({ code: "custom", path: ["member_stats", index, "user_id"], message: "Duplicate member stats" });
    }
    seen.add(member.user_id);
  });
});

const guildWarActivePoolMemberSchema = z.object({
  id: z.string(),
  warHistoryId: z.string().nullable(),
  eventId: z.string().nullable(),
  userId: z.string(),
  display_name: z.string().optional(),
  avatar_media_id: mediaIdSchema.nullable(),
});

export const guildWarActiveResponseSchema = z.object({
  war_history: warHistorySchema.nullable().optional(),
  event: eventSchema.nullable(),
  teams: z.array(
    warTeamSchema.extend({
      members: z.array(guildWarMemberReadSchema),
    }),
  ),
  pool: z.array(guildWarActivePoolMemberSchema),
  participants: z.array(z.object({ user_id: z.string() })).optional(),
  etag: z.string().nullable().optional(),
});

export const guildWarHistoryDetailResponseSchema = warHistorySchema.extend({
  etag: z.string().min(1),
  teams: z.array(warTeamSchema.extend({
    members: z.array(guildWarMemberReadSchema),
  })),
  pool: z.array(z.object({
    id: z.string(),
    warHistoryId: z.string(),
    userId: z.string(),
    display_name: z.string().optional(),
  })),
  member_stats: z.array(guildWarMemberReadSchema),
});

export const guildWarHistoryBatchResponseSchema = z.object({
  data: z.array(guildWarHistoryDetailResponseSchema),
});

export const guildWarHistoryListResponseSchema = z.object({
  data: z.array(warHistorySchema).max(LIMITS.pagination.guildWar),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive().max(LIMITS.pagination.guildWar),
  total_pages: z.number().int().nonnegative(),
});

const historyTimestampSchema = z.string().datetime().transform((value) => new Date(value).toISOString());

export const guildWarHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(MAX_OFFSET_PAGE).default(1),
  limit: z.coerce.number().int().positive().max(LIMITS.pagination.guildWar)
    .default(LIMITS.pagination.guildWar),
  date_from: historyTimestampSchema.optional(),
  date_to: historyTimestampSchema.optional(),
  search: z.string().trim().refine(isPortableLikeSearch, "History search exceeds the portable pattern limit").optional(),
}).strict().superRefine((query, context) => {
  if (query.date_from && query.date_to && query.date_from > query.date_to) {
    context.addIssue({ code: "custom", path: ["date_to"], message: "Invalid history date range" });
  }
});

export const guildWarConcludedEventIdsResponseSchema = z.object({
  data: z.array(z.string()),
});

export const guildWarOkResponseSchema = z.object({ ok: z.literal(true) });

export const guildWarRoleTagsResponseSchema = guildWarOkResponseSchema.extend({
  updated: z.number().int().nonnegative().max(MAX_GUILD_WAR_MEMBERS),
});

export const guildWarConcludeResponseSchema = z.object({
  war_history_id: z.string(),
});

export const guildWarHistoryDeleteBatchResponseSchema = guildWarOkResponseSchema.extend({
  deleted: z.number().int().nonnegative().max(50),
});

export const guildWarMemberResponseSchema = guildWarMemberReadSchema;

export const guildWarMemberStatsResponseSchema = z.object({
  data: z.array(guildWarMemberResponseSchema).max(MAX_GUILD_WAR_MEMBERS),
});

export const guildWarMemberStatsBatchSchema = z.object({
  updates: z.array(z.object({
    user_id: z.string().min(1),
    stats: updateMemberStatsSchema,
  })).max(MAX_GUILD_WAR_MEMBERS),
});

export const guildWarHistoryDeleteBatchSchema = z.object({
  ids: z.array(z.string().min(1)).max(50),
});

export const guildWarAnalyticsResponseSchema = z.object({
  wars: z.array(warHistorySchema.extend({
    team_size: z.number().int().nonnegative(),
    modifier: z.number().nonnegative(),
    modifier_breakdown: z.array(z.object({
      factor: z.string(),
      ratio: z.number(),
      weight: z.number(),
      contribution: z.number(),
    })),
  })),
  member_stats: z.array(z.object({
    user_id: z.string(),
    stats: z.record(z.string(), z.number()),
  })),
  analytics_settings: siteAnalyticsSettingsSchema,
});
