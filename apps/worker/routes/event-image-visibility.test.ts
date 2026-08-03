import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  serveR2Object: vi.fn(),
}));

vi.mock("../middleware/rbac", () => ({
  getRequestUser: mocks.getRequestUser,
  requirePermission: vi.fn(),
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

const mediaKey = "events/event-1/images/image-key.png";
const futureEvent = {
  id: "event-1",
  visibleAt: "9999-12-31T23:59:59.999Z",
  attachments: [mediaKey],
};
const mediaReferences = new Set([`${mediaKey}\u0000event\u0000${futureEvent.id}`]);

function createD1Fixture() {
  return {
    prepare: vi.fn((sql: string) => {
      expect(sql).toContain("FROM media_references ref");
      expect(sql).toContain("INNER JOIN events event");
      expect(sql).toContain("json_each");
      return {
        bind: (key: string, entityId: string, canManage: number, checkedAt: string) => ({
          first: async () => {
            expect(key).toBe(mediaKey);
            expect(entityId).toBe(futureEvent.id);
            expect([0, 1]).toContain(canManage);
            expect(Number.isNaN(Date.parse(checkedAt))).toBe(false);
            const referenced = mediaReferences.has(`${key}\u0000event\u0000${entityId}`)
              && futureEvent.attachments.includes(key);
            const visible = canManage === 1 || futureEvent.visibleAt <= checkedAt;
            return referenced && visible ? { present: 1 } : null;
          },
        }),
      };
    }),
  };
}

describe("event image visibility", () => {
  beforeEach(() => {
    mocks.getRequestUser.mockReset();
    mocks.serveR2Object.mockReset();
    mocks.serveR2Object.mockResolvedValue(new Response("image"));
  });

  it("does not serve images for future-visible events to guests", async () => {
    const { eventsRoutes } = await import("./events");
    mocks.getRequestUser.mockResolvedValueOnce(null);

    const response = await eventsRoutes.request(
      `/image?key=${mediaKey}`,
      { method: "GET" },
      { DB: createD1Fixture(), MEDIA: {} },
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

    const response = await eventsRoutes.request(
      `/image?key=${mediaKey}`,
      { method: "GET" },
      { DB: createD1Fixture(), MEDIA: {} },
    );

    expect(response.status).toBe(200);
    expect(mocks.serveR2Object).toHaveBeenCalledWith(
      expect.anything(),
      mediaKey,
      "Event image not found",
    );
  });
});
