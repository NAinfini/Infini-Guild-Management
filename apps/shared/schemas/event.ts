import { z } from "zod";
import { EVENT_TYPES } from "../constants/event-types";

const recurrenceRuleSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]),
  interval: z.number().int().positive(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  endAfter: z.number().int().positive().optional(),
  endDate: z.string().datetime().optional(),
});
const eventAttachmentsSchema = z.array(z.string().min(1)).max(5);

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
  visible_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_by: z.string(),
  recurrence_rule: recurrenceRuleSchema.nullable(),
  attachments: eventAttachmentsSchema.default([]),
  series_id: z.string().nullable(),
  is_series_parent: z.boolean(),
  instance_date: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const createEventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  start_at: z.string().datetime(),
  end_at: z.string().datetime().optional(),
  capacity: z.number().int().positive().optional(),
  attachments: eventAttachmentsSchema.optional(),
  recurrence_rule: recurrenceRuleSchema.optional(),
});

export const updateEventSchema = createEventSchema.partial().extend({
  pinned: z.boolean().optional(),
  signup_locked: z.boolean().optional(),
  archived_at: z.string().datetime().nullable().optional(),
  recurrence_scope: z.enum(["this", "future", "all"]).optional(),
});

export const eventParticipantSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  user_id: z.string(),
  joined_at: z.string(),
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
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  start_at: z.string().datetime(),
  end_at: z.string().datetime().optional(),
  capacity: z.number().int().positive().optional(),
  recurrence_rule: recurrenceRuleSchema,
  visibility_offset_minutes: z.number().int().min(0).optional(),
});

export const updateTemplateSchema = createTemplateSchema.partial();
