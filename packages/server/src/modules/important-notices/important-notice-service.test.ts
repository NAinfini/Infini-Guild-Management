import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { describe, expect, it, vi } from "vitest";
import {
  ImportantNoticeService,
  type ImportantNoticeRecord,
  type ImportantNoticeStore,
} from "./important-notice-service";
import { MAX_ACTIVE_IMPORTANT_NOTICES } from "@guild/shared/constants/important-notices";

const NOW = "2026-08-28T12:00:00.000Z";

const notice: ImportantNoticeRecord = {
  id: "notice-1",
  title: "Service notice",
  body_json: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
  status: "draft",
  publish_at: null,
  expires_at: null,
  publication_revision: 0,
  requires_acknowledgement: true,
  audience_scope: "all",
  audience_role_ids: [],
  revisionToken: "notice-revision-0001",
  createdBy: "admin-1",
  updatedBy: null,
  created_at: "2026-08-27T12:00:00.000Z",
  updated_at: "2026-08-27T12:00:00.000Z",
};

function context(permissions: readonly string[] = []) {
  return createRequestContext({
    requestId: "request-1",
    authorization: createAuthorizationContext({
      userId: "member-1",
      sessionId: "session-1",
      roleId: "role-member",
      roleLevel: 10,
      permissions,
    }),
    now: NOW,
  });
}

function anonymousContext() {
  return createRequestContext({
    requestId: "request-anonymous",
    authorization: createAuthorizationContext(null),
    now: NOW,
  });
}

function store(overrides: Partial<ImportantNoticeStore> = {}): ImportantNoticeStore {
  return {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(notice),
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(true),
    listAudienceRoles: vi.fn().mockResolvedValue([
      { id: "role-member", name: "Member", color: null, level: 10 },
      { id: "role-officer", name: "Officer", color: null, level: 50 },
    ]),
    listActive: vi.fn().mockResolvedValue([]),
    markRead: vi.fn().mockResolvedValue(0),
    acknowledge: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function service(value: ImportantNoticeStore, publish = vi.fn()) {
  return {
    publish,
    value: new ImportantNoticeService(
      value,
      { publish },
      { defer: (task) => { void task(); } },
    ),
  };
}

describe("ImportantNoticeService", () => {
  it("requires authentication before reading personalized notices", async () => {
    const listActive = vi.fn();
    const { value } = service(store({ listActive }));

    await expect(value.listActive(anonymousContext()))
      .rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(listActive).not.toHaveBeenCalled();
  });

  it("validates role audiences against the dynamic role catalog", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const { value } = service(store({ create }));

    await value.create(context(["admin.importantNotices.manage"]), {
      title: "Officers only",
      body_json: notice.body_json,
      status: "draft",
      requires_acknowledgement: false,
      audience_scope: "roles",
      audience_role_ids: ["role-officer"],
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      record: expect.objectContaining({
        audience_scope: "roles",
        audience_role_ids: ["role-officer"],
        requires_acknowledgement: false,
      }),
    }));
    await expect(value.create(context(["admin.importantNotices.manage"]), {
      title: "Unknown role",
      body_json: notice.body_json,
      status: "draft",
      requires_acknowledgement: false,
      audience_scope: "roles",
      audience_role_ids: ["role-missing"],
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
  });

  it("canonicalizes offset timestamps before scheduling and compares their actual instants", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const { value } = service(store({ create }));
    const admin = context(["admin.importantNotices.manage"]);

    await expect(value.create(admin, {
      title: "Not actually in the future",
      body_json: notice.body_json,
      status: "scheduled",
      publish_at: "2026-08-29T02:00:00+14:00",
      requires_acknowledgement: false,
      audience_scope: "all",
      audience_role_ids: [],
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });

    await value.create(admin, {
      title: "Canonical schedule",
      body_json: notice.body_json,
      status: "scheduled",
      publish_at: "2026-08-29T03:00:00+14:00",
      expires_at: "2026-08-29T04:00:00+14:00",
      requires_acknowledgement: false,
      audience_scope: "all",
      audience_role_ids: [],
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      record: expect.objectContaining({
        publish_at: "2026-08-28T13:00:00.000Z",
        expires_at: "2026-08-28T14:00:00.000Z",
      }),
    }));
  });

  it("rejects another deliverable notice once the bounded active budget is full", async () => {
    const list = vi.fn().mockResolvedValue(Array.from({ length: MAX_ACTIVE_IMPORTANT_NOTICES }, (_, index) => ({
      ...notice,
      id: `notice-${index}`,
      status: "published" as const,
      publish_at: NOW,
      publication_revision: 1,
    })));
    const create = vi.fn();
    const { value } = service(store({ list, create }));

    await expect(value.create(context(["admin.importantNotices.manage"]), {
      title: "One too many",
      body_json: notice.body_json,
      status: "scheduled",
      publish_at: "2026-08-28T13:00:00.000Z",
      requires_acknowledgement: false,
      audience_scope: "all",
      audience_role_ids: [],
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(create).not.toHaveBeenCalled();
  });

  it("acknowledges by notice identity and refreshes only that member's notification state", async () => {
    const acknowledge = vi.fn().mockResolvedValue(true);
    const { value, publish } = service(store({ acknowledge }));

    await expect(value.acknowledge(context(), "notice-1")).resolves.toEqual({ ok: true });

    expect(acknowledge).toHaveBeenCalledWith({
      userId: "member-1",
      roleId: "role-member",
      id: "notice-1",
      now: NOW,
    });
    expect(publish).toHaveBeenCalledWith({ type: "inbox_changed", user_id: "member-1" });
  });

  it("broadcasts publication and withdrawal so active notice caches refresh immediately", async () => {
    const get = vi.fn()
      .mockResolvedValueOnce(notice)
      .mockResolvedValueOnce({
        ...notice,
        status: "published",
        publish_at: NOW,
        publication_revision: 1,
        revisionToken: "notice-revision-0002",
      });
    const { value, publish } = service(store({ get }));
    const admin = context(["admin.importantNotices.manage"]);

    await value.publish(admin, notice.id);
    await value.withdraw(admin, notice.id);

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenNthCalledWith(1, { type: "inbox_changed" });
    expect(publish).toHaveBeenNthCalledWith(2, { type: "inbox_changed" });
  });
});
