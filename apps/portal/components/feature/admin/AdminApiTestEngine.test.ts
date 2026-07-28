import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STALE_ARTIFACT_PROBES,
  buildJsonRequest,
  buildCleanupSteps,
  buildApiCategories,
  captureContextFromResponse,
  countStaleSystemTestArtifacts,
  createInitialTestRunContext,
  filterApiCategoriesForPermissions,
  prepareEndpointRequest,
  resolveEndpointPath,
  runEndpointTest,
  type TestRunContext,
} from "./AdminApiTestEngine";

function contextWith(values: Partial<TestRunContext>): TestRunContext {
  return { ...createInitialTestRunContext(), ...values };
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("builds user cleanup with batch deletion", () => {
    const steps = buildCleanupSteps(contextWith({
      meId: "admin-1",
      registeredUserId: "registered-1",
      adminCreatedUserId: "created-1",
      adminCreatedUserPassword: "TempPass123!",
    }));

    expect(steps).toEqual([
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
        clearContext: { adminCreatedUserId: null, adminCreatedUsername: null, adminCreatedUserPassword: null },
      },
    ]);
  });

  it("cleans up storage fixtures from item to category to storage", () => {
    const steps = buildCleanupSteps(contextWith({
      createdStorageId: "storage-1",
      createdStorageCategoryId: "category-1",
      createdStorageItemId: "item-1",
      createdStorageImageId: "image-1",
    } as Partial<TestRunContext>));

    expect(steps.slice(0, 4)).toEqual([
      {
        label: "Cleanup: Storage Image",
        method: "DELETE",
        path: "/api/storage/items/item-1/images/image-1",
        clearContext: { createdStorageImageId: null, storageImageKey: null },
      },
      {
        label: "Cleanup: Storage Item",
        method: "DELETE",
        path: "/api/storage/items/item-1",
        clearContext: { createdStorageItemId: null },
      },
      {
        label: "Cleanup: Storage Category",
        method: "DELETE",
        path: "/api/storage/storages/storage-1/categories/category-1",
        clearContext: { createdStorageCategoryId: null },
      },
      {
        label: "Cleanup: Storage",
        method: "DELETE",
        path: "/api/storage/storages/storage-1",
        clearContext: { createdStorageId: null },
      },
    ]);
  });
});

describe("AdminApiTestEngine request preparation", () => {
  function parseJsonBody(prepared: { body?: BodyInit }): unknown {
    expect(typeof prepared.body).toBe("string");
    return JSON.parse(prepared.body as string) as unknown;
  }

  it("uses the captured admin-created username for login smoke tests", () => {
    const endpoint = { label: "Login", method: "POST" as const, path: "/api/auth/login" };
    const ctx = contextWith({
      adminCreatedUserId: "user-1",
      adminCreatedUsername: "systemtest_admin_123",
      adminCreatedUserPassword: "TempPass123!",
    });

    const prepared = prepareEndpointRequest(endpoint, ctx);

    expect(parseJsonBody(prepared)).toEqual({
      username: "systemtest_admin_123",
      password: "TempPass123!",
    });
    expect(prepared.credentials).toBe("omit");
  });

  it("falls back to the registered test user for login smoke tests", () => {
    const endpoint = { label: "Login", method: "POST" as const, path: "/api/auth/login" };
    const ctx = contextWith({
      registeredUsername: "systemtest_123",
      registeredUserPassword: "Passw0rd!",
    });

    const prepared = prepareEndpointRequest(endpoint, ctx);

    expect(parseJsonBody(prepared)).toEqual({
      username: "systemtest_123",
      password: "Passw0rd!",
    });
    expect(prepared.credentials).toBe("omit");
  });

  it("creates badges with the backend schema fields", () => {
    const endpoint = { label: "Create Badge", method: "POST" as const, path: "/api/badges" };

    const prepared = prepareEndpointRequest(endpoint, createInitialTestRunContext());
    const body = parseJsonBody(prepared) as Record<string, unknown>;

    expect(body.label_html).toBeTypeOf("string");
    expect(body.icon).toBeUndefined();
  });

  it("sends guild war member stats in the nested route contract shape", () => {
    const ctx = contextWith({ createdConcludedWarHistoryId: "concluded-war", warMemberUserId: "user-1" });

    const single = prepareEndpointRequest(
      { label: "Stats", method: "PATCH", path: "/api/guild-war/history/:id/member-stats/:userId" },
      ctx,
    );
    const batch = prepareEndpointRequest(
      { label: "Batch Stats", method: "PATCH", path: "/api/guild-war/history/:id/member-stats/batch" },
      ctx,
    );

    expect(parseJsonBody(single)).toEqual({ stats: { kills: 1 } });
    expect(parseJsonBody(batch)).toEqual({ updates: [{ user_id: "user-1", stats: { stats: { kills: 2 } } }] });
  });

  it("prepares guild-war smoke mutations against a guild-war-local disposable event", () => {
    const eventEndpoint = { label: "Create Guild War Fixture", method: "POST" as const, path: "/api/events?fixture=guild-war" };
    const createdCtx = captureContextFromResponse(
      createInitialTestRunContext(),
      eventEndpoint,
      {
        status: 201,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-05-18T00:00:00.000Z",
        parsedJson: { id: "guild-war-event", type: "guild_war" },
      },
    );

    expect(parseJsonBody(prepareEndpointRequest(eventEndpoint, createInitialTestRunContext()))).toMatchObject({
      type: "guild_war",
    });
    expect(createdCtx.createdGuildWarEventId).toBe("guild-war-event");

    const ctx = { ...createdCtx, adminCreatedUserId: "user-1", warMemberUserId: "user-1" };
    expect(parseJsonBody(prepareEndpointRequest(
      { label: "Save Teams", method: "POST", path: "/api/guild-war/save-teams" },
      ctx,
    ))).toMatchObject({ event_id: "guild-war-event" });
    expect(parseJsonBody(prepareEndpointRequest(
      { label: "Conclude", method: "POST", path: "/api/guild-war/conclude" },
      ctx,
    ))).toMatchObject({ event_id: "guild-war-event" });
  });

  it("runs guild-war move before save-teams so conclude keeps a team member", () => {
    const endpointKeys = buildApiCategories((key) => key)
      .find((category) => category.key === "guildWar")
      ?.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`) ?? [];

    expect(endpointKeys.indexOf("POST /api/guild-war/move")).toBeLessThan(endpointKeys.indexOf("POST /api/guild-war/save-teams"));
    expect(endpointKeys.indexOf("POST /api/guild-war/save-teams")).toBeLessThan(endpointKeys.indexOf("POST /api/guild-war/conclude"));
  });

  it("stages an announcement image before creating and claiming it", () => {
    const endpointKeys = buildApiCategories((key) => key)
      .find((category) => category.key === "announcements")
      ?.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`) ?? [];
    expect(endpointKeys.indexOf("POST /api/announcements/images/stage"))
      .toBeLessThan(endpointKeys.indexOf("POST /api/announcements"));

    const stageEndpoint = {
      label: "Stage Announcement Image",
      method: "POST" as const,
      path: "/api/announcements/images/stage",
    };
    const stageRequest = prepareEndpointRequest(stageEndpoint, createInitialTestRunContext());
    expect(stageRequest.body).toBeInstanceOf(FormData);
    expect((stageRequest.body as FormData).get("files")).toBeInstanceOf(File);

    const stagedContext = captureContextFromResponse(
      createInitialTestRunContext(),
      stageEndpoint,
      {
        status: 201,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-07-28T00:00:00.000Z",
        parsedJson: {
          staging_id: "abcdefghijklmnopqrstu",
          staging_token: "signed-staging-token",
          keys: ["announcement/abcdefghijklmnopqrstu/images/image.png"],
        },
      },
    );
    expect(stagedContext.announcementStagingToken).toBe("signed-staging-token");
    expect(stagedContext.announcementImageKey).toBe("announcement/abcdefghijklmnopqrstu/images/image.png");

    const createRequest = prepareEndpointRequest(
      { label: "Create Announcement", method: "POST", path: "/api/announcements" },
      stagedContext,
    );
    const createBody = parseJsonBody(createRequest) as Record<string, unknown>;
    expect(createBody.staging_token).toBe("signed-staging-token");
    expect(createBody.body_json).toContain(
      encodeURIComponent("announcement/abcdefghijklmnopqrstu/images/image.png"),
    );
  });

  it("uses concluded history for member stats requests", () => {
    const ctx = contextWith({
      warHistoryId: "seed-war",
      createdWarHistoryId: "manual-war",
      createdConcludedWarHistoryId: "concluded-war",
      adminCreatedUserId: "user-1",
    });

    const resolved = resolveEndpointPath(
      { label: "Stats", method: "PATCH", path: "/api/guild-war/history/:id/member-stats/:userId" },
      ctx,
    );
    const prepared = prepareEndpointRequest(
      { label: "Batch Stats", method: "PATCH", path: "/api/guild-war/history/:id/member-stats/batch" },
      ctx,
    );

    expect(resolved.path).toBe("/api/guild-war/history/concluded-war/member-stats/user-1");
    expect(parseJsonBody(prepared)).toEqual({ updates: [{ user_id: "user-1", stats: { stats: { kills: 2 } } }] });
    expect(prepared.skipReason).toBeUndefined();
  });

  it("uses the created war history for stats and history detail requests", () => {
    const ctx = contextWith({ warHistoryId: "seed-war", createdWarHistoryId: "created-war", warMemberUserId: "user-1" });

    expect(resolveEndpointPath(
      { label: "Stats", method: "PATCH", path: "/api/guild-war/history/:id/member-stats/:userId" },
      ctx,
    ).path).toBe("/api/guild-war/history/created-war/member-stats/user-1");
    expect(prepareEndpointRequest(
      { label: "Batch History", method: "POST", path: "/api/guild-war/history/batch" },
      ctx,
    ).body).toBe(JSON.stringify({ ids: ["created-war"] }));
  });

  it("resolves uploaded media keys for image retrieval endpoints", () => {
    expect(resolveEndpointPath(
      { label: "Event Image", method: "GET", path: "/api/events/image" },
      contextWith({ eventImageKey: "events/event-1/images/key" }),
    ).path).toBe("/api/events/image?key=events%2Fevent-1%2Fimages%2Fkey");

    expect(resolveEndpointPath(
      { label: "Announcement Image", method: "GET", path: "/api/announcements/image" },
      contextWith({ announcementImageKey: "announcement/ann-1/images/key" }),
    ).path).toBe("/api/announcements/image?key=announcement%2Fann-1%2Fimages%2Fkey");

    expect(resolveEndpointPath(
      { label: "Gallery Image", method: "GET", path: "/api/gallery/image" },
      contextWith({ galleryImageKey: "gallery/images/user-1/key" }),
    ).path).toBe("/api/gallery/image?key=gallery%2Fimages%2Fuser-1%2Fkey");

    expect(resolveEndpointPath(
      { label: "Wiki Image", method: "GET", path: "/api/wiki/image" },
      contextWith({ wikiImageKey: "wiki/article-1/images/key" }),
    ).path).toBe("/api/wiki/image?key=wiki%2Farticle-1%2Fimages%2Fkey");
  });

  it("captures admin-created username and uploaded image keys from responses", () => {
    const adminCtx = captureContextFromResponse(
      createInitialTestRunContext(),
      { label: "Create User", method: "POST", path: "/api/admin/users" },
      {
        status: 201,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-05-18T00:00:00.000Z",
        parsedJson: { user_id: "user-1", username: "systemtest_admin_1", temporary_password: "TempPass123!" },
      },
    );

    expect(adminCtx.adminCreatedUsername).toBe("systemtest_admin_1");

    const imageCtx = captureContextFromResponse(
      adminCtx,
      { label: "Upload Gallery Image", method: "POST", path: "/api/gallery/images" },
      {
        status: 201,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-05-18T00:00:00.000Z",
        parsedJson: { data: [{ id: "gallery-1", url: "gallery/images/user-1/key" }] },
      },
    );

    expect(imageCtx.galleryImageKey).toBe("gallery/images/user-1/key");
  });

  it("captures an invite code from the cursor response envelope", () => {
    const next = captureContextFromResponse(
      createInitialTestRunContext(),
      { label: "Invites", method: "GET", path: "/api/admin/invite-links" },
      {
        status: 200,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-07-28T00:00:00.000Z",
        parsedJson: {
          data: [{ id: "invite-1", code: "CURSOR-INVITE-CODE" }],
          next_cursor: null,
          total: 1,
        },
      },
    );

    expect(next.registerInviteCode).toBe("CURSOR-INVITE-CODE");
  });

  it("does not capture seeded mock image paths as profile media keys", () => {
    const next = captureContextFromResponse(
      createInitialTestRunContext(),
      { label: "Users", method: "GET", path: "/api/users?page=1&limit=5" },
      {
        status: 200,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-05-18T00:00:00.000Z",
        parsedJson: {
          data: [
            {
              user: { id: "user-1" },
              profile: { images: ["/mock/portrait-1.svg"] },
            },
          ],
        },
      },
    );

    expect(next.userImageKey).toBeNull();
  });

  it("uses the registered disposable user as a fallback target", () => {
    const next = captureContextFromResponse(
      contextWith({ meId: "admin-1" }),
      { label: "Register", method: "POST", path: "/api/auth/register/:inviteCode" },
      {
        status: 201,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-05-18T00:00:00.000Z",
        parsedJson: { user: { id: "registered-1", username: "systemtest_1" } },
      },
    );

    expect(next.registeredUserId).toBe("registered-1");
  });

  it("keeps manually created history available after concluded history batch-delete", () => {
    const next = captureContextFromResponse(
      contextWith({
        warHistoryId: "concluded-war",
        createdWarHistoryId: "manual-war",
        createdConcludedWarHistoryId: "concluded-war",
      }),
      { label: "Batch Delete History", method: "POST", path: "/api/guild-war/history/batch-delete" },
      {
        status: 200,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-05-18T00:00:00.000Z",
        parsedJson: { ok: true, deleted: 1 },
      },
    );

    expect(next.createdConcludedWarHistoryId).toBeNull();
    expect(next.createdWarHistoryId).toBe("manual-war");
    expect(next.warHistoryId).toBe("manual-war");
  });

  it("prefers test-created events for detail and batch smoke requests", () => {
    const ctx = contextWith({ eventId: "seed-event", createdEventId: "created-event" });

    expect(resolveEndpointPath(
      { label: "Get Event", method: "GET", path: "/api/events/:id" },
      ctx,
    ).path).toBe("/api/events/created-event");

    const prepared = prepareEndpointRequest(
      { label: "Batch Event Details", method: "POST", path: "/api/events/batch-details" },
      ctx,
    );

    expect(parseJsonBody(prepared)).toEqual({ ids: ["created-event"] });
  });

  it("covers disposable poll and raffle event actions with runnable payloads", () => {
    const endpointKeys = buildApiCategories((key) => key)
      .find((category) => category.key === "events")
      ?.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`) ?? [];

    expect(endpointKeys).toContain("POST /api/events?fixture=poll");
    expect(endpointKeys).toContain("GET /api/events/:id?fixture=poll");
    expect(endpointKeys).toContain("POST /api/events/:id/poll/vote");
    expect(endpointKeys).toContain("POST /api/events?fixture=raffle");
    expect(endpointKeys).toContain("POST /api/events/:id/participants?fixture=raffle");
    expect(endpointKeys).toContain("POST /api/events/:id/raffle/draw");

    const pollCreate = prepareEndpointRequest(
      { label: "Create Poll", method: "POST", path: "/api/events?fixture=poll" },
      createInitialTestRunContext(),
    );
    expect(parseJsonBody(pollCreate)).toMatchObject({
      type: "poll",
      poll: { options: ["[systemtest] Option A", "[systemtest] Option B"] },
    });

    const pollCtx = contextWith({ createdPollEventId: "poll-1", pollOptionId: "option-1" });
    expect(resolveEndpointPath(
      { label: "Poll Detail", method: "GET", path: "/api/events/:id?fixture=poll" },
      pollCtx,
    ).path).toBe("/api/events/poll-1");
    expect(parseJsonBody(prepareEndpointRequest(
      { label: "Poll Vote", method: "POST", path: "/api/events/:id/poll/vote" },
      pollCtx,
    ))).toEqual({ option_ids: ["option-1"] });

    const raffleCreate = prepareEndpointRequest(
      { label: "Create Raffle", method: "POST", path: "/api/events?fixture=raffle" },
      createInitialTestRunContext(),
    );
    expect(parseJsonBody(raffleCreate)).toMatchObject({ type: "raffle", winner_count: 1 });

    const raffleCtx = contextWith({ createdRaffleEventId: "raffle-1", adminCreatedUserId: "user-1" });
      expect(resolveEndpointPath(
        { label: "Raffle Participant", method: "POST", path: "/api/events/:id/participants?fixture=raffle" },
        raffleCtx,
    ).path).toBe("/api/events/raffle-1/participants");
    expect(parseJsonBody(prepareEndpointRequest(
      { label: "Raffle Participant", method: "POST", path: "/api/events/:id/participants?fixture=raffle" },
      raffleCtx,
    ))).toEqual({ user_ids: ["user-1"] });
    expect(resolveEndpointPath(
      { label: "Raffle Draw", method: "POST", path: "/api/events/:id/raffle/draw" },
      raffleCtx,
    ).path).toBe("/api/events/raffle-1/raffle/draw");
  });

  it("captures poll option ids and raffle fixture ids from disposable event responses", () => {
    const pollCreated = captureContextFromResponse(
      createInitialTestRunContext(),
      { label: "Create Poll", method: "POST", path: "/api/events?fixture=poll" },
      {
        status: 201,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-05-18T00:00:00.000Z",
        parsedJson: { id: "poll-1", type: "poll" },
      },
    );
    const pollDetailed = captureContextFromResponse(
      pollCreated,
      { label: "Poll Detail", method: "GET", path: "/api/events/:id?fixture=poll" },
      {
        status: 200,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-05-18T00:00:00.000Z",
        parsedJson: { id: "poll-1", poll: { options: [{ id: "option-1" }] } },
      },
    );
    const raffleCreated = captureContextFromResponse(
      pollDetailed,
      { label: "Create Raffle", method: "POST", path: "/api/events?fixture=raffle" },
      {
        status: 201,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-05-18T00:00:00.000Z",
        parsedJson: { id: "raffle-1", type: "raffle" },
      },
    );

    expect(raffleCreated.createdPollEventId).toBe("poll-1");
    expect(raffleCreated.pollOptionId).toBe("option-1");
    expect(raffleCreated.createdRaffleEventId).toBe("raffle-1");
  });

  it("never targets the active admin account for profile or media mutation smoke tests", () => {
    const protectedUserEndpoints = [
      { label: "Update Profile", method: "PATCH" as const, path: "/api/users/:id/profile" },
      { label: "Upload Image", method: "POST" as const, path: "/api/users/:id/media/images" },
      { label: "Delete Image", method: "DELETE" as const, path: "/api/users/:id/media/images" },
      { label: "Upload Avatar", method: "POST" as const, path: "/api/users/:id/media/avatar" },
      { label: "Delete Avatar", method: "DELETE" as const, path: "/api/users/:id/media/avatar" },
      { label: "Upload Audio", method: "POST" as const, path: "/api/users/:id/media/audio" },
      { label: "Delete Audio", method: "DELETE" as const, path: "/api/users/:id/media/audio" },
    ];

    for (const endpoint of protectedUserEndpoints) {
      const prepared = prepareEndpointRequest(endpoint, contextWith({
        meId: "real-admin",
        uploadedImageKey: "members/real-admin/images/systemtest.png",
      }));

      expect(prepared.path).toBe(endpoint.path);
      expect(prepared.skipReason).toContain("test member");
    }

    for (const endpoint of protectedUserEndpoints) {
      const prepared = prepareEndpointRequest(endpoint, contextWith({
        meId: "real-admin",
        adminCreatedUserId: "disposable-member",
        uploadedImageKey: "members/disposable-member/images/systemtest.png",
      }));

      expect(prepared.path).toContain("/api/users/disposable-member/");
      expect(prepared.path).not.toContain("real-admin");
      expect(prepared.path).not.toContain("seeded-member");
      expect(prepared.skipReason).toBeUndefined();
    }
  });

  it("does not resolve user-id routes to the active admin account", () => {
    const detail = prepareEndpointRequest(
      { label: "Get User", method: "GET", path: "/api/users/:id" },
      contextWith({ meId: "real-admin" }),
    );
    const safeDetail = prepareEndpointRequest(
      { label: "Get User", method: "GET", path: "/api/users/:id" },
      contextWith({ meId: "real-admin", adminCreatedUserId: "disposable-member" }),
    );
    expect(detail.path).toBe("/api/users/:id");
    expect(detail.skipReason).toContain("test member");
    expect(safeDetail.path).toBe("/api/users/disposable-member");
  });

  it("cleans up profile media against disposable members only", () => {
    expect(buildCleanupSteps(contextWith({
      meId: "real-admin",
      targetProfileSnapshot: { bio: "admin bio", classes: ["admin-class"] },
      uploadedImageKey: "members/real-admin/images/systemtest.png",
    }))).toEqual([]);

    const steps = buildCleanupSteps(contextWith({
      meId: "real-admin",
      registeredUserId: "disposable-member",
      targetProfileSnapshot: { bio: "test bio", classes: ["test-class"] },
      uploadedImageKey: "members/disposable-member/images/systemtest.png",
    }));

    expect(steps).toContainEqual({
      label: "Cleanup: Restore Profile",
      method: "PATCH",
      path: "/api/users/disposable-member/profile",
      jsonBody: { bio: "test bio", classes: ["test-class"] },
      clearContext: { targetProfileSnapshot: null },
    });
    expect(steps).toContainEqual({
      label: "Cleanup: Test Image",
      method: "DELETE",
      path: "/api/users/disposable-member/media/images",
      jsonBody: { keys: ["members/disposable-member/images/systemtest.png"] },
      clearContext: { uploadedImageKey: null },
    });
    expect(steps.map((step) => step.path)).not.toContain("/api/users/real-admin/profile");
    expect(steps.map((step) => step.path)).not.toContain("/api/users/real-admin/media/images");
  });

  it("uses disposable members for participant, guild-war, and badge mutation payloads", () => {
    const unsafeContext = contextWith({
      meId: "real-admin",
      createdEventId: "event-1",
      createdGuildWarEventId: "war-event-1",
      createdConcludedWarHistoryId: "war-history-1",
      createdBadgeId: "badge-1",
    });

    const mutationEndpoints = [
      { label: "Add Participant", method: "POST" as const, path: "/api/events/:id/participants" },
      { label: "Remove Participant", method: "DELETE" as const, path: "/api/events/:id/participants" },
      { label: "Join Event", method: "POST" as const, path: "/api/events/:id/join" },
      { label: "Leave Event", method: "DELETE" as const, path: "/api/events/:id/leave" },
      { label: "Save Teams", method: "POST" as const, path: "/api/guild-war/save-teams" },
      { label: "Move Member", method: "POST" as const, path: "/api/guild-war/move" },
      { label: "Conclude", method: "POST" as const, path: "/api/guild-war/conclude" },
      { label: "Role Tag", method: "PATCH" as const, path: "/api/guild-war/role-tag" },
      { label: "Member Stats", method: "PATCH" as const, path: "/api/guild-war/history/:id/member-stats/:userId" },
      { label: "Batch Member Stats", method: "PATCH" as const, path: "/api/guild-war/history/:id/member-stats/batch" },
      { label: "Assign Badge", method: "POST" as const, path: "/api/badges/:id/assign" },
      { label: "Unassign Badge", method: "POST" as const, path: "/api/badges/:id/unassign" },
    ];

    for (const endpoint of mutationEndpoints) {
      const prepared = prepareEndpointRequest(endpoint, unsafeContext);

      if (endpoint.path.includes("/join") || endpoint.path.includes("/leave")) {
        expect(prepared.skipReason).toBeUndefined();
      } else {
        expect(prepared.skipReason).toContain("test member");
        expect(prepared.body).toBeUndefined();
      }
    }

    const safeContext = contextWith({
      ...unsafeContext,
      adminCreatedUserId: "disposable-member",
    });

    for (const endpoint of mutationEndpoints) {
      const prepared = prepareEndpointRequest(endpoint, safeContext);

      expect(prepared.path).not.toContain("real-admin");
      expect(prepared.path).not.toContain("seeded-member");
      if (prepared.body) {
        expect(prepared.body).not.toContain("real-admin");
        expect(prepared.body).not.toContain("seeded-member");
      }
      if (endpoint.path.includes("/join") || endpoint.path.includes("/leave")) {
        expect(prepared.skipReason).toBeUndefined();
        expect(prepared.body).toBeUndefined();
      } else if (endpoint.path.includes(":userId")) {
        expect(prepared.skipReason).toBeUndefined();
        expect(prepared.path).toContain("disposable-member");
      } else {
        expect(prepared.skipReason).toBeUndefined();
        expect(prepared.body).toContain("disposable-member");
      }
    }
  });

  it("keeps guild-war captured member context on the disposable member", () => {
    const next = captureContextFromResponse(
      contextWith({
        meId: "real-admin",
        adminCreatedUserId: "disposable-member",
      }),
      { label: "Save Teams", method: "POST", path: "/api/guild-war/save-teams" },
      {
        status: 200,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-05-18T00:00:00.000Z",
        parsedJson: { ok: true },
      },
    );

    expect(next.warMemberUserId).toBe("disposable-member");
  });

  it("never captures a live guild-war board member as a mutation target", () => {
    const next = captureContextFromResponse(
      contextWith({
        meId: "real-admin",
        adminCreatedUserId: "disposable-member",
      }),
      { label: "Active War", method: "GET", path: "/api/guild-war/active" },
      {
        status: 200,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-05-18T00:00:00.000Z",
        parsedJson: {
          event: { id: "real-war-event" },
          teams: [{ id: "real-team", members: [{ user_id: "real-guild-member" }] }],
        },
      },
    );

    // move / role-tag / conclude all target warMemberUserId.
    expect(next.warMemberUserId).toBe("disposable-member");
    expect(next.warMemberUserId).not.toBe("real-guild-member");
  });

  it("leaves guild-war mutations unrunnable when no disposable member exists yet", () => {
    const next = captureContextFromResponse(
      contextWith({ meId: "real-admin" }),
      { label: "Active War", method: "GET", path: "/api/guild-war/active" },
      {
        status: 200,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-05-18T00:00:00.000Z",
        parsedJson: {
          event: { id: "real-war-event" },
          teams: [{ id: "real-team", members: [{ user_id: "real-guild-member" }] }],
        },
      },
    );

    // Null is the safe outcome: the guild-war builders skip instead of
    // falling back to whoever happens to be on the live board.
    expect(next.warMemberUserId).toBeNull();

    const prepared = prepareEndpointRequest(
      { label: "Role Tag", method: "PATCH", path: "/api/guild-war/role-tag" },
      next,
    );
    expect(prepared.skipReason).toBeTruthy();
  });

  it("covers every actionable worker route in the smoke registry", () => {
    const endpointKeys = new Set(buildApiCategories((key) => key)
      .flatMap((category) => category.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)));
    const expectedRoutes = [
      "GET /api/health",
      "GET /api/site-config",
      "POST /api/auth/login",
      "GET /api/auth/check-username?username=test",
      "GET /api/auth/verify-invite/:code",
      "POST /api/auth/register/:inviteCode",
      "GET /api/auth/me",
      "GET /api/dashboard/members",
      "GET /api/dashboard/events",
      "GET /api/dashboard/wars",
      "GET /api/search?q=systemtest&limit=5",
      "GET /api/users?page=1&limit=5",
      "GET /api/users/stats",
      "GET /api/users/:id",
      "PATCH /api/users/:id/profile",
      "POST /api/users/:id/media/images",
      "GET /api/users/image",
      "DELETE /api/users/:id/media/images",
      "POST /api/users/:id/media/avatar",
      "DELETE /api/users/:id/media/avatar",
      "POST /api/users/:id/media/audio",
      "DELETE /api/users/:id/media/audio",
      "GET /api/events?page=1&limit=5",
      "POST /api/events",
      "POST /api/events?fixture=poll",
      "GET /api/events/:id?fixture=poll",
      "POST /api/events?fixture=raffle",
      "GET /api/events/:id",
      "PATCH /api/events/:id",
      "POST /api/events/batch-details",
      "POST /api/events/:id/images",
      "GET /api/events/image",
      "POST /api/events/:id/join",
      "POST /api/events/:id/poll/vote",
      "POST /api/events/:id/raffle/draw",
      "POST /api/events/:id/participants",
      "POST /api/events/:id/participants?fixture=raffle",
      "DELETE /api/events/:id/participants",
      "DELETE /api/events/:id/leave",
      "DELETE /api/events/:id",
      "DELETE /api/events/:id/destroy",
      "GET /api/events/templates/list",
      "POST /api/events/templates",
      "PATCH /api/events/templates/:id",
      "POST /api/events/templates/:id/pause",
      "POST /api/events/templates/:id/resume",
      "DELETE /api/events/templates/:id",
      "GET /api/announcements?page=1&limit=5",
      "GET /api/announcements/:id",
      "POST /api/announcements/images/stage",
      "POST /api/announcements",
      "PATCH /api/announcements/:id",
      "DELETE /api/announcements/:id",
      "DELETE /api/announcements/:id/permanent",
      "POST /api/announcements/:id/images",
      "GET /api/announcements/image",
      "GET /api/gallery?limit=5",
      "POST /api/gallery/images",
      "POST /api/gallery/videos",
      "GET /api/gallery/image",
      "DELETE /api/gallery/:id",
      "POST /api/gallery/batch-delete",
      "GET /api/guild-war/active",
      "GET /api/guild-war/concluded-event-ids",
      "POST /api/events?fixture=guild-war",
      "POST /api/guild-war/save-teams",
      "POST /api/guild-war/move",
      "PATCH /api/guild-war/role-tag",
      "POST /api/guild-war/conclude",
      "GET /api/guild-war/export?format=json",
      "GET /api/guild-war/history?page=1&limit=5",
      "POST /api/guild-war/history/batch",
      "GET /api/guild-war/history/:id",
      "POST /api/guild-war/history",
      "PATCH /api/guild-war/history/:id",
      "DELETE /api/guild-war/history/:id",
      "POST /api/guild-war/history/batch-delete",
      "PATCH /api/guild-war/history/:id/member-stats/batch",
      "PATCH /api/guild-war/history/:id/member-stats/:userId",
      "GET /api/guild-war/analytics",
      "GET /api/wiki/categories",
      "POST /api/wiki/categories",
      "PATCH /api/wiki/categories/:id",
      "DELETE /api/wiki/categories/:id",
      "GET /api/wiki/articles?page=1&limit=5",
      "GET /api/wiki/articles/:slug",
      "POST /api/wiki/articles",
      "PATCH /api/wiki/articles/:id",
      "DELETE /api/wiki/articles/:id",
      "DELETE /api/wiki/articles/:id/permanent",
      "POST /api/wiki/articles/:id/images",
      "GET /api/wiki/image",
      "GET /api/badges",
      "GET /api/badges/:id",
      "POST /api/badges",
      "PATCH /api/badges/:id",
      "DELETE /api/badges/:id",
      "GET /api/badges/:id/assignments",
      "POST /api/badges/:id/assign",
      "POST /api/badges/:id/unassign",
      "GET /api/admin/invite-links",
      "GET /api/admin/invite-links/stats",
      "POST /api/admin/invite-links",
      "DELETE /api/admin/invite-links/:id",
      "DELETE /api/admin/invite-links/:id/permanent",
      "PATCH /api/admin/users/batch/role",
      "PATCH /api/admin/users/batch/deactivate",
      "PATCH /api/admin/users/batch/reactivate",
      "PATCH /api/admin/users/batch/delete",
      "POST /api/admin/users",
      "PATCH /api/admin/users/:id/role",
      "PATCH /api/admin/users/:id/deactivate",
      "PATCH /api/admin/users/:id/reactivate",
      "POST /api/admin/users/:id/reset-password",
      "POST /api/admin/users/:id/reset-login-lock",
      "GET /api/admin/roles",
      "POST /api/admin/roles",
      "PATCH /api/admin/roles/:id",
      "DELETE /api/admin/roles/:id",
      "GET /api/admin/status",
      "GET /api/admin/analytics-settings",
      "PATCH /api/admin/analytics-settings",
      "GET /api/admin/audit-archive/months",
      "GET /api/admin/audit-log?page=1&limit=5",
      "GET /api/admin/audit-log/export?format=json",
      "GET /api/admin/error-log?page=1&limit=5",
      "GET /api/storage",
      "POST /api/storage/storages",
      "PATCH /api/storage/storages/:id",
      "POST /api/storage/storages/:storageId/categories",
      "PATCH /api/storage/storages/:storageId/categories/:id",
      "POST /api/storage/items",
      "PATCH /api/storage/items/:id",
      "POST /api/storage/items/:id/images",
      "GET /api/storage/image",
      "DELETE /api/storage/items/:id/images/:imageId",
      "POST /api/storage/items/:id/transactions?fixture=intake",
      "POST /api/storage/items/:id/transactions?fixture=distribute",
      "POST /api/storage/items/:id/transactions?fixture=adjust",
      "GET /api/storage/items",
      "GET /api/storage/items/:id",
      "GET /api/storage/transactions?page=1&limit=5",
      "DELETE /api/storage/items/:id",
      "DELETE /api/storage/storages/:storageId/categories/:id",
      "DELETE /api/storage/storages/:id",
      "GET /api/game-data",
      "GET /api/game-data/rotations/:classId",
      "GET /api/game-data/full",
      "GET /api/game-data/versions",
    ];

    expect(expectedRoutes.filter((route) => !endpointKeys.has(route))).toEqual([]);
  });

  it("orders user image retrieval after test upload", () => {
    const categories = buildApiCategories((key) => key);
    const userEndpointKeys = categories.find((category) => category.key === "users")
      ?.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`) ?? [];

    expect(userEndpointKeys.indexOf("POST /api/users/:id/media/images")).toBeLessThan(userEndpointKeys.indexOf("GET /api/users/image"));
    expect(userEndpointKeys.indexOf("GET /api/users/image")).toBeLessThan(userEndpointKeys.indexOf("DELETE /api/users/:id/media/images"));
  });

  it("creates a disposable invite before registration so seeded invite counters are not mutated", () => {
    const authEndpointKeys = buildApiCategories((key) => key)
      .find((category) => category.key === "auth")
      ?.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`) ?? [];
    const createInviteIndex = authEndpointKeys.indexOf("POST /api/admin/invite-links");

    expect(createInviteIndex).toBeGreaterThanOrEqual(0);
    expect(createInviteIndex).toBeLessThan(authEndpointKeys.indexOf("GET /api/auth/verify-invite/:code"));
    expect(createInviteIndex).toBeLessThan(authEndpointKeys.indexOf("POST /api/auth/register/:inviteCode"));
  });

  it("filters badge smoke tests when the current user lacks badge management permission", () => {
    const categories = buildApiCategories((key) => key);

    const filtered = filterApiCategoriesForPermissions(categories, { "admin.badges.manage": false });

    expect(filtered.some((category) => category.key === "badges")).toBe(false);
  });

  it("filters production smoke endpoints by exact permissions", () => {
    const categories = buildApiCategories((key) => key);

    const filtered = filterApiCategoriesForPermissions(categories, {
      "admin.status.view": true,
    });

    const endpointKeys = filtered.flatMap((category) => category.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`));
    expect(endpointKeys).toContain("GET /api/health");
    expect(endpointKeys).toContain("GET /api/site-config");
    expect(endpointKeys).toContain("GET /api/admin/status");
    expect(endpointKeys).toContain("GET /api/auth/check-username?username=test");
    expect(endpointKeys).not.toContain("POST /api/admin/invite-links");
    expect(endpointKeys).not.toContain("GET /api/auth/verify-invite/:code");
    expect(endpointKeys).not.toContain("POST /api/auth/register/:inviteCode");
    expect(endpointKeys).not.toContain("POST /api/auth/login");
    expect(endpointKeys).not.toContain("PATCH /api/admin/analytics-settings");
    expect(endpointKeys).not.toContain("POST /api/events");
    expect(endpointKeys).not.toContain("GET /api/events/templates/list");
    expect(endpointKeys).not.toContain("GET /api/guild-war/export?format=json");
  });

  it("exposes every storage smoke endpoint when the current user has storage management permission", () => {
    const categories = buildApiCategories((key) => key);
    const storageEndpoints = categories.find((category) => category.key === "storage")?.endpoints ?? [];

    const filtered = filterApiCategoriesForPermissions(categories, {
      "admin.storage.manage": true,
    });
    const visibleStorageEndpoints = filtered.find((category) => category.key === "storage")?.endpoints ?? [];
    const visibleEndpointKeys = visibleStorageEndpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`);

    expect(storageEndpoints).toHaveLength(20);
    expect(visibleStorageEndpoints).toHaveLength(storageEndpoints.length);
    expect(visibleEndpointKeys).toEqual(storageEndpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`));
    expect(visibleEndpointKeys).toEqual(expect.arrayContaining([
      "POST /api/storage/storages",
      "PATCH /api/storage/storages/:id",
      "POST /api/storage/storages/:storageId/categories",
      "PATCH /api/storage/storages/:storageId/categories/:id",
      "POST /api/storage/items",
      "PATCH /api/storage/items/:id",
      "POST /api/storage/items/:id/images",
      "DELETE /api/storage/items/:id/images/:imageId",
      "POST /api/storage/items/:id/transactions?fixture=intake",
      "POST /api/storage/items/:id/transactions?fixture=distribute",
      "POST /api/storage/items/:id/transactions?fixture=adjust",
      "POST /api/storage/transactions/batch",
      "DELETE /api/storage/items/:id",
      "DELETE /api/storage/storages/:storageId/categories/:id",
      "DELETE /api/storage/storages/:id",
    ]));
  });

  it("only exposes lifecycle mutation smoke tests when cleanup permissions are also available", () => {
    const categories = buildApiCategories((key) => key);

    const filtered = filterApiCategoriesForPermissions(categories, {
      "events.create": true,
      "events.edit": true,
      "announcements.create": true,
      "announcements.edit": true,
      "wiki.articles.create": true,
      "wiki.articles.edit": true,
      "admin.users.edit": true,
      "admin.invite.manage": true,
      "gallery.upload": true,
      "guildwar.teams.edit": true,
    });

    const endpointKeys = filtered.flatMap((category) => category.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`));
    expect(endpointKeys).not.toContain("POST /api/events");
    expect(endpointKeys).not.toContain("PATCH /api/events/:id");
    expect(endpointKeys).not.toContain("POST /api/announcements");
    expect(endpointKeys).not.toContain("PATCH /api/announcements/:id");
    expect(endpointKeys).not.toContain("POST /api/wiki/articles");
    expect(endpointKeys).not.toContain("PATCH /api/wiki/articles/:id");
    expect(endpointKeys).not.toContain("POST /api/admin/users");
    expect(endpointKeys).not.toContain("POST /api/auth/register/:inviteCode");
    expect(endpointKeys).not.toContain("POST /api/guild-war/save-teams");
  });

  it("exposes production mutation smoke tests when full fixture lifecycle permissions are available", () => {
    const categories = buildApiCategories((key) => key);

    const filtered = filterApiCategoriesForPermissions(categories, {
      "events.create": true,
      "events.edit": true,
      "events.archive": true,
      "events.delete": true,
      "announcements.create": true,
      "announcements.edit": true,
      "announcements.delete": true,
      "wiki.categories.manage": true,
      "wiki.articles.create": true,
      "wiki.articles.edit": true,
      "wiki.articles.delete": true,
      "admin.users.edit": true,
      "admin.users.delete": true,
      "admin.invite.manage": true,
      "gallery.upload": true,
      "gallery.delete": true,
      "guildwar.teams.edit": true,
      "guildwar.history.edit": true,
    });

    const endpointKeys = filtered.flatMap((category) => category.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`));
    expect(endpointKeys).toContain("POST /api/events");
    expect(endpointKeys).toContain("PATCH /api/events/:id");
    expect(endpointKeys).toContain("POST /api/announcements");
    expect(endpointKeys).toContain("PATCH /api/announcements/:id");
    expect(endpointKeys).toContain("POST /api/wiki/articles");
    expect(endpointKeys).toContain("PATCH /api/wiki/articles/:id");
    expect(endpointKeys).toContain("POST /api/admin/users");
    expect(endpointKeys).toContain("POST /api/auth/register/:inviteCode");
    expect(endpointKeys).toContain("POST /api/guild-war/save-teams");
  });

  it("prepares storage lifecycle requests only against disposable storage fixtures", () => {
    const createStorage = prepareEndpointRequest(
      { label: "Create Storage", method: "POST", path: "/api/storage/storages" },
      createInitialTestRunContext(),
    );
    const createStorageBody = parseJsonBody(createStorage) as Record<string, unknown>;
    expect(createStorageBody.name).toContain("[systemtest]");

    const ctx = contextWith({
      storageId: "seed-storage",
      storageCategoryId: "seed-category",
      storageItemId: "seed-item",
      createdStorageId: "storage-1",
      createdStorageCategoryId: "category-1",
      createdStorageItemId: "item-1",
      createdStorageImageId: "image-1",
      storageImageKey: "storage/items/item-1/image-1",
      adminCreatedUserId: "member-1",
    } as Partial<TestRunContext>);

    expect(resolveEndpointPath(
      { label: "Update Storage", method: "PATCH", path: "/api/storage/storages/:id" },
      ctx,
    ).path).toBe("/api/storage/storages/storage-1");
    expect(resolveEndpointPath(
      { label: "Delete Storage", method: "DELETE", path: "/api/storage/storages/:id" },
      ctx,
    ).path).toBe("/api/storage/storages/storage-1");
    expect(resolveEndpointPath(
      { label: "Update Category", method: "PATCH", path: "/api/storage/storages/:storageId/categories/:id" },
      ctx,
    ).path).toBe("/api/storage/storages/storage-1/categories/category-1");
    expect(resolveEndpointPath(
      { label: "Delete Category", method: "DELETE", path: "/api/storage/storages/:storageId/categories/:id" },
      ctx,
    ).path).toBe("/api/storage/storages/storage-1/categories/category-1");
    expect(resolveEndpointPath(
      { label: "Update Item", method: "PATCH", path: "/api/storage/items/:id" },
      ctx,
    ).path).toBe("/api/storage/items/item-1");
    expect(resolveEndpointPath(
      { label: "Delete Item", method: "DELETE", path: "/api/storage/items/:id" },
      ctx,
    ).path).toBe("/api/storage/items/item-1");
    expect(resolveEndpointPath(
      { label: "Storage Image", method: "GET", path: "/api/storage/image" },
      ctx,
    ).path).toBe("/api/storage/image?key=storage%2Fitems%2Fitem-1%2Fimage-1");
    expect(resolveEndpointPath(
      { label: "Delete Storage Image", method: "DELETE", path: "/api/storage/items/:id/images/:imageId" },
      ctx,
    ).path).toBe("/api/storage/items/item-1/images/image-1");
    expect(prepareEndpointRequest(
      { label: "Upload Storage Image", method: "POST", path: "/api/storage/items/:id/images" },
      ctx,
    ).body).toBeInstanceOf(FormData);
    const intake = prepareEndpointRequest(
      { label: "Storage Intake", method: "POST", path: "/api/storage/items/:id/transactions?fixture=intake" },
      ctx,
    );
    const distribute = prepareEndpointRequest(
      { label: "Storage Distribute", method: "POST", path: "/api/storage/items/:id/transactions?fixture=distribute" },
      ctx,
    );
    const adjust = prepareEndpointRequest(
      { label: "Storage Adjust", method: "POST", path: "/api/storage/items/:id/transactions?fixture=adjust" },
      ctx,
    );
    expect(intake.path).toBe("/api/storage/items/item-1/transactions");
    expect(distribute.path).toBe("/api/storage/items/item-1/transactions");
    expect(adjust.path).toBe("/api/storage/items/item-1/transactions");
    expect(parseJsonBody(intake)).toMatchObject({ type: "intake", quantity: 3 });
    expect(parseJsonBody(distribute)).toMatchObject({ type: "distribute", quantity: 1, recipient_user_id: "member-1" });
    expect(parseJsonBody(adjust)).toMatchObject({ type: "adjust", target_quantity: 6 });
    expect(JSON.stringify([intake, distribute, adjust])).not.toContain("seed-item");
  });

  it("captures storage fixture ids from storage responses", () => {
    const storageCtx = captureContextFromResponse(
      createInitialTestRunContext(),
      { label: "Create Storage", method: "POST", path: "/api/storage/storages" },
      {
        status: 201,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-06-11T00:00:00.000Z",
        parsedJson: { id: "storage-1", name: "[systemtest] Storage" },
      },
    );
    const categoryCtx = captureContextFromResponse(
      storageCtx,
      { label: "Create Storage Category", method: "POST", path: "/api/storage/storages/:storageId/categories" },
      {
        status: 201,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-06-11T00:00:00.000Z",
        parsedJson: { id: "category-1", name: "[systemtest] Category" },
      },
    );
    const itemCtx = captureContextFromResponse(
      categoryCtx,
      { label: "Create Storage Item", method: "POST", path: "/api/storage/items" },
      {
        status: 201,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-06-11T00:00:00.000Z",
        parsedJson: { id: "item-1", name: "[systemtest] Item" },
      },
    );
    const imageCtx = captureContextFromResponse(
      itemCtx,
      { label: "Upload Storage Image", method: "POST", path: "/api/storage/items/:id/images" },
      {
        status: 201,
        latencyMs: 1,
        body: "{}",
        error: null,
        ranAt: "2026-06-11T00:00:00.000Z",
        parsedJson: [{ id: "image-1", r2_key: "storage/items/item-1/image-1" }],
      },
    );

    expect(imageCtx.createdStorageId).toBe("storage-1");
    expect(imageCtx.createdStorageCategoryId).toBe("category-1");
    expect(imageCtx.createdStorageItemId).toBe("item-1");
    expect(imageCtx.createdStorageImageId).toBe("image-1");
    expect(imageCtx.storageImageKey).toBe("storage/items/item-1/image-1");
  });

  it("runs admin batch delete against the admin-created test user", () => {
    const prepared = prepareEndpointRequest(
      { label: "Batch Delete", method: "PATCH", path: "/api/admin/users/batch/delete" },
      contextWith({ adminCreatedUserId: "created-user" }),
    );

    expect(parseJsonBody(prepared)).toEqual({ user_ids: ["created-user"] });
  });

  it("permanently deletes created invite links during cleanup", () => {
    const steps = buildCleanupSteps(contextWith({ createdInviteLinkId: "invite-1" }));

    expect(steps).toContainEqual({
      label: "Cleanup: Invite Link",
      method: "DELETE",
      path: "/api/admin/invite-links/invite-1/permanent",
      clearContext: { createdInviteLinkId: null },
    });
  });

  it("resolves invite cleanup against the created invite instead of a seeded invite", () => {
    const resolved = resolveEndpointPath(
      { label: "Delete Invite", method: "DELETE", path: "/api/admin/invite-links/:id/permanent" },
      contextWith({ inviteLinkId: "seed-invite", createdInviteLinkId: "created-invite" }),
    );

    expect(resolved.path).toBe("/api/admin/invite-links/created-invite/permanent");
  });

  it("does not expose removed gallery like or comment smoke endpoints", () => {
    const endpointKeys = buildApiCategories((key) => key)
      .find((category) => category.key === "gallery")
      ?.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`) ?? [];

    expect(endpointKeys).not.toContain("POST /api/gallery/:id/like");
    expect(endpointKeys).not.toContain("GET /api/gallery/:id/comments");
    expect(endpointKeys).not.toContain("POST /api/gallery/:id/comments");
    expect(endpointKeys).not.toContain("PATCH /api/gallery/:id/comments/:commentId");
    expect(endpointKeys).not.toContain("DELETE /api/gallery/:id/comments/:commentId");
  });

  it("covers website read actions that were missing from the smoke registry", () => {
    const endpointKeys = buildApiCategories((key) => key)
      .flatMap((category) => category.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`));

    expect(endpointKeys).toEqual(expect.arrayContaining([
      "GET /api/dashboard/members",
      "GET /api/dashboard/events",
      "GET /api/dashboard/wars",
    ]));
    expect(endpointKeys).toContain("GET /api/search?q=systemtest&limit=5");
    expect(endpointKeys).toContain("GET /api/guild-war/concluded-event-ids");
  });

  it("covers production system health endpoints without self-auditing the summary writer", () => {
    const endpointKeys = buildApiCategories((key) => key)
      .flatMap((category) => category.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`));

    expect(endpointKeys).toEqual(expect.arrayContaining([
      "GET /api/health",
      "GET /api/site-config",
      "GET /api/admin/status",
      "GET /api/admin/analytics-settings",
      "GET /api/dashboard/members",
      "GET /api/dashboard/events",
      "GET /api/dashboard/wars",
      "GET /api/search?q=systemtest&limit=5",
      "GET /api/admin/error-log?page=1&limit=5",
    ]));
    expect(endpointKeys).not.toContain("POST /api/admin/status/system-test-audit");
  });

  it("covers additional production read endpoints in the admin system health runner", () => {
    const endpointKeys = buildApiCategories((key) => key)
      .flatMap((category) => category.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`));

    expect(endpointKeys).toEqual(expect.arrayContaining([
      "GET /api/game-data",
      "GET /api/game-data/versions",
      "GET /api/admin/site-config",
      "GET /api/users/absences?from=2026-01-01&to=2026-01-31",
      "GET /api/users/:id/absences",
      "GET /api/wiki/articles/:id/revisions",
      "GET /api/wiki/articles/:id/revisions/1",
      "GET /api/admin/audit-archive/download",
      "GET /api/admin/audit-archive/download/file",
    ]));
  });

  it("exposes site config health checks as read-only endpoints", () => {
    const categories = buildApiCategories((key) => key);
    const endpointKeys = categories
      .flatMap((category) => category.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`));
    const visibleWithoutSiteConfigPermission = filterApiCategoriesForPermissions(categories, {
      "admin.siteConfig.manage": false,
    }).flatMap((category) => category.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`));
    const visibleWithSiteConfigPermission = filterApiCategoriesForPermissions(categories, {
      "admin.siteConfig.manage": true,
    }).flatMap((category) => category.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`));

    expect(endpointKeys).toEqual(expect.arrayContaining([
      "GET /api/site-config",
      "GET /api/admin/site-config",
    ]));
    expect(visibleWithoutSiteConfigPermission).not.toContain("GET /api/admin/site-config");
    expect(visibleWithSiteConfigPermission).toContain("GET /api/admin/site-config");
    expect(endpointKeys).not.toContain("PATCH /api/admin/site-config");
  });

  it("prepares additional production read endpoints without mutating existing database state", () => {
    const ctx = contextWith({
      adminCreatedUserId: "test-user",
      wikiArticleId: "wiki-article",
      auditArchiveMonth: "2026-06",
      auditArchiveDownloadToken: "download-token",
    });

    expect(resolveEndpointPath(
      { label: "User Absences", method: "GET", path: "/api/users/:id/absences" },
      ctx,
    ).path).toBe("/api/users/test-user/absences");
    expect(resolveEndpointPath(
      { label: "Wiki Revisions", method: "GET", path: "/api/wiki/articles/:id/revisions" },
      ctx,
    ).path).toBe("/api/wiki/articles/wiki-article/revisions");
    expect(resolveEndpointPath(
      { label: "Wiki Revision Detail", method: "GET", path: "/api/wiki/articles/:id/revisions/1" },
      ctx,
    ).path).toBe("/api/wiki/articles/wiki-article/revisions/1");
    expect(prepareEndpointRequest(
      { label: "Archive Download", method: "GET", path: "/api/admin/audit-archive/download" },
      ctx,
    ).path).toBe("/api/admin/audit-archive/download?month=2026-06&format=raw_ndjson_gz");
    expect(prepareEndpointRequest(
      { label: "Archive File", method: "GET", path: "/api/admin/audit-archive/download/file" },
      ctx,
    ).path).toBe("/api/admin/audit-archive/download/file?token=download-token");
  });

  it("requires status permission for admin production health endpoints", () => {
    const categories = buildApiCategories((key) => key);
    const filtered = filterApiCategoriesForPermissions(categories, {
      "admin.analytics.view": true,
    });
    const endpointKeys = filtered.flatMap((category) => category.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`));

    expect(endpointKeys).not.toContain("GET /api/admin/status");
    expect(endpointKeys).not.toContain("GET /api/admin/error-log?page=1&limit=5");
    expect(endpointKeys).toContain("GET /api/admin/analytics-settings");
  });

  it("covers destructive website actions using test-created fixture IDs", () => {
    const endpointKeys = buildApiCategories((key) => key)
      .flatMap((category) => category.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`));

    expect(endpointKeys).toContain("DELETE /api/events/:id/destroy");
    expect(endpointKeys).toContain("DELETE /api/announcements/:id/permanent");
    expect(endpointKeys).toContain("DELETE /api/wiki/articles/:id/permanent");
    expect(endpointKeys).toContain("POST /api/guild-war/conclude");
    expect(endpointKeys).toContain("POST /api/guild-war/history/batch-delete");
  });

  it("runs permanent delete actions against disposable records only", () => {
    const ctx = contextWith({
      announcementId: "seed-announcement",
      createdAnnouncementId: "created-announcement",
      wikiArticleId: "seed-article",
      createdWikiArticleId: "created-article",
      eventId: "seed-event",
      createdEventId: "created-event",
    });

    expect(resolveEndpointPath(
      { label: "Permanent Delete Announcement", method: "DELETE", path: "/api/announcements/:id/permanent" },
      ctx,
    ).path).toBe("/api/announcements/created-announcement/permanent");
    expect(resolveEndpointPath(
      { label: "Permanent Delete Wiki Article", method: "DELETE", path: "/api/wiki/articles/:id/permanent" },
      ctx,
    ).path).toBe("/api/wiki/articles/created-article/permanent");
    expect(resolveEndpointPath(
      { label: "Destroy Event", method: "DELETE", path: "/api/events/:id/destroy" },
      ctx,
    ).path).toBe("/api/events/created-event/destroy");
  });

  it("skips global configuration mutations instead of touching existing database state", () => {
    const prepared = prepareEndpointRequest(
      { label: "Update Analytics Settings", method: "PATCH", path: "/api/admin/analytics-settings" },
      createInitialTestRunContext(),
    );

    expect(prepared.path).toBe("/api/admin/analytics-settings");
    expect(prepared.skipReason).toContain("global analytics settings");
    expect(prepared.optionalSkip).toBe(true);
  });

  it("skips mutable smoke requests when only seeded fixture ids are available", () => {
    const seededOnly = contextWith({
      eventId: "seed-event",
      announcementId: "seed-announcement",
      wikiCategoryId: "seed-category",
      wikiArticleId: "seed-article",
      eventTemplateId: "seed-template",
      warHistoryId: "seed-war",
      warEventId: "seed-war-event",
      adminRoleId: "seed-role",
      badgeId: "seed-badge",
      inviteLinkId: "seed-invite",
      storageId: "seed-storage",
      storageCategoryId: "seed-storage-category",
      storageItemId: "seed-storage-item",
    });

    const unsafeEndpoints = [
      { label: "Update Event", method: "PATCH" as const, path: "/api/events/:id" },
      { label: "Archive Event", method: "DELETE" as const, path: "/api/events/:id" },
      { label: "Update Announcement", method: "PATCH" as const, path: "/api/announcements/:id" },
      { label: "Archive Announcement", method: "DELETE" as const, path: "/api/announcements/:id" },
      { label: "Update Wiki Category", method: "PATCH" as const, path: "/api/wiki/categories/:id" },
      { label: "Delete Wiki Category", method: "DELETE" as const, path: "/api/wiki/categories/:id" },
      { label: "Update Wiki Article", method: "PATCH" as const, path: "/api/wiki/articles/:id" },
      { label: "Archive Wiki Article", method: "DELETE" as const, path: "/api/wiki/articles/:id" },
      { label: "Update Event Template", method: "PATCH" as const, path: "/api/events/templates/:id" },
      { label: "Delete Event Template", method: "DELETE" as const, path: "/api/events/templates/:id" },
      { label: "Save Teams", method: "POST" as const, path: "/api/guild-war/save-teams" },
      { label: "Move Member", method: "POST" as const, path: "/api/guild-war/move" },
      { label: "Role Tag", method: "PATCH" as const, path: "/api/guild-war/role-tag" },
      { label: "Update History", method: "PATCH" as const, path: "/api/guild-war/history/:id" },
      { label: "Delete History", method: "DELETE" as const, path: "/api/guild-war/history/:id" },
      { label: "Update Role", method: "PATCH" as const, path: "/api/admin/roles/:id" },
      { label: "Delete Role", method: "DELETE" as const, path: "/api/admin/roles/:id" },
      { label: "Update Badge", method: "PATCH" as const, path: "/api/badges/:id" },
      { label: "Delete Badge", method: "DELETE" as const, path: "/api/badges/:id" },
      { label: "Delete Invite", method: "DELETE" as const, path: "/api/admin/invite-links/:id/permanent" },
      { label: "Update Storage", method: "PATCH" as const, path: "/api/storage/storages/:id" },
      { label: "Delete Storage", method: "DELETE" as const, path: "/api/storage/storages/:id" },
      { label: "Update Storage Category", method: "PATCH" as const, path: "/api/storage/storages/:storageId/categories/:id" },
      { label: "Delete Storage Category", method: "DELETE" as const, path: "/api/storage/storages/:storageId/categories/:id" },
      { label: "Update Storage Item", method: "PATCH" as const, path: "/api/storage/items/:id" },
      { label: "Delete Storage Item", method: "DELETE" as const, path: "/api/storage/items/:id" },
    ];

    for (const endpoint of unsafeEndpoints) {
      const prepared = prepareEndpointRequest(endpoint, seededOnly);
      expect(prepared.skipReason, `${endpoint.method} ${endpoint.path}`).toBeDefined();
      expect(JSON.stringify(prepared), `${endpoint.method} ${endpoint.path}`).not.toContain("seed-");
    }
  });

  it("runs guild-war conclude after active-team mutations and batch-deletes only test-created history", () => {
    const guildWarKeys = buildApiCategories((key) => key)
      .find((category) => category.key === "guildWar")
      ?.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`) ?? [];

    expect(guildWarKeys.indexOf("POST /api/guild-war/conclude"))
      .toBeGreaterThan(guildWarKeys.indexOf("POST /api/guild-war/move"));
    expect(guildWarKeys.indexOf("POST /api/guild-war/conclude"))
      .toBeGreaterThan(guildWarKeys.indexOf("PATCH /api/guild-war/role-tag"));
    expect(guildWarKeys.indexOf("PATCH /api/guild-war/history/:id/member-stats/:userId"))
      .toBeGreaterThan(guildWarKeys.indexOf("POST /api/guild-war/conclude"));
    expect(guildWarKeys.indexOf("POST /api/guild-war/history/batch-delete"))
      .toBeLessThan(guildWarKeys.indexOf("DELETE /api/guild-war/history/:id"));
    expect(parseJsonBody(prepareEndpointRequest(
      { label: "Batch Delete History", method: "POST", path: "/api/guild-war/history/batch-delete" },
      contextWith({
        warHistoryId: "seed-war",
        createdWarHistoryId: "created-war",
        createdConcludedWarHistoryId: "concluded-war",
      }),
    ))).toEqual({ ids: ["concluded-war"] });
  });

  it("marks system test endpoint requests so backend audit keeps only the full-run summary", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await runEndpointTest(
      { label: "Create Event", method: "POST", path: "/api/events" },
      buildJsonRequest("/api/events", { title: "[systemtest] Event" }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/events",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-System-Test": "admin-console-api",
          "X-System-Test-Audit": "suppress",
        }),
      }),
    );
  });

});

describe("stale [systemtest] artifact probes", () => {
  function probe(label: string): string {
    const found = STALE_ARTIFACT_PROBES.find((p) => p.label === label);
    if (!found) throw new Error(`no probe named ${label}`);
    return found.path;
  }

  /*
   * A leaked fixture is by definition one teardown never touched, so it is still
   * active and still unarchived. Every one of these probes previously narrowed by
   * exactly the state a leak cannot be in, which made them report a clean run
   * over a database that still held test rows.
   */
  it("does not narrow the leak probes by a state a leaked fixture cannot be in", () => {
    expect(probe("Users")).not.toContain("active=");
    expect(probe("Events")).not.toContain("archived=");
    expect(probe("Announcements")).not.toContain("archived=");
  });

  it("searches users by the username the engine actually generates", () => {
    const context = createInitialTestRunContext();
    context.registerInviteCode = "invite-code";
    prepareEndpointRequest(
      { label: "Register", method: "POST", path: "/api/auth/register/:inviteCode" },
      context,
    );

    const searchTerm = decodeURIComponent(new URL(probe("Users"), "http://x").searchParams.get("search") ?? "");
    expect(searchTerm).not.toBe("");
    /*
     * The users query matches `search` against the username column alone, so a
     * term that is not a substring of the generated username can never match —
     * which is how `[systemtest]` came to be searched against `systemtest_<ts>`.
     */
    expect(context.registeredUsername).toContain(searchTerm);
  });

  it("counts both fixture naming schemes as stale artifacts", () => {
    expect(countStaleSystemTestArtifacts({ data: [{ user: { username: "systemtest_1785085457897" } }] })).toBe(1);
    expect(countStaleSystemTestArtifacts({ data: [{ title: "[systemtest] API Poll Event" }] })).toBe(1);
    expect(countStaleSystemTestArtifacts({ data: [{ user: { username: "admin" } }, { title: "Guild meeting" }] })).toBe(0);
  });
});
