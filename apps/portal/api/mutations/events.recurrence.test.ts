// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  convertImagesForUpload: vi.fn(),
  appendImageUploadVariants: vi.fn(),
}));

vi.mock("../client", () => ({ apiRequest: mocks.apiRequest }));

vi.mock("../../utils/upload-media", () => ({
  convertImagesForUpload: mocks.convertImagesForUpload,
  appendImageUploadVariants: mocks.appendImageUploadVariants,
}));

import { createTemplate, updateEvent, updateTemplate } from "./events";

describe("recurring template mutations", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.convertImagesForUpload.mockReset();
    mocks.appendImageUploadVariants.mockReset();
    mocks.apiRequest.mockResolvedValue({});
    mocks.convertImagesForUpload.mockResolvedValue([]);
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

    expect(mocks.apiRequest).toHaveBeenCalledWith("/api/events/templates", {
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
    await updateTemplate("template-1", {
      recurrence_rule: recurrenceRule,
      expected_updated_at: "2026-08-09T12:00:00.000Z",
    });
    expect(mocks.apiRequest).toHaveBeenLastCalledWith("/api/events/templates/template-1", {
      method: "PATCH",
      bodyJson: {
        recurrence_rule: recurrenceRule,
        expected_updated_at: "2026-08-09T12:00:00.000Z",
      },
    });
  });

  it("sends the event revision with every JSON edit", async () => {
    await updateEvent("event-1", {
      title: "Guild Run",
      expected_updated_at: "2026-08-09T12:00:00.000Z",
    });

    expect(mocks.apiRequest).toHaveBeenLastCalledWith("/api/events/event-1", {
      method: "PATCH",
      bodyJson: {
        title: "Guild Run",
        expected_updated_at: "2026-08-09T12:00:00.000Z",
      },
    });
  });

  it("sends template creates and updates with images as multipart data", async () => {
    const source = new File(["source"], "template.png", { type: "image/png" });
    const variants = [{
      full: new File(["full"], "template.full.webp", { type: "image/webp" }),
      view: new File(["view"], "template.view.webp", { type: "image/webp" }),
      fullWidth: 2400,
      fullHeight: 1600,
      viewWidth: 1620,
      viewHeight: 1080,
    }];
    mocks.convertImagesForUpload.mockResolvedValue(variants);

    const createPayload = {
      type: "social" as const,
      title: "Guild Run",
      start_time: "10:00",
      recurrence_rule: { frequency: "daily" as const, interval: 1 },
      attachments: ["existingabcdefghijklm"],
    };
    await createTemplate(createPayload, [source]);

    expect(mocks.convertImagesForUpload).toHaveBeenCalledWith([source]);
    expect(mocks.appendImageUploadVariants).toHaveBeenCalledWith(expect.any(FormData), variants);
    const createForm = mocks.apiRequest.mock.calls[0]?.[1]?.body as FormData;
    expect(JSON.parse(createForm.get("data") as string)).toEqual(createPayload);
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(1, "/api/events/templates", {
      method: "POST",
      body: expect.any(FormData),
    });

    const updatePayload = {
      title: "Updated guild run",
      attachments: ["existingabcdefghijklm"],
      expected_updated_at: "2026-08-09T12:00:00.000Z",
    };
    await updateTemplate("template-1", updatePayload, [source]);

    expect(mocks.convertImagesForUpload).toHaveBeenLastCalledWith([source]);
    expect(mocks.appendImageUploadVariants).toHaveBeenLastCalledWith(expect.any(FormData), variants);
    const updateForm = mocks.apiRequest.mock.calls[1]?.[1]?.body as FormData;
    expect(JSON.parse(updateForm.get("data") as string)).toEqual(updatePayload);
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(2, "/api/events/templates/template-1", {
      method: "PATCH",
      body: expect.any(FormData),
    });
  });
});
