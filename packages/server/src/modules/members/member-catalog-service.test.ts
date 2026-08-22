import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import type { ClassTagUsageReader, MemberMediaPort, MembersStore } from "./member-types";
import { MemberCatalogService } from "./member-catalog-service";

const NOW = "2026-08-09T12:00:00.000Z";

function context() {
  return createRequestContext({
    requestId: "request-1", now: NOW,
    authorization: createAuthorizationContext({
      userId: "admin", sessionId: "session", roleId: "admin", roleLevel: 900,
      permissions: [PERMISSION_ID.ADMIN_CLASSES_MANAGE, PERMISSION_ID.ADMIN_BADGES_MANAGE],
    }),
  });
}

function service(store: Partial<MembersStore>) {
  return new MemberCatalogService({
    store: store as MembersStore,
    media: {} as MemberMediaPort,
    tagUsage: { countByTagIds: async () => new Map() },
  });
}

describe("MemberCatalogService badge labels", () => {
  it("uses the profile-title sanitizer and rejects an empty sanitized label", async () => {
    const createBadge = vi.fn();
    const service = new MemberCatalogService({
      store: { createBadge } as unknown as MembersStore,
      media: {} as MemberMediaPort,
      tagUsage: {} as ClassTagUsageReader,
    });
    await expect(service.createBadge(context(), { name: "Badge", label_html: '<img src="x">' }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(createBadge).not.toHaveBeenCalled();
  });
});

describe("MemberCatalogService audit truth", () => {
  it("normalizes class membership before deciding whether a class tag changed", async () => {
    const existing = {
      id: "tag-1", label: "Support", class_ids: ["class-a", "class-b"], sort_order: 10,
      usage_count: 0, created_at: NOW, updated_at: NOW,
    };
    const updateClassTag = vi.fn().mockResolvedValue("updated");
    const catalog = service({
      findClassTag: vi.fn().mockResolvedValue(existing),
      listClasses: vi.fn().mockResolvedValue([
        { id: "class-a", label: "Class A" },
        { id: "class-b", label: "Class B" },
      ]),
      updateClassTag,
    });

    await expect(catalog.updateClassTag(context(), "tag-1", {
      label: "Support", class_ids: ["class-b", "class-a"], sort_order: 10,
    })).resolves.toEqual(existing);
    expect(updateClassTag).not.toHaveBeenCalled();

    await catalog.updateClassTag(context(), "tag-1", { label: "Frontline" });
    expect(updateClassTag).toHaveBeenCalledWith(
      "tag-1",
      { label: "Frontline", now: NOW },
      expect.objectContaining({
        payload: {
          schema_version: 2,
          changes: [{
            field: "label",
            before: { type: "text", value: "Support" },
            after: { type: "text", value: "Frontline" },
          }],
          context: [],
        },
      }),
    );
  });

  it("compares sanitized badge fields and exact catalog order before writing", async () => {
    const badge = {
      id: "badge-1", name: "Veteran", label_html: "<b>Veteran</b>", color: "#fff",
      description: null, sort_order: 0, created_at: NOW, updated_at: NOW,
    };
    const updateBadge = vi.fn().mockResolvedValue("updated");
    const reorderBadges = vi.fn().mockResolvedValue("updated");
    const catalog = service({
      findBadge: vi.fn().mockResolvedValue(badge),
      listBadges: vi.fn().mockResolvedValue([badge]),
      updateBadge,
      reorderBadges,
    });

    await expect(catalog.updateBadge(context(), "badge-1", { label_html: "  <b>Veteran</b>  " }))
      .resolves.toEqual(badge);
    expect(updateBadge).not.toHaveBeenCalled();

    await expect(catalog.reorderBadges(context(), { order: ["badge-1"] })).resolves.toEqual([badge]);
    expect(reorderBadges).not.toHaveBeenCalled();

    await catalog.updateBadge(context(), "badge-1", { color: "#000" });
    expect(updateBadge).toHaveBeenCalledWith(
      "badge-1",
      { color: "#000", now: NOW },
      expect.objectContaining({
        payload: {
          schema_version: 2,
          changes: [{
            field: "color",
            before: { type: "code", value: "#fff" },
            after: { type: "code", value: "#000" },
          }],
          context: [],
        },
      }),
    );
  });

  it("persists an explicit null description as a cleared badge field", async () => {
    const badge = {
      id: "badge-1", name: "Veteran", label_html: "Veteran", color: "#fff",
      description: "Original description", sort_order: 0, created_at: NOW, updated_at: NOW,
    };
    const updateBadge = vi.fn().mockResolvedValue("updated");
    const catalog = service({
      findBadge: vi.fn().mockResolvedValue(badge),
      updateBadge,
    });

    await catalog.updateBadge(context(), badge.id, { description: null });

    expect(updateBadge).toHaveBeenCalledWith(
      badge.id,
      { description: null, now: NOW },
      expect.objectContaining({
        payload: expect.objectContaining({
          changes: [{
            field: "description",
            before: { type: "text", value: "Original description" },
            after: { type: "null", value: null },
          }],
        }),
      }),
    );
  });
});
