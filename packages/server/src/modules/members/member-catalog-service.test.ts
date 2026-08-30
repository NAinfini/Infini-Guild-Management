import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { catalogRevisionToken } from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import type { ClassTagUsageReader, MemberMediaPort, MembersStore } from "./member-types";
import { MemberCatalogService } from "./member-catalog-service";

const NOW = "2026-08-09T12:00:00.000Z";
const NEXT = "2026-08-09T12:00:00.001Z";

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
    media: { listClassIcons: async () => new Map() } as unknown as MemberMediaPort,
    tagUsage: { countByTagIds: async () => new Map() },
  });
}

function catalogService(
  store: Partial<MembersStore>,
  media: Partial<MemberMediaPort> = {},
  tagUsage: Partial<ClassTagUsageReader> = {},
) {
  return new MemberCatalogService({
    store: store as MembersStore,
    media: {
      listClassIcons: async () => new Map(),
      ...media,
    } as MemberMediaPort,
    tagUsage: {
      countByTagIds: async () => new Map(),
      ...tagUsage,
    } as ClassTagUsageReader,
  });
}

describe("MemberCatalogService committed mutation snapshots", () => {
  const classRecord = {
    id: "class-1", label: "Class", color: "#fff", icon_type: "vector" as const, vector_icon: "sword" as const,
    sort_order: 0, created_at: NOW, updated_at: NOW,
  };
  const tagRecord = {
    id: "tag-1", label: "Tag", class_ids: ["class-1"], sort_order: 0, created_at: NOW, updated_at: NOW,
  };
  const badgeRecord = {
    id: "badge-1", name: "Badge", label_html: "Badge", color: "#fff", description: null,
    sort_order: 0, created_at: NOW, updated_at: NOW,
  };

  it("does not turn a committed class creation into a failed response when a later projection would fail", async () => {
    const findClass = vi.fn().mockRejectedValue(new Error("post-commit class projection"));
    const catalog = catalogService({
      createClass: vi.fn().mockResolvedValue({ outcome: "created", record: classRecord }),
      findClass,
    });

    await expect(catalog.createClass(context(), {
      label: classRecord.label, color: classRecord.color, vector_icon: "sword",
    })).resolves.toEqual(expect.objectContaining(classRecord));
    expect(findClass).not.toHaveBeenCalled();
  });

  it("uses class-icon mutation snapshots instead of rereading the class after upload or delete", async () => {
    const imageRecord = { ...classRecord, icon_type: "image" as const, vector_icon: null, updated_at: NEXT };
    const deletedAt = "2026-08-09T12:00:00.002Z";
    const findClass = vi.fn()
      .mockResolvedValueOnce(classRecord)
      .mockResolvedValueOnce(imageRecord)
      .mockRejectedValue(new Error("post-commit class projection"));
    const uploadClassIcon = vi.fn().mockResolvedValue({
      iconType: "image",
      vectorIcon: null,
      updatedAt: NEXT,
      iconMediaId: "class-media-1",
    });
    const deleteClassIcon = vi.fn().mockResolvedValue({
      iconType: "vector",
      vectorIcon: "sword",
      updatedAt: deletedAt,
      iconMediaId: null,
    });
    const catalog = catalogService({ findClass }, {
      uploadClassIcon,
      deleteClassIcon,
      listClassIcons: vi.fn().mockResolvedValue(new Map([[classRecord.id, "class-media-1"]])),
    });

    await expect(catalog.uploadClassIcon(
      context(), classRecord.id, { full: new Uint8Array(), view: new Uint8Array() }, NOW,
    )).resolves.toEqual(expect.objectContaining({
      ...classRecord, icon_type: "image", vector_icon: null, icon_media_id: "class-media-1", updated_at: NEXT,
    }));
    await expect(catalog.deleteClassIcon(context(), classRecord.id, NEXT)).resolves.toEqual(expect.objectContaining({
      ...classRecord, icon_type: "vector", vector_icon: "sword", icon_media_id: null, updated_at: deletedAt,
    }));
    expect(findClass).toHaveBeenCalledTimes(2);
  });

  it("does not reread tag or badge projections after their committed writes", async () => {
    const findClassTag = vi.fn().mockRejectedValue(new Error("post-commit tag projection"));
    const findBadge = vi.fn().mockRejectedValue(new Error("post-commit badge projection"));
    const catalog = catalogService({
      listClasses: vi.fn().mockResolvedValue([classRecord]),
      createClassTag: vi.fn().mockResolvedValue({ outcome: "created", record: tagRecord }),
      findClassTag,
      createBadge: vi.fn().mockResolvedValue({ outcome: "created", record: badgeRecord }),
      findBadge,
    }, {}, {
      countByTagIds: vi.fn().mockRejectedValue(new Error("post-commit tag usage projection")),
    });

    await expect(catalog.createClassTag(context(), {
      label: tagRecord.label, class_ids: tagRecord.class_ids,
    })).resolves.toEqual({ ...tagRecord, usage_count: 0 });
    await expect(catalog.createBadge(context(), {
      name: badgeRecord.name, label_html: badgeRecord.label_html,
    })).resolves.toEqual(badgeRecord);
    expect(findClassTag).not.toHaveBeenCalled();
    expect(findBadge).not.toHaveBeenCalled();
  });

  it("returns the assignment revision from the committed badge mutation snapshot", async () => {
    const findBadge = vi.fn().mockResolvedValueOnce(badgeRecord).mockRejectedValue(new Error("post-commit badge projection"));
    const catalog = catalogService({
      findBadge,
      assignBadge: vi.fn().mockResolvedValue({ changed: 1, updatedAt: NEXT }),
    });

    await expect(catalog.assignBadge(context(), badgeRecord.id, ["member-1"])).resolves.toEqual({
      assigned: 1,
      updated_at: NEXT,
    });
    expect(findBadge).toHaveBeenCalledOnce();
  });

  it("uses compare-and-swap command snapshots for class, tag, and badge updates and reorders", async () => {
    const classItems = [
      classRecord,
      { ...classRecord, id: "class-2", label: "Class Two", sort_order: 10 },
    ];
    const tagItems = [
      { ...tagRecord, usage_count: 0 },
      { ...tagRecord, id: "tag-2", label: "Tag Two", sort_order: 10, usage_count: 0 },
    ];
    const badgeItems = [
      badgeRecord,
      { ...badgeRecord, id: "badge-2", name: "Badge Two", sort_order: 10 },
    ];
    const findClass = vi.fn().mockResolvedValueOnce(classRecord).mockRejectedValue(new Error("post-commit class projection"));
    const listClasses = vi.fn().mockResolvedValueOnce(classItems).mockRejectedValue(new Error("post-commit class projection"));
    const findClassTag = vi.fn().mockResolvedValueOnce(tagRecord).mockRejectedValue(new Error("post-commit tag projection"));
    const listClassTags = vi.fn().mockResolvedValueOnce(tagItems).mockRejectedValue(new Error("post-commit tag projection"));
    const tagUsage = vi.fn().mockResolvedValue(new Map());
    const findBadge = vi.fn().mockResolvedValueOnce(badgeRecord).mockRejectedValue(new Error("post-commit badge projection"));
    const listBadges = vi.fn().mockResolvedValueOnce(badgeItems).mockRejectedValue(new Error("post-commit badge projection"));
    const catalog = catalogService({
      findClass,
      listClasses,
      updateClass: vi.fn().mockResolvedValue("updated"),
      reorderClasses: vi.fn().mockResolvedValue("updated"),
      findClassTag,
      listClassTags,
      updateClassTag: vi.fn().mockResolvedValue("updated"),
      reorderClassTags: vi.fn().mockResolvedValue("updated"),
      findBadge,
      listBadges,
      updateBadge: vi.fn().mockResolvedValue("updated"),
      reorderBadges: vi.fn().mockResolvedValue("updated"),
    }, {
      listClassIcons: vi.fn().mockResolvedValue(new Map()),
    }, {
      countByTagIds: tagUsage,
    });

    await expect(catalog.updateClass(context(), classRecord.id, {
      label: "Renamed", expected_updated_at: NOW,
    })).resolves.toEqual(expect.objectContaining({ label: "Renamed" }));
    await expect(catalog.reorderClasses(context(), {
      order: ["class-2", "class-1"], expected_revision_token: catalogRevisionToken(classItems),
    })).resolves.toHaveLength(2);
    await expect(catalog.updateClassTag(context(), tagRecord.id, {
      label: "Renamed", expected_updated_at: NOW,
    })).resolves.toEqual(expect.objectContaining({ label: "Renamed" }));
    await expect(catalog.reorderClassTags(context(), {
      order: ["tag-2", "tag-1"], expected_revision_token: catalogRevisionToken(tagItems),
    })).resolves.toHaveLength(2);
    await expect(catalog.updateBadge(context(), badgeRecord.id, {
      name: "Renamed", expected_updated_at: NOW,
    })).resolves.toEqual(expect.objectContaining({ name: "Renamed" }));
    await expect(catalog.reorderBadges(context(), {
      order: ["badge-2", "badge-1"], expected_revision_token: catalogRevisionToken(badgeItems),
    })).resolves.toHaveLength(2);

    expect(findClass).toHaveBeenCalledOnce();
    expect(listClasses).toHaveBeenCalledOnce();
    expect(findClassTag).toHaveBeenCalledOnce();
    expect(listClassTags).toHaveBeenCalledOnce();
    expect(tagUsage).toHaveBeenCalledTimes(2);
    expect(findBadge).toHaveBeenCalledOnce();
    expect(listBadges).toHaveBeenCalledOnce();
  });
});

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
      expected_updated_at: NOW,
    })).resolves.toEqual(existing);
    expect(updateClassTag).not.toHaveBeenCalled();

    await catalog.updateClassTag(context(), "tag-1", { label: "Frontline", expected_updated_at: NOW });
    expect(updateClassTag).toHaveBeenCalledWith(
      "tag-1",
      { label: "Frontline", expectedUpdatedAt: NOW, now: NEXT },
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

    await expect(catalog.updateBadge(context(), "badge-1", {
      label_html: "  <b>Veteran</b>  ", expected_updated_at: NOW,
    }))
      .resolves.toEqual(badge);
    expect(updateBadge).not.toHaveBeenCalled();

    await expect(catalog.reorderBadges(context(), {
      order: ["badge-1"], expected_revision_token: catalogRevisionToken([badge]),
    })).resolves.toEqual([badge]);
    expect(reorderBadges).not.toHaveBeenCalled();

    await catalog.updateBadge(context(), "badge-1", { color: "#000", expected_updated_at: NOW });
    expect(updateBadge).toHaveBeenCalledWith(
      "badge-1",
      { color: "#000", expectedUpdatedAt: NOW, now: NEXT },
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

    await catalog.updateBadge(context(), badge.id, { description: null, expected_updated_at: NOW });

    expect(updateBadge).toHaveBeenCalledWith(
      badge.id,
      { description: null, expectedUpdatedAt: NOW, now: NEXT },
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

describe("MemberCatalogService catalog compare-and-swap", () => {
  const classItem = {
    id: "class-1", label: "Class", color: "#fff", icon_type: "vector" as const, vector_icon: "sword" as const,
    sort_order: 0, created_at: NOW, updated_at: NOW,
  };
  const tagItem = {
    id: "tag-1", label: "Tag", class_ids: [], sort_order: 0, usage_count: 0, created_at: NOW, updated_at: NOW,
  };
  const badgeItem = {
    id: "badge-1", name: "Badge", label_html: "Badge", color: "#fff", description: null,
    sort_order: 0, created_at: NOW, updated_at: NOW,
  };

  it("rejects stale detail baselines before any store write", async () => {
    const updateClass = vi.fn();
    const updateClassTag = vi.fn();
    const updateBadge = vi.fn();
    const catalog = service({
      findClass: vi.fn().mockResolvedValue(classItem),
      findClassTag: vi.fn().mockResolvedValue(tagItem),
      findBadge: vi.fn().mockResolvedValue(badgeItem),
      updateClass,
      updateClassTag,
      updateBadge,
    });
    const stale = "2026-08-09T11:59:59.999Z";

    await expect(catalog.updateClass(context(), classItem.id, {
      label: "Requested", expected_updated_at: stale,
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await expect(catalog.updateClassTag(context(), tagItem.id, {
      label: "Requested", expected_updated_at: stale,
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await expect(catalog.updateBadge(context(), badgeItem.id, {
      name: "Requested", expected_updated_at: stale,
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(updateClass).not.toHaveBeenCalled();
    expect(updateClassTag).not.toHaveBeenCalled();
    expect(updateBadge).not.toHaveBeenCalled();
  });

  it("rejects full same-ID reorder baselines whose ordered collection token has changed", async () => {
    const classes = [classItem, { ...classItem, id: "class-2", label: "Class Two", sort_order: 10 }];
    const tags = [tagItem, { ...tagItem, id: "tag-2", label: "Tag Two", sort_order: 10 }];
    const badges = [badgeItem, { ...badgeItem, id: "badge-2", name: "Badge Two", sort_order: 10 }];
    const reorderClasses = vi.fn();
    const reorderClassTags = vi.fn();
    const reorderBadges = vi.fn();
    const catalog = service({
      listClasses: vi.fn().mockResolvedValue(classes),
      listClassTags: vi.fn().mockResolvedValue(tags),
      listBadges: vi.fn().mockResolvedValue(badges),
      reorderClasses,
      reorderClassTags,
      reorderBadges,
    });

    await expect(catalog.reorderClasses(context(), {
      order: ["class-2", "class-1"], expected_revision_token: catalogRevisionToken([...classes].reverse()),
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await expect(catalog.reorderClassTags(context(), {
      order: ["tag-2", "tag-1"], expected_revision_token: catalogRevisionToken([...tags].reverse()),
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await expect(catalog.reorderBadges(context(), {
      order: ["badge-2", "badge-1"], expected_revision_token: catalogRevisionToken([...badges].reverse()),
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(reorderClasses).not.toHaveBeenCalled();
    expect(reorderClassTags).not.toHaveBeenCalled();
    expect(reorderBadges).not.toHaveBeenCalled();
  });

  it("converts final-store stale outcomes, including a confirmation delete, into conflicts", async () => {
    const deleteBadge = vi.fn().mockResolvedValue("stale");
    const reorderBadges = vi.fn().mockResolvedValue("stale_order");
    const catalog = service({
      findBadge: vi.fn().mockResolvedValue(badgeItem),
      listBadges: vi.fn().mockResolvedValue([badgeItem, { ...badgeItem, id: "badge-2", sort_order: 10 }]),
      deleteBadge,
      reorderBadges,
    });
    const badges = await catalog.listBadges();

    await expect(catalog.deleteBadge(context(), badgeItem.id, NOW))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await expect(catalog.reorderBadges(context(), {
      order: ["badge-2", "badge-1"], expected_revision_token: catalogRevisionToken(badges),
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(deleteBadge).toHaveBeenCalledWith(badgeItem.id, NOW, expect.anything());
    expect(reorderBadges).toHaveBeenCalledOnce();
  });
});
