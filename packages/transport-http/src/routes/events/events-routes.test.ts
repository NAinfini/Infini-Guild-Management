import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import type { EventsService } from "@guild/server/modules/events";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../../core/error-handler.js";
import type { HttpEnv } from "../../core/http-env.js";
import { createEventsRoutes } from "./events-routes.js";

const NOW = "2026-08-09T12:00:00.000Z";
const REVISION = "2026-08-09T12:00:00.001Z";
const MEDIA_ID = "abcdefghijklmnopqrstu";

const event = {
  event: {
    id: "event-1",
    type: "social" as const,
    title: "Saved",
    description: null,
    startAt: "2026-08-10T12:00:00.000Z",
    endAt: null,
    capacity: null,
    pinned: false,
    signupLocked: false,
    autoArchive: false,
    autoArchived: false,
    visibleAt: null,
    archivedAt: null,
    createdBy: "admin-1",
    updatedBy: "admin-1",
    seriesId: null,
    instanceDate: null,
    winnerCount: null,
    createdAt: NOW,
    updatedAt: REVISION,
  },
  attachments: [],
  classQuotas: [],
  poll: null,
  raffleWinners: [],
  participants: [],
};

const template = {
  template: {
    id: "template-1",
    type: "social" as const,
    title: "Saved template",
    description: null,
    startTime: "12:00",
    durationMinutes: null,
    capacity: null,
    recurrenceRule: { frequency: "daily" as const, interval: 1 },
    visibilityOffsetMinutes: 0,
    autoArchive: false,
    paused: false,
    createdBy: "admin-1",
    lastGeneratedDate: null,
    generationCount: 0,
    createdAt: NOW,
    updatedAt: REVISION,
  },
  attachments: [],
  classQuotas: [],
};

function buildApp(permissions = ["events.edit", "events.templates"]) {
  const list = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
  const update = vi.fn().mockResolvedValue(event);
  const createTemplate = vi.fn().mockResolvedValue(template);
  const updateTemplate = vi.fn().mockResolvedValue(template);
  const uploadImages = vi.fn().mockResolvedValue({ mediaIds: [MEDIA_ID], updatedAt: REVISION });
  const stageEventImages = vi.fn().mockResolvedValue([MEDIA_ID]);
  const app = new Hono<HttpEnv>();
  app.onError(createHttpErrorHandler());
  app.use("*", async (context, next) => {
    context.set("requestContext", createRequestContext({
      requestId: "request-1",
      authorization: createAuthorizationContext({
        userId: "admin-1",
        sessionId: "session-1",
        roleId: "admin",
        roleLevel: 1,
        permissions,
      }),
      now: NOW,
    }));
    await next();
  });
  app.route("/api/events", createEventsRoutes({
    service: { list, update, createTemplate, updateTemplate, uploadImages } as unknown as EventsService,
    stageEventImages,
  }));
  return { app, list, update, createTemplate, updateTemplate, uploadImages, stageEventImages };
}

describe("events HTTP edit revisions", () => {
  it("rejects pathological offset pages before querying storage", async () => {
    const { app, list } = buildApp();

    expect((await app.request("/api/events?page=10001")).status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });

  it("requires and forwards the event and template revisions", async () => {
    const { app, update, updateTemplate, stageEventImages } = buildApp();

    const missing = await app.request("/api/events/event-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Missing revision" }),
    });
    expect(missing.status).toBe(400);
    expect(update).not.toHaveBeenCalled();

    const eventResponse = await app.request("/api/events/event-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Saved", expected_updated_at: REVISION }),
    });
    expect(eventResponse.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.anything(), "event-1", {
      title: "Saved",
      expected_updated_at: REVISION,
    });

    const multipart = new FormData();
    multipart.append("data", JSON.stringify({
      title: "Saved with image",
      attachments: ["existingabcdefghijklm"],
      expected_updated_at: REVISION,
    }));
    multipart.append("full", new File(["full"], "full.webp", { type: "image/webp" }));
    multipart.append("view", new File(["view"], "view.webp", { type: "image/webp" }));
    const multipartResponse = await app.request("/api/events/event-1", { method: "PATCH", body: multipart });
    expect(multipartResponse.status).toBe(200);
    expect(stageEventImages).toHaveBeenCalledOnce();
    expect(update).toHaveBeenLastCalledWith(expect.anything(), "event-1", {
      title: "Saved with image",
      attachments: ["existingabcdefghijklm", MEDIA_ID],
      expected_updated_at: REVISION,
    });

    const templateResponse = await app.request("/api/events/templates/template-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Saved template", expected_updated_at: REVISION }),
    });
    expect(templateResponse.status).toBe(200);
    expect(updateTemplate).toHaveBeenCalledWith(expect.anything(), "template-1", {
      title: "Saved template",
      expected_updated_at: REVISION,
    });
  });

  it("uses the same revision for an image attachment write and returns its next revision", async () => {
    const { app, uploadImages } = buildApp();
    const form = new FormData();
    form.append("expected_updated_at", REVISION);
    form.append("full", new File(["full"], "full.webp", { type: "image/webp" }));
    form.append("view", new File(["view"], "view.webp", { type: "image/webp" }));

    const response = await app.request("/api/events/event-1/images", { method: "POST", body: form });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ media_ids: [MEDIA_ID], updated_at: REVISION });
    expect(uploadImages).toHaveBeenCalledWith(expect.anything(), "event-1", [MEDIA_ID], REVISION);
  });

  it("merges uploaded images into multipart template creates and updates", async () => {
    const { app, createTemplate, updateTemplate, stageEventImages } = buildApp();
    const createForm = new FormData();
    createForm.append("data", JSON.stringify({
      type: "social",
      title: "Template with image",
      start_time: "12:00",
      recurrence_rule: { frequency: "daily", interval: 1 },
      attachments: ["existingabcdefghijklm"],
    }));
    createForm.append("full", new File(["full"], "full.webp", { type: "image/webp" }));
    createForm.append("view", new File(["view"], "view.webp", { type: "image/webp" }));

    const createResponse = await app.request("/api/events/templates", { method: "POST", body: createForm });

    expect(createResponse.status).toBe(201);
    expect(createTemplate).toHaveBeenCalledWith(expect.anything(), {
      type: "social",
      title: "Template with image",
      start_time: "12:00",
      recurrence_rule: { frequency: "daily", interval: 1 },
      attachments: ["existingabcdefghijklm", MEDIA_ID],
    });

    const updateForm = new FormData();
    updateForm.append("data", JSON.stringify({
      title: "Updated template with image",
      attachments: ["existingabcdefghijklm"],
      expected_updated_at: REVISION,
    }));
    updateForm.append("full", new File(["full"], "full.webp", { type: "image/webp" }));
    updateForm.append("view", new File(["view"], "view.webp", { type: "image/webp" }));

    const updateResponse = await app.request("/api/events/templates/template-1", { method: "PATCH", body: updateForm });

    expect(updateResponse.status).toBe(200);
    expect(stageEventImages).toHaveBeenCalledTimes(2);
    expect(updateTemplate).toHaveBeenCalledWith(expect.anything(), "template-1", {
      title: "Updated template with image",
      attachments: ["existingabcdefghijklm", MEDIA_ID],
      expected_updated_at: REVISION,
    });
  });

  it.each([
    ["POST", "/api/events/templates"],
    ["PATCH", "/api/events/templates/template-1"],
  ])("requires template permission before reading a %s image upload", async (method, path) => {
    const { app, createTemplate, updateTemplate, stageEventImages } = buildApp(["events.edit"]);
    const response = await app.request(path, {
      method,
      headers: { "Content-Type": "multipart/form-data; boundary=missing" },
      body: "invalid multipart body",
    });

    expect(response.status).toBe(403);
    expect(stageEventImages).not.toHaveBeenCalled();
    expect(createTemplate).not.toHaveBeenCalled();
    expect(updateTemplate).not.toHaveBeenCalled();
  });
});
