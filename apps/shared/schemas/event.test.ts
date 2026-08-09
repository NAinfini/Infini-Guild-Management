import { describe, expect, it } from "vitest";
import {
  createEventSchema,
  createTemplateSchema,
  eventParticipantsBatchSchema,
  eventPollSchema,
  eventSchema,
  pollVoteSchema,
  recurrenceRuleSchema,
  recurringTemplateSchema,
  updateEventSchema,
  updateTemplateSchema,
} from "./event";

describe("recurrenceRuleSchema", () => {
  it("accepts only the fields owned by each recurrence frequency", () => {
    expect(recurrenceRuleSchema.safeParse({ frequency: "daily", interval: 1 }).success).toBe(true);
    expect(recurrenceRuleSchema.safeParse({
      frequency: "weekly",
      interval: 2,
      daysOfWeek: [1, 3, 5],
    }).success).toBe(true);
    expect(recurrenceRuleSchema.safeParse({
      frequency: "monthly",
      interval: 1,
      dayOfMonth: 31,
    }).success).toBe(true);

    expect(recurrenceRuleSchema.safeParse({
      frequency: "daily",
      interval: 1,
      daysOfWeek: [1],
    }).success).toBe(false);
    expect(recurrenceRuleSchema.safeParse({
      frequency: "weekly",
      interval: 1,
      daysOfWeek: [1],
      dayOfMonth: 1,
    }).success).toBe(false);
    expect(recurrenceRuleSchema.safeParse({
      frequency: "monthly",
      interval: 1,
      dayOfMonth: 1,
      daysOfWeek: [1],
    }).success).toBe(false);
  });

  it("requires unique weekly UTC weekdays and one exclusive end condition", () => {
    expect(recurrenceRuleSchema.safeParse({
      frequency: "weekly",
      interval: 1,
      daysOfWeek: [],
    }).success).toBe(false);
    expect(recurrenceRuleSchema.safeParse({
      frequency: "weekly",
      interval: 1,
      daysOfWeek: [1, 1],
    }).success).toBe(false);
    expect(recurrenceRuleSchema.safeParse({
      frequency: "daily",
      interval: 1,
      endAfter: 10,
      endDate: "2026-12-01T00:00:00.000Z",
    }).success).toBe(false);
    expect(recurrenceRuleSchema.safeParse({
      frequency: "daily",
      interval: 1,
      endAfter: 10,
    }).success).toBe(true);
    expect(recurrenceRuleSchema.safeParse({
      frequency: "daily",
      interval: 1,
      endDate: "2026-12-01T00:00:00.000Z",
    }).success).toBe(true);
  });
});

describe("event schemas", () => {
  it("keeps participant batches within D1's 100-parameter statement limit", () => {
    expect(eventParticipantsBatchSchema.safeParse({
      user_ids: Array.from({ length: 99 }, (_, index) => `user-${index}`),
    }).success).toBe(true);
    expect(eventParticipantsBatchSchema.safeParse({
      user_ids: Array.from({ length: 100 }, (_, index) => `user-${index}`),
    }).success).toBe(false);
  });

  it("keeps event auto-archive controls in event and template payloads", () => {
    expect(
      eventSchema.parse({
        id: "evt-1",
        type: "social",
        title: "Guild Run",
        description: null,
        start_at: "2026-05-04T19:00:00.000Z",
        end_at: null,
        capacity: null,
        pinned: false,
        signup_locked: false,
        auto_archive: true,
        auto_archived: false,
        visible_at: null,
        archived_at: null,
        created_by: "user-1",
        updated_by: null,
        attachments: [],
        series_id: null,
        instance_date: null,
        created_at: "2026-05-04T12:00:00.000Z",
        updated_at: "2026-05-04T12:00:00.000Z",
      }),
    ).toMatchObject({ auto_archive: true, auto_archived: false });

    expect(createEventSchema.parse({
      type: "social",
      title: "Guild Run",
      start_at: "2026-05-04T19:00:00.000Z",
      auto_archive: true,
    })).toMatchObject({ auto_archive: true });

    expect(updateEventSchema.parse({ auto_archive: false })).toMatchObject({ auto_archive: false });

    expect(
      recurringTemplateSchema.parse({
        id: "tpl-1",
        type: "social",
        title: "Guild Run",
        description: null,
        start_time: "20:00",
        duration_minutes: null,
        capacity: null,
        recurrence_rule: { frequency: "daily", interval: 1 },
        auto_archive: true,
        visibility_offset_minutes: 0,
        attachments: [],
        paused: false,
        created_by: "user-1",
        last_generated_date: null,
        generation_count: 0,
        created_at: "2026-05-04T12:00:00.000Z",
        updated_at: "2026-05-04T12:00:00.000Z",
      }),
    ).toMatchObject({ auto_archive: true });

    expect(createTemplateSchema.parse({
      type: "social",
      title: "Guild Run",
      start_time: "20:00",
      recurrence_rule: { frequency: "daily", interval: 1 },
      auto_archive: true,
    })).toMatchObject({ auto_archive: true });

    expect(updateTemplateSchema.parse({ auto_archive: false })).toMatchObject({ auto_archive: false });
  });

  it("accepts canonical media ids in template create and update payloads", () => {
    const attachments = ["Abcdefghijklmnopqrstu"];

    expect(createTemplateSchema.parse({
      type: "social",
      title: "Guild Run",
      start_time: "20:00",
      recurrence_rule: { frequency: "daily", interval: 1 },
      attachments,
    })).toMatchObject({ attachments });

    expect(updateTemplateSchema.parse({ attachments })).toEqual({ attachments });
  });

  it("accepts only source-owned event types while validating poll requirements", () => {
    expect(createEventSchema.safeParse({
      type: "custom_event",
      title: "Custom",
      start_at: "2026-05-07T19:00:00.000Z",
    }).success).toBe(false);

    expect(createEventSchema.safeParse({
      type: "poll",
      title: "Next activity?",
      start_at: "2026-05-07T19:00:00.000Z",
      poll: {
        options: ["Raid", "Dungeon"],
        results_visibility: "after_vote",
        show_voter_names: false,
      },
    }).success).toBe(false);

    expect(createEventSchema.parse({
      type: "poll",
      title: "Next activity?",
      start_at: "2026-05-07T19:00:00.000Z",
      end_at: "2026-05-07T21:00:00.000Z",
      poll: {
        options: ["Raid", "Dungeon"],
        results_visibility: "after_vote",
        show_voter_names: false,
      },
    })).toMatchObject({
      type: "poll",
      poll: { options: ["Raid", "Dungeon"] },
    });

    expect(createEventSchema.safeParse({
      type: "poll",
      title: "Next activity?",
      start_at: "2026-05-07T19:00:00.000Z",
      end_at: "2026-05-07T21:00:00.000Z",
      poll: { options: ["Only one"] },
    }).success).toBe(false);
  });

  it("rejects events where end_at is before start_at", () => {
    expect(createEventSchema.safeParse({
      type: "social",
      title: "Guild Run",
      start_at: "2026-05-07T21:00:00.000Z",
      end_at: "2026-05-07T19:00:00.000Z",
    }).success).toBe(false);

    expect(updateEventSchema.safeParse({
      start_at: "2026-05-07T21:00:00.000Z",
      end_at: "2026-05-07T19:00:00.000Z",
    }).success).toBe(false);
  });

  it("parses poll detail and vote payloads", () => {
    expect(eventPollSchema.parse({
      results_visibility: "always",
      show_voter_names: true,
      has_voted: true,
      can_vote: true,
      options: [
        { id: "opt-1", label: "Raid", vote_count: 2, voter_ids: ["u-1", "u-2"], voted_by_me: true },
      ],
    })).toMatchObject({ has_voted: true });

    expect(pollVoteSchema.parse({ option_ids: ["opt-1", "opt-2"] })).toEqual({ option_ids: ["opt-1", "opt-2"] });
  });
});
