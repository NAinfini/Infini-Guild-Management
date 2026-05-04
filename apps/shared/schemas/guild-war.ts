import { z } from "zod";
import { eventSchema } from "./event";

export const warHistorySchema = z.object({
  id: z.string(),
  event_id: z.string().nullable(),
  war_name: z.string().max(200),
  enemy_name: z.string().max(200).nullable(),
  result: z.enum(["win", "loss", "draw"]).nullable(),
  own_kills: z.number().int().nullable(),
  own_towers: z.number().int().nullable(),
  own_base_hp: z.number().int().nullable(),
  own_credits: z.number().int().nullable(),
  own_distance: z.number().int().nullable(),
  enemy_kills: z.number().int().nullable(),
  enemy_towers: z.number().int().nullable(),
  enemy_base_hp: z.number().int().nullable(),
  enemy_credits: z.number().int().nullable(),
  enemy_distance: z.number().int().nullable(),
  duration_minutes: z.number().nullable(),
  notes: z.string().max(2000).nullable(),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const createWarHistorySchema = z.object({
  event_id: z.string().optional(),
  war_name: z.string().min(1).max(200),
  enemy_name: z.string().max(200).optional(),
  result: z.enum(["win", "loss", "draw"]).optional(),
  own_kills: z.number().int().optional(),
  own_towers: z.number().int().optional(),
  own_base_hp: z.number().int().optional(),
  own_credits: z.number().int().optional(),
  own_distance: z.number().int().optional(),
  enemy_kills: z.number().int().optional(),
  enemy_towers: z.number().int().optional(),
  enemy_base_hp: z.number().int().optional(),
  enemy_credits: z.number().int().optional(),
  enemy_distance: z.number().int().optional(),
  duration_minutes: z.number().positive().optional(),
  notes: z.string().max(2000).optional(),
});

export const updateWarHistorySchema = createWarHistorySchema.partial();

export const warTeamSchema = z.object({
  id: z.string(),
  war_history_id: z.string(),
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
  kills: z.number().int().nullable(),
  deaths: z.number().int().nullable(),
  assists: z.number().int().nullable(),
  damage: z.number().int().nullable(),
  healing: z.number().int().nullable(),
  building_damage: z.number().int().nullable(),
  credits: z.number().int().nullable(),
  damage_taken: z.number().int().nullable(),
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

export const updateMemberStatsSchema = warTeamMemberSchema
  .pick({
    kills: true,
    deaths: true,
    assists: true,
    damage: true,
    healing: true,
    building_damage: true,
    credits: true,
    damage_taken: true,
    note: true,
  })
  .partial();

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

const guildWarActivePoolMemberSchema = z.object({
  id: z.string(),
  warHistoryId: z.string(),
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
