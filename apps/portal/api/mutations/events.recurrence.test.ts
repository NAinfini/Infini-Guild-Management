import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock("../client", () => ({ apiRequest }));

import { createTemplate, updateTemplate } from "./events";

describe("recurring template mutations", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockResolvedValue({});
  });

  it.each([
    { frequency: "daily" as const, interval: 1, endAfter: 4 },
    { frequency: "weekly" as const, interval: 2, daysOfWeek: [1, 3], endDate: "2026-12-31T00:00:00.000Z" },
    { frequency: "monthly" as const, interval: 1, dayOfMonth: 31 },
  ])("sends the shared $frequency recurrence contract unchanged", async (recurrenceRule) => {
    await createTemplate({
      type: "social",
      title: "Guild Run",
      start_time: "10:00",
      recurrence_rule: recurrenceRule,
    });

    expect(apiRequest).toHaveBeenCalledWith("/api/events/templates", {
      method: "POST",
      bodyJson: expect.objectContaining({ recurrence_rule: recurrenceRule }),
    });
  });

  it("rejects stale frequency-specific fields and sends a clean switched rule", async () => {
    expect(() => createTemplate({
      type: "social",
      title: "Guild Run",
      start_time: "10:00",
      recurrence_rule: { frequency: "daily", interval: 1, daysOfWeek: [1] } as never,
    })).toThrow();

    const recurrenceRule = { frequency: "monthly" as const, interval: 1, dayOfMonth: 15 };
    await updateTemplate("template-1", { recurrence_rule: recurrenceRule });
    expect(apiRequest).toHaveBeenLastCalledWith("/api/events/templates/template-1", {
      method: "PATCH",
      bodyJson: { recurrence_rule: recurrenceRule },
    });
  });
});
