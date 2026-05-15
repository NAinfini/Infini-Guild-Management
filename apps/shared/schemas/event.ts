import { z } from "zod";
import { LIMITS } from "../config/limits";
import { EVENT_TYPES } from "../constants/event-types";

const L = LIMITS.content;

const recurrenceRuleSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]),
  interval: z.number().int().positive(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  endAfter: z.number().int().positive().optional(),
  endDate: z.string().datetime().optional(),
});
const eventAttachmentsSchema = z.array(z.string().min(1)).max(L.eventAttachments.max);
export const pollResultsVisibilitySchema = z.enum(["always", "after_vote", "after_close"]);

export const eventPollOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  vote_count: z.number().int().nonnegative(),
  voter_ids: z.array(z.string()),
  voted_by_me: z.boolean(),
});

export const eventPollSchema = z.object({
  results_visibility: pollResultsVisibilitySchema,
  show_voter_names: z.boolean(),
  has_voted: z.boolean(),
  can_vote: z.boolean(),
  options: z.array(eventPollOptionSchema),
});

const pollSettingsSchema = z.object({
  options: z.array(z.string().trim().min(1)).min(2).max(10),
  results_visibility: pollResultsVisibilitySchema.default("after_vote"),
  show_voter_names: z.boolean().default(false),
});

export const pollVoteSchema = z.object({
  option_ids: z.array(z.string().min(1)).min(1).max(10),
});

export const eventRaffleWinnerSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  user_id: z.string(),
  drawn_at: z.string(),
});

export const eventSchema = z.object({
  id: z.string(),
  type: z.enum(EVENT_TYPES),
  title: z.string(),
  description: z.string().nullable(),
  start_at: z.string(),
  end_at: z.string().nullable(),
  capacity: z.number().int().nullable(),
  pinned: z.boolean(),
  signup_locked: z.boolean(),
  auto_archive: z.boolean(),
  auto_archived: z.boolean(),
  visible_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_by: z.string(),
  updated_by: z.string().nullable(),
  recurrence_rule: recurrenceRuleSchema.nullable(),
  attachments: eventAttachmentsSchema.default([]),
  series_id: z.string().nullable(),
  is_series_parent: z.boolean(),
  instance_date: z.string().nullable(),
  poll: eventPollSchema.nullable().optional(),
  winner_count: z.number().int().nullable().optional(),
  raffle_winners: z.array(eventRaffleWinnerSchema).optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

const eventMutationSchema = z.object({
  type: z.enum(EVENT_TYPES),
  title: z.string().min(L.eventTitle.min).max(L.eventTitle.max),
  description: z.string().max(L.eventDescription.max).optional(),
  start_at: z.string().datetime(),
  end_at: z.string().datetime().optional(),
  capacity: z.number().int().positive().optional(),
  attachments: eventAttachmentsSchema.optional(),
  recurrence_rule: recurrenceRuleSchema.optional(),
  auto_archive: z.boolean().optional(),
  poll: pollSettingsSchema.optional(),
  winner_count: z.number().int().positive().optional(),
});

export const createEventSchema = eventMutationSchema.superRefine((value, ctx) => {
  if (value.type === "poll") {
    if (!value.end_at) {
      ctx.addIssue({ code: "custom", path: ["end_at"], message: "Poll events require end_at" });
    }
    if (!value.poll) {
      ctx.addIssue({ code: "custom", path: ["poll"], message: "Poll events require poll settings" });
    }
    if (value.capacity !== undefined) {
      ctx.addIssue({ code: "custom", path: ["capacity"], message: "Poll events do not use capacity" });
    }
    if (value.recurrence_rule !== undefined) {
      ctx.addIssue({ code: "custom", path: ["recurrence_rule"], message: "Poll events cannot recur" });
    }
  } else if (value.poll !== undefined) {
    ctx.addIssue({ code: "custom", path: ["poll"], message: "Only poll events can include poll settings" });
  }
  if (value.type === "raffle") {
    if (!value.end_at) {
      ctx.addIssue({ code: "custom", path: ["end_at"], message: "Raffle events require end_at" });
    }
    if (!value.winner_count) {
      ctx.addIssue({ code: "custom", path: ["winner_count"], message: "Raffle events require winner_count" });
    }
    if (value.recurrence_rule !== undefined) {
      ctx.addIssue({ code: "custom", path: ["recurrence_rule"], message: "Raffle events cannot recur" });
    }
  } else if (value.winner_count !== undefined) {
    ctx.addIssue({ code: "custom", path: ["winner_count"], message: "Only raffle events can include winner_count" });
  }
});

export const updateEventSchema = eventMutationSchema.partial().extend({
  pinned: z.boolean().optional(),
  signup_locked: z.boolean().optional(),
  archived_at: z.string().datetime().nullable().optional(),
  recurrence_scope: z.enum(["this", "future", "all"]).optional(),
}).superRefine((value, ctx) => {
  if (value.type === "poll") {
    if (value.end_at === undefined) {
      ctx.addIssue({ code: "custom", path: ["end_at"], message: "Poll events require end_at" });
    }
    if (!value.poll) {
      ctx.addIssue({ code: "custom", path: ["poll"], message: "Poll events require poll settings" });
    }
    if (value.capacity !== undefined) {
      ctx.addIssue({ code: "custom", path: ["capacity"], message: "Poll events do not use capacity" });
    }
    if (value.recurrence_rule !== undefined) {
      ctx.addIssue({ code: "custom", path: ["recurrence_rule"], message: "Poll events cannot recur" });
    }
  } else if (value.type !== undefined && value.poll !== undefined) {
    ctx.addIssue({ code: "custom", path: ["poll"], message: "Only poll events can include poll settings" });
  }
  if (value.type === "raffle") {
    if (value.end_at === undefined) {
      ctx.addIssue({ code: "custom", path: ["end_at"], message: "Raffle events require end_at" });
    }
    if (value.recurrence_rule !== undefined) {
      ctx.addIssue({ code: "custom", path: ["recurrence_rule"], message: "Raffle events cannot recur" });
    }
  } else if (value.type !== undefined && value.winner_count !== undefined) {
    ctx.addIssue({ code: "custom", path: ["winner_count"], message: "Only raffle events can include winner_count" });
  }
});

export const eventParticipantSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  user_id: z.string(),
  joined_at: z.string(),
});

export const eventParticipantsBatchSchema = z.object({
  user_ids: z.array(z.string().min(1)).min(1).max(L.eventParticipantsBatch.max),
});

// ── Recurring Templates ──

export const recurringTemplateSchema = z.object({
  id: z.string(),
  type: z.enum(EVENT_TYPES),
  title: z.string(),
  description: z.string().nullable(),
  start_at: z.string(),
  end_at: z.string().nullable(),
  capacity: z.number().int().nullable(),
  recurrence_rule: recurrenceRuleSchema,
  auto_archive: z.boolean(),
  visibility_offset_minutes: z.number().nullable(),
  visible_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_by: z.string(),
  last_generated_date: z.string().nullable(),
  generation_count: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const createTemplateSchema = z.object({
  type: z.enum(EVENT_TYPES),
  title: z.string().min(L.eventTitle.min).max(L.eventTitle.max),
  description: z.string().max(L.eventDescription.max).optional(),
  start_at: z.string().datetime(),
  end_at: z.string().datetime().optional(),
  capacity: z.number().int().positive().optional(),
  recurrence_rule: recurrenceRuleSchema,
  visibility_offset_minutes: z.number().int().min(0).optional(),
  auto_archive: z.boolean().optional(),
});

export const updateTemplateSchema = createTemplateSchema.partial();
