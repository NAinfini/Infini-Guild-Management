import { describe, expect, it } from "vitest";
import {
  buildCleanupSteps,
  createInitialTestRunContext,
  type TestRunContext,
} from "./AdminApiTestEngine";

function contextWith(values: Partial<TestRunContext>): TestRunContext {
  return { ...createInitialTestRunContext(), ...values };
}

describe("AdminApiTestEngine cleanup planning", () => {
  it("permanently deletes test-created content before parent records", () => {
    const steps = buildCleanupSteps(contextWith({
      createdAnnouncementId: "announcement-1",
      createdWikiArticleId: "article-1",
      createdWikiCategoryId: "category-1",
      createdEventId: "event-1",
      createdTemplateId: "template-1",
    }));

    expect(steps.map((step) => step.label)).toEqual([
      "Cleanup: Announcement",
      "Cleanup: Wiki Article",
      "Cleanup: Wiki Category",
      "Cleanup: Event Template",
      "Cleanup: Archive Event",
      "Cleanup: Destroy Event",
    ]);
    expect(steps.map((step) => step.path)).toEqual([
      "/api/announcements/announcement-1/permanent",
      "/api/wiki/articles/article-1/permanent",
      "/api/wiki/categories/category-1",
      "/api/events/templates/template-1",
      "/api/events/event-1",
      "/api/events/event-1/destroy",
    ]);
  });

  it("builds user cleanup with restore, media removal, and batch deletion", () => {
    const steps = buildCleanupSteps(contextWith({
      meId: "admin-1",
      targetProfileSnapshot: { bio: "existing bio", classes: ["mage"] },
      uploadedImageKey: "systemtest-image-key",
      registeredUserId: "registered-1",
      adminCreatedUserId: "created-1",
      adminCreatedUserPassword: "TempPass123!",
    }));

    expect(steps).toEqual([
      {
        label: "Cleanup: Restore Profile",
        method: "PATCH",
        path: "/api/users/admin-1/profile",
        jsonBody: { bio: "existing bio", classes: ["mage"] },
        clearContext: { targetProfileSnapshot: null },
      },
      {
        label: "Cleanup: Test Image",
        method: "DELETE",
        path: "/api/users/admin-1/media/images",
        jsonBody: { keys: ["systemtest-image-key"] },
        clearContext: { uploadedImageKey: null },
      },
      {
        label: "Cleanup: Registered User",
        method: "PATCH",
        path: "/api/admin/users/batch/delete",
        jsonBody: { user_ids: ["registered-1"] },
        clearContext: { registeredUserId: null },
      },
      {
        label: "Cleanup: Admin Created User",
        method: "PATCH",
        path: "/api/admin/users/batch/delete",
        jsonBody: { user_ids: ["created-1"] },
        clearContext: { adminCreatedUserId: null, adminCreatedUserPassword: null },
      },
    ]);
  });
});
