import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { AnnouncementService, type AnnouncementRecord, type AnnouncementStore } from "./announcement-service";
import type { MediaService } from "../media/public.js";

function context(permissions: readonly string[]) {
  return createRequestContext({
    requestId: "request-1",
    authorization: createAuthorizationContext({
      userId: "user-1",
      sessionId: "session-1",
      roleId: "member",
      roleLevel: 100,
      permissions,
    }),
    now: "2026-08-09T00:00:00.000Z",
  });
}

function store(overrides: Partial<AnnouncementStore> = {}): AnnouncementStore {
  return {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    delete: vi.fn(),
    appendImages: vi.fn(),
    ...overrides,
  };
}

function service(value: AnnouncementStore) {
  return new AnnouncementService(
    value,
    {} as MediaService,
    { publish: vi.fn() },
    { defer: vi.fn() },
  );
}

const existing: AnnouncementRecord = {
  id: "announcement-1",
  title: "Existing",
  body_json: JSON.stringify({ type: "doc", content: [] }),
  pinned: false,
  status: "published",
  publish_at: "2026-08-08T00:00:00.000Z",
  expires_at: null,
  archived_at: null,
  created_by: "user-1",
  updated_by: null,
  created_at: "2026-08-08T00:00:00.000Z",
  updated_at: "2026-08-08T00:00:00.000Z",
  revisionToken: "revision-old-123456",
};

describe("AnnouncementService", () => {
  it("canonicalizes same-origin rich-text media before the single atomic store mutation", async () => {
    const create = vi.fn();
    const announcements = store({ create });
    const mediaId = "123456789012345678901";

    await service(announcements).create(context(["announcements.create"]), {
      title: " Launch ",
      body_json: JSON.stringify({
        type: "doc",
        content: [{ type: "image", attrs: { src: `https://guild.example/api/media/${mediaId}/view` } }],
      }),
      pinned: true,
      status: "published",
      publish_at: "2026-08-09T00:00:00.000Z",
    }, "https://guild.example/announcements", 7);

    expect(create).toHaveBeenCalledOnce();
    const mutation = create.mock.calls[0]![0];
    expect(mutation.record.title).toBe("Launch");
    expect(mutation.record.body_json).not.toContain("https://guild.example");
    expect(mutation.mediaIds).toEqual([mediaId]);
    expect(mutation.maxItems).toBe(7);
    expect(mutation.audit.requestId).toBe("request-1");
    expect(mutation.audit.payload.context).toEqual([
      { field: "status", value: { type: "code", value: "published" } },
      { field: "pinned", value: { type: "boolean", value: true } },
      { field: "publish_at", value: { type: "datetime", value: "2026-08-09T00:00:00.000Z" } },
    ]);
  });

  it("uses a revision token CAS even when an If-Match header is absent", async () => {
    const update = vi.fn().mockResolvedValue(false);
    const announcements = store({ get: vi.fn().mockResolvedValue(existing), update });

    await expect(service(announcements).update(
      context(["announcements.edit"]),
      existing.id,
      { title: "Changed" },
      "https://guild.example",
      9,
    )).rejects.toMatchObject({ code: "CONFLICT" });
    expect(update.mock.calls[0]![0].expectedRevisionToken).toBe(existing.revisionToken);
  });

  it("clears a publication time when an update explicitly provides null", async () => {
    const update = vi.fn().mockResolvedValue(true);
    const announcements = store({ get: vi.fn().mockResolvedValue(existing), update });

    await service(announcements).update(
      context(["announcements.edit"]),
      existing.id,
      { status: "draft", publish_at: null },
      "https://guild.example",
      9,
    );

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      record: expect.objectContaining({ status: "draft", publish_at: null }),
    }));
  });

  it("never grants manager visibility to an anonymous list", async () => {
    const list = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, total_pages: 0 });
    const anonymous = createRequestContext({
      requestId: "request-public",
      authorization: createAuthorizationContext(null),
      now: "2026-08-09T00:00:00.000Z",
    });
    await service(store({ list })).list(anonymous, { page: 1, limit: 20, sort: "updated_desc" });
    expect(list.mock.calls[0]![0].canReadAll).toBe(false);
  });

  it("preserves safe announcement state in the delete audit", async () => {
    const remove = vi.fn().mockResolvedValue(true);
    await service(store({ get: vi.fn().mockResolvedValue(existing), delete: remove }))
      .delete(context(["announcements.delete"]), existing.id);

    expect(remove.mock.calls[0]![0].audit.payload.context).toEqual([
      { field: "status", value: { type: "code", value: existing.status } },
      { field: "pinned", value: { type: "boolean", value: existing.pinned } },
      { field: "publish_at", value: { type: "datetime", value: existing.publish_at } },
    ]);
  });
});
