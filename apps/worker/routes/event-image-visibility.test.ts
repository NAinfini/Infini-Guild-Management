import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEventById: vi.fn(),
  getRequestUser: vi.fn(),
  serveR2Object: vi.fn(),
}));

vi.mock("../middleware/rbac", () => ({
  getRequestUser: mocks.getRequestUser,
  requirePermission: vi.fn(),
}));

vi.mock("../services/EventService", () => ({
  EventService: vi.fn(function EventServiceMock(this: { getEventById: typeof mocks.getEventById }) {
    this.getEventById = mocks.getEventById;
  }),
  toEventPayload: vi.fn((value) => value),
  toParticipantPayload: vi.fn((value) => value),
  toRaffleWinnerPayload: vi.fn((value) => value),
  toTemplatePayload: vi.fn((value) => value),
}));

vi.mock("./service-factory", () => ({
  commonDeps: vi.fn(() => ({
    writeAuditLog: vi.fn(),
    publishEntityChanged: vi.fn(),
  })),
  getMediaPolicy: vi.fn(),
}));

vi.mock("./_shared", async () => {
  const actual = await vi.importActual<typeof import("./_shared")>("./_shared");
  return {
    ...actual,
    getDb: vi.fn(() => ({})),
    serveR2Object: mocks.serveR2Object,
  };
});

const futureEvent = {
  id: "event-1",
  visibleAt: "9999-12-31T23:59:59.999Z",
};

describe("event image visibility", () => {
  beforeEach(() => {
    mocks.getEventById.mockReset();
    mocks.getRequestUser.mockReset();
    mocks.serveR2Object.mockReset();
    mocks.serveR2Object.mockResolvedValue(new Response("image"));
  });

  it("does not serve images for future-visible events to guests", async () => {
    const { eventsRoutes } = await import("./events");
    mocks.getRequestUser.mockResolvedValueOnce(null);
    mocks.getEventById.mockResolvedValueOnce(futureEvent);

    const response = await eventsRoutes.request(
      "/image?key=events/event-1/images/image-key",
      { method: "GET" },
      { DB: {}, MEDIA: {} },
    );

    expect(response.status).toBe(404);
    expect(mocks.serveR2Object).not.toHaveBeenCalled();
  });

  it("allows event managers to preview future-visible images", async () => {
    const { eventsRoutes } = await import("./events");
    mocks.getRequestUser.mockResolvedValueOnce({
      id: "mod-1",
      role: "moderator",
      permissions: new Set(["events.edit"]),
    });
    mocks.getEventById.mockResolvedValueOnce(futureEvent);

    const response = await eventsRoutes.request(
      "/image?key=events/event-1/images/image-key",
      { method: "GET" },
      { DB: {}, MEDIA: {} },
    );

    expect(response.status).toBe(200);
    expect(mocks.serveR2Object).toHaveBeenCalledWith(
      expect.anything(),
      "events/event-1/images/image-key",
      "Event image not found",
    );
  });
});
