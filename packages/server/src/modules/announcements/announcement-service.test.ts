import { describe, expect, it, vi } from "vitest";
import {
  createAuthorizationContext,
  createRequestContext,
  type DeferredTasks,
  type NotificationPublisher,
} from "@guild/kernel";
import {
  AnnouncementService,
  type AnnouncementDetailRecord,
  type AnnouncementStore,
} from "./announcement-service";
import type { MediaService } from "../media/public.js";

function context(permissions: readonly string[], userId = "user-1") {
  return createRequestContext({
    requestId: "request-1",
    authorization: createAuthorizationContext({
      userId,
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
    create: vi.fn().mockResolvedValue(existing),
    update: vi.fn().mockResolvedValue(existing),
    archive: vi.fn(),
    delete: vi.fn(),
    incrementView: vi.fn(),
    ...overrides,
  };
}

function service(
  value: AnnouncementStore,
  notifications: NotificationPublisher = { publish: vi.fn() },
  deferred: DeferredTasks = { defer: vi.fn() },
) {
  return new AnnouncementService(
    value,
    {} as MediaService,
    notifications,
    deferred,
  );
}

const existing: AnnouncementDetailRecord = {
  id: "announcement-1",
  title: "Existing",
  body_json: JSON.stringify({ type: "doc", content: [] }),
  category: "announcement",
  pinned: false,
  view_count: 0,
  excerpt: "",
  status: "published",
  publish_at: "2026-08-08T00:00:00.000Z",
  expires_at: null,
  archived_at: null,
  created_by: "user-1",
  updated_by: null,
  created_at: "2026-08-08T00:00:00.000Z",
  updated_at: "2026-08-08T00:00:00.000Z",
  preview_media_id: null,
  author: { id: "user-1", display_name: "User", avatar_media_id: null },
  attachments: [],
  revisionToken: "revision-old-123456",
};

describe("AnnouncementService", () => {
  it("returns the committed detail supplied by the write without a second read", async () => {
    const saved = { ...existing, title: "Saved", revisionToken: "revision-new-123456" };
    const create = vi.fn().mockResolvedValue(saved);
    const get = vi.fn().mockRejectedValue(new Error("post-commit detail read failed"));

    await expect(service(store({ create, get })).create(
      context(["announcements.create"]),
      {
        title: "Saved",
        category: "announcement",
        body_json: JSON.stringify({ type: "doc", content: [] }),
        pinned: false,
        status: "draft",
      },
      "https://guild.example",
      7,
      5,
    )).resolves.toMatchObject({ id: existing.id, title: "Saved" });

    expect(get).not.toHaveBeenCalled();
  });

  it("returns the committed update detail without a post-commit read", async () => {
    const saved = { ...existing, title: "Saved", revisionToken: "revision-new-123456" };
    const get = vi.fn().mockResolvedValueOnce(existing).mockRejectedValue(new Error("post-commit detail read failed"));
    const update = vi.fn().mockResolvedValue(saved);

    await expect(service(store({ get, update })).update(
      context(["announcements.edit"]),
      existing.id,
      { title: "Saved" },
      "https://guild.example",
      7,
      5,
      '"announcement-announcement-1-2026-08-08T00:00:00.000Z"',
    )).resolves.toMatchObject({ id: existing.id, title: "Saved" });

    expect(get).toHaveBeenCalledOnce();
  });

  it("canonicalizes same-origin rich-text media before the single atomic store mutation", async () => {
    const create = vi.fn().mockResolvedValue(existing);
    const announcements = store({ create, get: vi.fn().mockResolvedValue(existing) });
    const publish = vi.fn().mockResolvedValue(undefined);
    const mediaId = "123456789012345678901";

    await service(
      announcements,
      { publish },
      { defer: (task) => { void task(); } },
    ).create(context(["announcements.create"]), {
      title: " Launch ",
      category: "announcement",
      body_json: JSON.stringify({
        type: "doc",
        content: [{ type: "image", attrs: { src: `https://guild.example/api/media/${mediaId}/view` } }, {
          type: "paragraph",
          content: [{
            type: "text",
            text: "Guide",
            marks: [{ type: "link", attrs: { href: "https://external.example/guide" } }],
          }],
        }],
      }),
      pinned: true,
      status: "published",
      publish_at: "2026-08-09T00:00:00.000Z",
    }, "https://guild.example/announcements", 7, 5);

    expect(create).toHaveBeenCalledOnce();
    const mutation = create.mock.calls[0]![0];
    expect(mutation.record.title).toBe("Launch");
    expect(mutation.record.body_json).not.toContain("https://guild.example");
    expect(JSON.parse(mutation.record.body_json)).toMatchObject({
      content: [
        { attrs: { src: `/api/media/${mediaId}/view` } },
        {
          content: [{
            marks: [{
              attrs: {
                href: "https://external.example/guide",
                target: "_blank",
                rel: "noopener noreferrer",
                class: null,
              },
            }],
          }],
        },
      ],
    });
    expect(mutation.mediaIds).toEqual([mediaId]);
    expect(mutation.maxItems).toBe(7);
    expect(mutation.attachmentMediaIds).toEqual([]);
    expect(mutation.maxAttachmentItems).toBe(5);
    expect(mutation.audit.requestId).toBe("request-1");
    expect(mutation.audit.payload.context).toEqual([
      { field: "status", value: { type: "code", value: "published" } },
      { field: "category", value: { type: "code", value: "announcement" } },
      { field: "pinned", value: { type: "boolean", value: true } },
      { field: "publish_at", value: { type: "datetime", value: "2026-08-09T00:00:00.000Z" } },
    ]);
    expect(publish.mock.calls.map(([message]) => message)).toEqual([
      expect.objectContaining({
        type: "entity_changed",
        entity_type: "announcement",
        hint: "announcement_created",
      }),
      expect.objectContaining({
        type: "entity_changed",
        entity_type: "announcement",
        hint: "announcement_published",
      }),
      { type: "inbox_changed" },
    ]);
  });

  it("records a visible announcement view", async () => {
    const incrementView = vi.fn().mockResolvedValue(3);

    await expect(service(store({ incrementView })).recordView(context([]), "announcement-1"))
      .resolves.toEqual({ view_count: 3 });
    expect(incrementView).toHaveBeenCalledWith(
      "announcement-1",
      { kind: "public" },
      "2026-08-09T00:00:00.000Z",
    );
  });

  it("does not broadcast private draft creation or draft-only updates to members", async () => {
    const draft = {
      ...existing,
      status: "draft" as const,
      publish_at: null,
    };
    const create = vi.fn().mockResolvedValue(draft);
    const update = vi.fn().mockResolvedValue({ ...draft, title: "Private revision" });
    const get = vi.fn()
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({ ...draft, title: "Private revision" });
    const publish = vi.fn().mockResolvedValue(undefined);
    const announcements = service(
      store({ create, update, get }),
      { publish },
      { defer: (task) => { void task(); } },
    );

    await announcements.create(context(["announcements.create"]), {
      title: "Private draft",
      category: "announcement",
      body_json: JSON.stringify({ type: "doc", content: [] }),
      pinned: false,
      status: "draft",
      publish_at: null,
    }, "https://guild.example", 7, 5);
    await announcements.update(
      context(["announcements.edit"]),
      draft.id,
      { title: "Private revision" },
      "https://guild.example",
      7,
      5,
      '"announcement-announcement-1-2026-08-08T00:00:00.000Z"',
    );

    expect(publish).not.toHaveBeenCalled();
  });

  it("stages announcement images for editors without mutating an existing announcement", async () => {
    const uploadImages = vi.fn().mockResolvedValue(["media1234567890abcdef"]);
    const announcements = new AnnouncementService(
      store(),
      { uploadImages } as unknown as MediaService,
      { publish: vi.fn() },
      { defer: vi.fn() },
    );

    await expect(announcements.uploadPendingImages(
      context(["announcements.edit"]),
      [{ full: {} as never, view: {} as never }],
      1_024,
      5,
    )).resolves.toMatchObject({ media_ids: ["media1234567890abcdef"] });
    expect(uploadImages).toHaveBeenCalledOnce();
  });

  it("rejects a missing or stale editor revision before an update mutation", async () => {
    const update = vi.fn().mockResolvedValue(existing);
    const announcements = store({ get: vi.fn().mockResolvedValue(existing), update });

    await expect(service(announcements).update(
      context(["announcements.edit"]),
      existing.id,
      { title: "Changed" },
      "https://guild.example",
      9,
      5,
      undefined as never,
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await expect(service(announcements).update(
      context(["announcements.edit"]),
      existing.id,
      { title: "Changed" },
      "https://guild.example",
      9,
      5,
      '"announcement-announcement-1-stale"',
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(update).not.toHaveBeenCalled();
  });

  it("uses the editor revision in the atomic update mutation", async () => {
    const update = vi.fn().mockResolvedValue(existing);
    const announcements = store({ get: vi.fn().mockResolvedValue(existing), update });

    await service(announcements).update(
      context(["announcements.edit"]),
      existing.id,
      { title: "Changed" },
      "https://guild.example",
      9,
      5,
      '"announcement-announcement-1-2026-08-08T00:00:00.000Z"',
    );

    expect(update.mock.calls[0]![0].expectedRevisionToken).toBe(existing.revisionToken);
  });

  it("clears a publication time when an update explicitly provides null", async () => {
    const update = vi.fn().mockResolvedValue(existing);
    const announcements = store({ get: vi.fn().mockResolvedValue(existing), update });
    const publish = vi.fn().mockResolvedValue(undefined);

    await service(
      announcements,
      { publish },
      { defer: (task) => { void task(); } },
    ).update(
      context(["announcements.edit"]),
      existing.id,
      { status: "draft", publish_at: null },
      "https://guild.example",
      9,
      5,
      '"announcement-announcement-1-2026-08-08T00:00:00.000Z"',
    );

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      record: expect.objectContaining({ status: "draft", publish_at: null }),
    }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: "entity_changed",
      hint: "announcement_updated",
    }));
    expect(publish).not.toHaveBeenCalledWith({ type: "inbox_changed" });
  });

  it("records an attachment-only update without exposing attachment names in the audit", async () => {
    const update = vi.fn().mockResolvedValue(existing);
    const announcements = store({ get: vi.fn().mockResolvedValue(existing), update });

    await service(announcements).update(
      context(["announcements.edit"]),
      existing.id,
      { attachment_media_ids: ["123456789012345678901"] },
      "https://guild.example",
      9,
      5,
      '"announcement-announcement-1-2026-08-08T00:00:00.000Z"',
    );

    const audit = update.mock.calls[0]?.[0].audit;
    expect(audit.payload.changes).toContainEqual({
      field: "media_count",
      before: { type: "number", value: 0 },
      after: { type: "number", value: 1 },
    });
    expect(audit.payload.context).toEqual(expect.arrayContaining([
      {
        field: "changed_sections",
        value: { type: "list", value: [{ type: "code", value: "attachments" }] },
      },
      { field: "media_count", value: { type: "number", value: 1 } },
    ]));
  });

  it("derives public, owned, and all announcement read scopes from server authorization", async () => {
    const list = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, total_pages: 0 });
    const get = vi.fn().mockResolvedValue(existing);
    const incrementView = vi.fn().mockResolvedValue(1);
    const announcements = service(store({ list, get, incrementView }));
    const anonymous = createRequestContext({
      requestId: "request-public",
      authorization: createAuthorizationContext(null),
      now: "2026-08-09T00:00:00.000Z",
    });
    await announcements.list(anonymous, { page: 1, limit: 20, sort: "updated_desc" });
    await announcements.list(context([]), { page: 1, limit: 20, sort: "updated_desc" });
    await announcements.list(context(["announcements.create"], "author-a"), {
      page: 1,
      limit: 20,
      status: "draft",
      sort: "updated_desc",
    });
    await announcements.get(context(["announcements.create"], "author-a"), existing.id);
    await announcements.recordView(context(["announcements.create"], "author-a"), existing.id);
    await announcements.list(context(["announcements.edit"]), { page: 1, limit: 20, sort: "updated_desc" });

    expect(list.mock.calls[0]![0].readScope).toEqual({ kind: "public" });
    expect(list.mock.calls[1]![0].readScope).toEqual({ kind: "public" });
    expect(list.mock.calls[2]![0].readScope).toEqual({ kind: "owned", ownerUserId: "author-a" });
    expect(get).toHaveBeenCalledWith(existing.id, { kind: "owned", ownerUserId: "author-a" }, "2026-08-09T00:00:00.000Z");
    expect(incrementView).toHaveBeenCalledWith(existing.id, { kind: "owned", ownerUserId: "author-a" }, "2026-08-09T00:00:00.000Z");
    expect(list.mock.calls[3]![0].readScope).toEqual({ kind: "all" });
  });

  it("preserves safe announcement state in the delete audit", async () => {
    const remove = vi.fn().mockResolvedValue(true);
    await service(store({ get: vi.fn().mockResolvedValue(existing), delete: remove }))
      .delete(
        context(["announcements.delete"]),
        existing.id,
        '"announcement-announcement-1-2026-08-08T00:00:00.000Z"',
      );

    expect(remove.mock.calls[0]![0].audit.payload.context).toEqual([
      { field: "status", value: { type: "code", value: existing.status } },
      { field: "category", value: { type: "code", value: existing.category } },
      { field: "pinned", value: { type: "boolean", value: existing.pinned } },
      { field: "publish_at", value: { type: "datetime", value: existing.publish_at } },
    ]);
  });

  it("rejects stale archive and permanent-delete confirmations before store mutation", async () => {
    const archive = vi.fn().mockResolvedValue(true);
    const remove = vi.fn().mockResolvedValue(true);
    const announcements = service(store({
      get: vi.fn().mockResolvedValue(existing),
      archive,
      delete: remove,
    }));

    await expect(announcements.archive(
      context(["announcements.archive"]),
      existing.id,
      '"announcement-announcement-1-stale"',
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await expect(announcements.delete(
      context(["announcements.delete"]),
      existing.id,
      '"announcement-announcement-1-stale"',
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(archive).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
