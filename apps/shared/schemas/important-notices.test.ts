import { describe, expect, it } from "vitest";
import { createImportantNoticeSchema } from "./important-notices";

describe("important notice schemas", () => {
  it("normalizes accepted offset timestamps to canonical UTC", () => {
    expect(createImportantNoticeSchema.parse({
      title: "Scheduled notice",
      body_json: '{"type":"doc","content":[]}',
      status: "scheduled",
      publish_at: "2026-08-29T03:00:00+14:00",
      expires_at: "2026-08-29T04:00:00+14:00",
      requires_acknowledgement: false,
      audience_scope: "all",
      audience_role_ids: [],
    })).toMatchObject({
      publish_at: "2026-08-28T13:00:00.000Z",
      expires_at: "2026-08-28T14:00:00.000Z",
    });
  });
});
