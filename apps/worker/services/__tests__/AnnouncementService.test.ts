import { describe, expect, it, vi } from "vitest";
import { AnnouncementService } from "../AnnouncementService";

function createDeps() {
  return {
    media: {} as R2Bucket,
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    publishEntityChanged: vi.fn().mockResolvedValue(undefined),
    publishAnnouncementPublished: vi.fn().mockResolvedValue(undefined),
  };
}

function createListDb(rows: unknown[] = []) {
  const offset = vi.fn().mockResolvedValue(rows);
  const limit = vi.fn(() => ({ offset }));
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  return {
    db: { select, update },
    calls: { select, update, set, updateWhere },
  };
}

describe("AnnouncementService", () => {
  it("does not write announcement state while listing announcements", async () => {
    const { db, calls } = createListDb();
    const service = new AnnouncementService(db as never, createDeps());

    await service.list({ canReadAll: false, page: 1, limit: 20, archived: false });

    expect(calls.update).not.toHaveBeenCalled();
  });
});
