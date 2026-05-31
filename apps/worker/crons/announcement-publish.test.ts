import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  drizzle: vi.fn(),
  publishEntityChanged: vi.fn(),
  publishAnnouncementPublished: vi.fn(),
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: mocks.drizzle,
}));

vi.mock("../services/push", () => ({
  publishEntityChanged: mocks.publishEntityChanged,
  publishAnnouncementPublished: mocks.publishAnnouncementPublished,
}));

const { runAnnouncementPublishCron } = await import("./announcement-publish");

function createDb(options: {
  dueScheduled?: Array<{ id: string; title: string; publishAt: string | null }>;
  dueExpired?: Array<{ id: string }>;
}) {
  const selectWhere = vi
    .fn()
    .mockResolvedValueOnce(options.dueScheduled ?? [])
    .mockResolvedValueOnce(options.dueExpired ?? []);
  const select = vi.fn(() => ({
    from: vi.fn(() => ({ where: selectWhere })),
  }));
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn((_: Record<string, unknown>) => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));
  return { db: { select, update }, calls: { select, update, set, updateWhere } };
}

describe("runAnnouncementPublishCron", () => {
  it("publishes due announcements with one status update statement", async () => {
    const { db, calls } = createDb({
      dueScheduled: [
        { id: "ann-1", title: "First", publishAt: "2026-05-01T00:00:00.000Z" },
        { id: "ann-2", title: "Second", publishAt: "2026-05-01T00:01:00.000Z" },
      ],
    });
    mocks.drizzle.mockReturnValue(db);
    mocks.publishEntityChanged.mockResolvedValue(undefined);
    mocks.publishAnnouncementPublished.mockResolvedValue(undefined);

    await runAnnouncementPublishCron({ DB: {} } as never);

    const publishedUpdates = calls.set.mock.calls.filter((call) => call[0].status === "published");
    expect(publishedUpdates).toHaveLength(1);
    expect(mocks.publishAnnouncementPublished).toHaveBeenCalledTimes(2);
  });

  it("archives expired published announcements with one status update statement", async () => {
    const { db, calls } = createDb({
      dueExpired: [{ id: "ann-3" }, { id: "ann-4" }],
    });
    mocks.drizzle.mockReturnValue(db);
    mocks.publishEntityChanged.mockResolvedValue(undefined);
    mocks.publishAnnouncementPublished.mockResolvedValue(undefined);

    await runAnnouncementPublishCron({ DB: {} } as never);

    const archivedUpdates = calls.set.mock.calls.filter((call) => call[0].status === "archived");
    expect(archivedUpdates).toHaveLength(1);
    expect(mocks.publishEntityChanged).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityId: "ann-3", hint: "announcement_archived" }),
    );
    expect(mocks.publishEntityChanged).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityId: "ann-4", hint: "announcement_archived" }),
    );
  });
});
