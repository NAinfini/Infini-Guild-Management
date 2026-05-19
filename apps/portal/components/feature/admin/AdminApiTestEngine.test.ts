import { describe, expect, it } from "vitest";
import {
  buildCleanupSteps,
  buildApiCategories,
  captureContextFromResponse,
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
        clearContext: { adminCreatedUserId: null, adminCreatedUsername: null, adminCreatedUserPassword: null },
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

    const ctx = { ...createdCtx, targetUserId: "user-1", warMemberUserId: "user-1" };
    expect(parseJsonBody(prepareEndpointRequest(
      { label: "Save Teams", method: "POST", path: "/api/guild-war/save-teams" },
      ctx,
    ))).toMatchObject({ event_id: "guild-war-event" });
    expect(parseJsonBody(prepareEndpointRequest(
      { label: "Conclude", method: "POST", path: "/api/guild-war/conclude" },
      ctx,
    ))).toMatchObject({ event_id: "guild-war-event" });
  });

  it("uses concluded history for member stats requests", () => {
    const ctx = contextWith({
      warHistoryId: "seed-war",
      createdWarHistoryId: "manual-war",
      createdConcludedWarHistoryId: "concluded-war",
      targetUserId: "user-1",
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
    expect(next.targetUserId).toBe("registered-1");
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

    const raffleCtx = contextWith({ createdRaffleEventId: "raffle-1", targetUserId: "user-1" });
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

  it("represents credential-change routes as optional production checks", async () => {
    const endpointKeys = buildApiCategories((key) => key)
      .find((category) => category.key === "users")
      ?.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`) ?? [];

    expect(endpointKeys).toContain("POST /api/users/:id/change-password");
    expect(endpointKeys).toContain("POST /api/users/:id/change-username");

    const result = await runEndpointTest(
      { label: "Change Password", method: "POST", path: "/api/users/:id/change-password" },
      prepareEndpointRequest(
        { label: "Change Password", method: "POST", path: "/api/users/:id/change-password" },
        contextWith({ meId: "admin-1" }),
      ),
    );

    expect(result.status).toBeNull();
    expect(result.error).toBeNull();
    expect(result.body).toContain("Requires current user password");
  });

  it("covers every actionable worker route in the smoke registry", () => {
    const endpointKeys = new Set(buildApiCategories((key) => key)
      .flatMap((category) => category.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)));
    const expectedRoutes = [
      "GET /api/health",
      "GET /api/site-config",
      "POST /api/auth/login",
      "POST /api/auth/logout",
      "GET /api/auth/check-username?username=test",
      "GET /api/auth/verify-invite/:code",
      "POST /api/auth/register/:inviteCode",
      "GET /api/auth/me",
      "GET /api/dashboard/summary",
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
      "POST /api/users/:id/change-password",
      "POST /api/users/:id/change-username",
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
      "GET /api/admin/roles",
      "POST /api/admin/roles",
      "PATCH /api/admin/roles/:id",
      "DELETE /api/admin/roles/:id",
      "GET /api/admin/status",
      "GET /api/admin/analytics-settings",
      "PATCH /api/admin/analytics-settings",
      "GET /api/admin/audit-archive/months",
      "GET /api/admin/audit-archive/download",
      "GET /api/admin/audit-archive/download/file",
      "GET /api/admin/audit-log?page=1&limit=5",
      "GET /api/admin/audit-log/export?format=json",
      "GET /api/admin/error-log?page=1&limit=5",
    ];

    expect(expectedRoutes.filter((route) => !endpointKeys.has(route))).toEqual([]);
  });

  it("orders user image retrieval after test upload and tracks logout as an optional production check", async () => {
    const categories = buildApiCategories((key) => key);
    const authPaths = categories.find((category) => category.key === "auth")?.endpoints.map((endpoint) => endpoint.path);
    const userEndpointKeys = categories.find((category) => category.key === "users")
      ?.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`) ?? [];

    expect(authPaths).toContain("/api/auth/logout");
    expect(userEndpointKeys.indexOf("POST /api/users/:id/media/images")).toBeLessThan(userEndpointKeys.indexOf("GET /api/users/image"));
    expect(userEndpointKeys.indexOf("GET /api/users/image")).toBeLessThan(userEndpointKeys.indexOf("DELETE /api/users/:id/media/images"));

    const result = await runEndpointTest(
      { label: "Logout", method: "POST", path: "/api/auth/logout" },
      prepareEndpointRequest(
        { label: "Logout", method: "POST", path: "/api/auth/logout" },
        contextWith({ meId: "admin-1" }),
      ),
    );

    expect(result.status).toBeNull();
    expect(result.error).toBeNull();
    expect(result.body).toContain("Logout is tested by dedicated auth flows");
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

    expect(endpointKeys).toContain("GET /api/dashboard/summary");
    expect(endpointKeys).toContain("GET /api/search?q=systemtest&limit=5");
    expect(endpointKeys).toContain("GET /api/guild-war/concluded-event-ids");
    expect(endpointKeys).toContain("GET /api/admin/audit-archive/download");
    expect(endpointKeys).toContain("GET /api/admin/audit-archive/download/file");
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

  it("treats missing audit archive download fixtures as an optional non-error result", async () => {
    const result = await runEndpointTest(
      { label: "Download Archive", method: "GET", path: "/api/admin/audit-archive/download" },
      prepareEndpointRequest(
        { label: "Download Archive", method: "GET", path: "/api/admin/audit-archive/download" },
        createInitialTestRunContext(),
      ),
    );

    expect(result.status).toBeNull();
    expect(result.error).toBeNull();
    expect(result.body).toContain("No archived audit month");
  });
});
