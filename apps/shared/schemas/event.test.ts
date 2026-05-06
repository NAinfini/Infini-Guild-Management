import { describe, expect, it } from "vitest";
import { createEventSchema, createTemplateSchema, eventSchema, recurringTemplateSchema, updateEventSchema, updateTemplateSchema } from "./event";

describe("event schemas", () => {
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
        recurrence_rule: null,
        attachments: [],
        series_id: null,
        is_series_parent: false,
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
        start_at: "2026-05-04T19:00:00.000Z",
        end_at: null,
        capacity: null,
        recurrence_rule: { frequency: "daily", interval: 1 },
        auto_archive: true,
        visibility_offset_minutes: null,
        visible_at: null,
        archived_at: null,
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
      start_at: "2026-05-04T19:00:00.000Z",
      recurrence_rule: { frequency: "daily", interval: 1 },
      auto_archive: true,
    })).toMatchObject({ auto_archive: true });

    expect(updateTemplateSchema.parse({ auto_archive: false })).toMatchObject({ auto_archive: false });
  });
});
