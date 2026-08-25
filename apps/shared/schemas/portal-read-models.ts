import { z } from "zod";
import { LIMITS } from "../config/limits";
import { eventSchema } from "./event";
import { warHistorySchema } from "./guild-war";

export const dashboardParticipantSchema = z.object({
  user_id: z.string(),
  display_name: z.string(),
  role: z.string(),
  classes: z.array(z.string()),
  power: z.number().nonnegative(),
  avatar_media_id: z.string().nullable(),
}).strict();

export const dashboardQuotaSlotSchema = z.object({
  tag_id: z.string(),
  required: z.number().int().positive(),
  matched: z.number().int().nonnegative(),
  dedicated: z.number().int().nonnegative(),
  eligible: z.number().int().nonnegative(),
  floor: z.number().int().nonnegative(),
  ceiling: z.number().int().nonnegative(),
  status: z.enum(["filled", "flex", "short"]),
}).strict();

export const dashboardQuotaSummarySchema = z.object({
  slots: z.array(dashboardQuotaSlotSchema).max(LIMITS.content.eventClassQuotas.max),
  benched_count: z.number().int().nonnegative(),
  unassigned_count: z.number().int().nonnegative(),
  flexible: z.number().int().nonnegative(),
  required_total: z.number().int().nonnegative(),
  matched_total: z.number().int().nonnegative(),
  shortfall: z.number().int().nonnegative(),
}).strict();

export const dashboardEventSchema = eventSchema.extend({
  participant_count: z.number().int().nonnegative(),
  participant_preview: z.array(dashboardParticipantSchema).max(5),
  quota_summary: dashboardQuotaSummarySchema.nullable(),
});

export const dashboardMemberStatsResponseSchema = z.object({
  active_member_count: z.number().int().nonnegative(),
  total_member_count: z.number().int().nonnegative(),
}).strict();

export const dashboardEventsResponseSchema = z.object({
  active_events_count: z.number().int().nonnegative(),
  featured_events: z.array(dashboardEventSchema),
  upcoming_events: z.array(dashboardEventSchema),
  my_signup_event_ids: z.array(z.string()),
}).strict();

export const dashboardWarMvpSchema = z.object({
  category: z.string(),
  label: z.string(),
  name: z.string(),
  initials: z.string(),
  value: z.number(),
}).strict();

export const dashboardWarsResponseSchema = z.object({
  all_war_win_rate: z.number().min(0).max(100),
  recent_wars: z.array(warHistorySchema),
  recent_war_mvps: z.array(z.array(dashboardWarMvpSchema).nullable()),
}).strict();

export const externalDashboardWarSchema = z.object({
  id: warHistorySchema.shape.id,
  event_id: warHistorySchema.shape.event_id,
  war_name: warHistorySchema.shape.war_name,
  enemy_name: warHistorySchema.shape.enemy_name,
  result: warHistorySchema.shape.result,
  own_stats: warHistorySchema.shape.own_stats,
  enemy_stats: warHistorySchema.shape.enemy_stats,
  duration_minutes: warHistorySchema.shape.duration_minutes,
  created_at: warHistorySchema.shape.created_at,
  updated_at: warHistorySchema.shape.updated_at,
}).strict();

export const dashboardWarsExternalResponseSchema = z.object({
  all_war_win_rate: z.number().min(0).max(100),
  recent_wars: z.array(externalDashboardWarSchema),
}).strict();

export const searchResultTypeSchema = z.enum([
  "user",
  "event",
  "announcement",
  "wiki",
  "gallery",
  "war",
]);

export const searchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  type: searchResultTypeSchema,
  to: z.string(),
  entity_id: z.string().optional(),
  role: z.string().optional(),
  role_name: z.string().optional(),
  role_color: z.string().nullable().optional(),
  role_level: z.number().int().optional(),
}).strict();

export const searchResponseSchema = z.object({
  data: z.array(searchResultSchema).max(50),
}).strict();

const runtimeHealthValueSchema = z.string().trim().min(1).max(80);

export const adminStatusSchema = z.object({
  db: runtimeHealthValueSchema,
  r2: runtimeHealthValueSchema,
  ws: runtimeHealthValueSchema,
  crons: runtimeHealthValueSchema,
}).strict();

export type DashboardMemberStatsResponse = z.infer<typeof dashboardMemberStatsResponseSchema>;
export type DashboardEventsResponse = z.infer<typeof dashboardEventsResponseSchema>;
export type DashboardWarsResponse = z.infer<typeof dashboardWarsResponseSchema>;
export type DashboardWarsExternalResponse = z.infer<typeof dashboardWarsExternalResponseSchema>;
export type ExternalDashboardWar = z.infer<typeof externalDashboardWarSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type AdminStatus = z.infer<typeof adminStatusSchema>;
