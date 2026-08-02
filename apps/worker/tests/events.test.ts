/**
 * Event API Integration Tests
 *
 * These tests run against a live wrangler dev server with a seeded D1 database.
 * Prerequisites:
 *   1. pnpm db:mock:rebuild
 *   2. pnpm dev:worker (in another terminal)
 *   3. Hit POST /api/dev/seed to seed test data
 *   4. pnpm test
 *
 * Test accounts (from seed.ts):
 *   - admin / admin123
 *   - mod_1 / moderator123
 *   - member_01 / member1234
 *
 * Cross-referenced with: doc/Planning/events.md
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ── Config ──────────────────────────────────────────────────────────

const BASE_URL = (process.env.TEST_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

// ── Helpers ─────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

/**
 * 造一张字节头真实的 PNG。
 *
 * 上传路径会按魔数复核声明的类型，随便塞几个字节再标成 image/png 是过不去的。
 */
function pngFile(name: string): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])], name, { type: "image/png" });
}

async function api(
  path: string,
  options: { method?: string; body?: Json | FormData; cookie?: string; headers?: Record<string, string> } = {},
) {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body
      ? options.body instanceof FormData
        ? options.body
        : JSON.stringify(options.body)
      : undefined,
  });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  return { res, status: res.status, payload: payload as Json, headers: res.headers };
}

function extractCookie(headers: Headers): string | null {
  const setCookie = headers.get("set-cookie");
  if (!setCookie) return null;
  const first = setCookie.split(",")[0]!;
  return first.split(";")[0]?.trim() || null;
}

async function login(username: string, password: string): Promise<{ cookie: string; userId: string }> {
  const { headers } = await api("/api/auth/login", {
    method: "POST",
    body: { username, password, stay_logged_in: true },
  });
  const cookie = extractCookie(headers);
  if (!cookie) throw new Error(`Login failed for ${username}: no cookie`);

  const me = await api("/api/auth/me", { cookie });
  const userId = (me.payload as { user?: { id?: string } })?.user?.id;
  if (!userId) throw new Error(`Login failed for ${username}: no user id`);

  return { cookie, userId };
}

// ── Session state ───────────────────────────────────────────────────

let adminCookie: string;
let modCookie: string;
let memberCookie: string;
let memberUserId: string;

// IDs created during tests for cleanup/reference
let createdEventId: string;

// ── Setup / Teardown ────────────────────────────────────────────────

beforeAll(async () => {
  // Verify server is running
  const health = await api("/api/health");
  if (health.status !== 200) {
    throw new Error(
      `Worker not running at ${BASE_URL}. Start with: pnpm dev:worker`,
    );
  }

  // Login as all three roles
  const admin = await login("admin", "admin123");
  adminCookie = admin.cookie;

  const mod = await login("mod_1", "moderator123");
  modCookie = mod.cookie;

  const member = await login("member_01", "member1234");
  memberCookie = member.cookie;
  memberUserId = member.userId;
});

afterAll(async () => {
  // Logout all sessions
  await api("/api/auth/logout", { method: "POST", cookie: adminCookie }).catch(() => {});
  await api("/api/auth/logout", { method: "POST", cookie: modCookie }).catch(() => {});
  await api("/api/auth/logout", { method: "POST", cookie: memberCookie }).catch(() => {});
});

// ═══════════════════════════════════════════════════════════════════
// A. Event CRUD
// ═══════════════════════════════════════════════════════════════════

describe("Event CRUD", () => {
  it("GET /api/events — list events with pagination", async () => {
    const { status, payload } = await api("/api/events?page=1&limit=5", { cookie: modCookie });
    expect(status).toBe(200);
    expect(payload).toHaveProperty("data");
    expect(Array.isArray((payload as { data: unknown[] }).data)).toBe(true);
    expect(payload).toHaveProperty("total");
    expect(payload).toHaveProperty("page");
    expect(payload).toHaveProperty("limit");
  });

  it("GET /api/events — filter by type", async () => {
    const { status, payload } = await api("/api/events?type=guild_war&page=1&limit=5", { cookie: modCookie });
    expect(status).toBe(200);
    const data = (payload as { data: Array<{ type: string }> }).data;
    for (const event of data) {
      expect(event.type).toBe("guild_war");
    }
  });

  it("GET /api/events — filter by archived=false excludes archived", async () => {
    const { status, payload } = await api("/api/events?archived=false&page=1&limit=100", { cookie: modCookie });
    expect(status).toBe(200);
    const data = (payload as { data: Array<{ archived_at: string | null }> }).data;
    for (const event of data) {
      expect(event.archived_at).toBeNull();
    }
  });

  it("POST /api/events — create one-off event (moderator)", async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { status, payload } = await api("/api/events", {
      method: "POST",
      cookie: modCookie,
      body: {
        type: "social",
        title: "Test Social Event",
        description: "Integration test event",
        start_at: futureDate,
        capacity: 10,
      },
    });

    expect(status).toBe(201);
    expect(payload).toHaveProperty("id");
    expect((payload as { title: string }).title).toBe("Test Social Event");
    expect((payload as { type: string }).type).toBe("social");
    expect((payload as { capacity: number }).capacity).toBe(10);
    createdEventId = (payload as { id: string }).id;
  });

  it("GET /api/events/:id — get event detail with participants", async () => {
    const { status, payload } = await api(`/api/events/${createdEventId}`, { cookie: modCookie });
    expect(status).toBe(200);
    expect((payload as { id: string }).id).toBe(createdEventId);
    expect(payload).toHaveProperty("participants");
    expect(Array.isArray((payload as { participants: unknown[] }).participants)).toBe(true);
  });

  it("PATCH /api/events/:id — update event fields", async () => {
    const { status, payload } = await api(`/api/events/${createdEventId}`, {
      method: "PATCH",
      cookie: modCookie,
      body: {
        title: "Updated Social Event",
        capacity: 20,
      },
    });

    expect(status).toBe(200);
    expect((payload as { title: string }).title).toBe("Updated Social Event");
    expect((payload as { capacity: number }).capacity).toBe(20);
  });

  it("DELETE /api/events/:id — soft archive event", async () => {
    // Create a disposable event for archiving
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const created = await api("/api/events", {
      method: "POST",
      cookie: modCookie,
      body: { type: "other", title: "To Archive", start_at: futureDate },
    });
    const archiveId = (created.payload as { id: string }).id;

    const { status } = await api(`/api/events/${archiveId}`, {
      method: "DELETE",
      cookie: modCookie,
    });
    expect(status).toBe(200);

    // Verify it's archived (has archived_at)
    const detail = await api(`/api/events/${archiveId}`, { cookie: modCookie });
    expect((detail.payload as { archived_at: string | null }).archived_at).not.toBeNull();
  });

  it("POST /api/events — rejects recurrence_rule (recurring events use templates now)", async () => {
    const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const { status } = await api("/api/events", {
      method: "POST",
      cookie: modCookie,
      body: {
        type: "weekly_mission",
        title: "Weekly Raid",
        start_at: futureDate,
        capacity: 30,
        recurrence_rule: {
          frequency: "weekly",
          interval: 1,
          daysOfWeek: [1, 4],
          endAfter: 8,
        },
      },
    });

    expect(status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. Signup / Participant Management
// ═══════════════════════════════════════════════════════════════════

describe("Signup / Participant Management", () => {
  it("POST /api/events/:id/join — member joins event", async () => {
    const { status } = await api(`/api/events/${createdEventId}/join`, {
      method: "POST",
      cookie: memberCookie,
    });
    // 200 or 201
    expect([200, 201]).toContain(status);
  });

  it("POST /api/events/:id/join — duplicate join prevention", async () => {
    const { status } = await api(`/api/events/${createdEventId}/join`, {
      method: "POST",
      cookie: memberCookie,
    });
    // Should return 409 CONFLICT for duplicate join
    expect(status).toBe(409);
  });

  it("DELETE /api/events/:id/leave — member leaves event", async () => {
    const { status } = await api(`/api/events/${createdEventId}/leave`, {
      method: "DELETE",
      cookie: memberCookie,
    });
    expect(status).toBe(200);
  });

  it("POST /api/events/:id/join — capacity enforcement", async () => {
    // Create event with capacity=1
    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const created = await api("/api/events", {
      method: "POST",
      cookie: modCookie,
      body: { type: "social", title: "Tiny Event", start_at: futureDate, capacity: 1 },
    });
    const tinyEventId = (created.payload as { id: string }).id;

    // First join — should succeed
    const join1 = await api(`/api/events/${tinyEventId}/join`, {
      method: "POST",
      cookie: memberCookie,
    });
    expect([200, 201]).toContain(join1.status);

    // Second join by different user — should be rejected (capacity full)
    const join2 = await api(`/api/events/${tinyEventId}/join`, {
      method: "POST",
      cookie: modCookie,
    });
    // Should be 409 or 400 (capacity reached)
    expect([400, 409]).toContain(join2.status);
  });

  it("POST /api/events/:id/join — signup_locked enforcement", async () => {
    // Lock the main event
    await api(`/api/events/${createdEventId}`, {
      method: "PATCH",
      cookie: modCookie,
      body: { signup_locked: true },
    });

    // Member tries to join locked event — should fail (409 = signup locked)
    const { status } = await api(`/api/events/${createdEventId}/join`, {
      method: "POST",
      cookie: memberCookie,
    });
    expect(status).toBe(409);

    // Unlock for further tests
    await api(`/api/events/${createdEventId}`, {
      method: "PATCH",
      cookie: modCookie,
      body: { signup_locked: false },
    });
  });

  it("POST /api/events/:id/participants — mod force-adds member", async () => {
    const { status } = await api(`/api/events/${createdEventId}/participants`, {
      method: "POST",
      cookie: modCookie,
      body: { user_id: memberUserId },
    });
    expect([200, 201]).toContain(status);
  });

  it("DELETE /api/events/:id/participants/:userId — mod removes member", async () => {
    const { status } = await api(`/api/events/${createdEventId}/participants/${memberUserId}`, {
      method: "DELETE",
      cookie: modCookie,
    });
    expect(status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. Permission Checks (from spec permission matrix)
// ═══════════════════════════════════════════════════════════════════

describe("Permission Checks", () => {
  it("Unauthenticated — can list events", async () => {
    const { status } = await api("/api/events?page=1&limit=5");
    expect(status).toBe(200);
  });

  it("Unauthenticated — cannot create event", async () => {
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { status } = await api("/api/events", {
      method: "POST",
      body: { type: "social", title: "No Auth", start_at: futureDate },
    });
    expect(status).toBe(401);
  });

  it("Member — cannot create event", async () => {
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { status } = await api("/api/events", {
      method: "POST",
      cookie: memberCookie,
      body: { type: "social", title: "Member Create", start_at: futureDate },
    });
    expect(status).toBe(403);
  });

  it("Member — can join event", async () => {
    // First ensure member has left the event
    await api(`/api/events/${createdEventId}/leave`, {
      method: "DELETE",
      cookie: memberCookie,
    });

    const { status } = await api(`/api/events/${createdEventId}/join`, {
      method: "POST",
      cookie: memberCookie,
    });
    expect([200, 201]).toContain(status);

    // Cleanup — leave the event
    await api(`/api/events/${createdEventId}/leave`, {
      method: "DELETE",
      cookie: memberCookie,
    });
  });

  it("Member — cannot edit event", async () => {
    const { status } = await api(`/api/events/${createdEventId}`, {
      method: "PATCH",
      cookie: memberCookie,
      body: { title: "Member Edit" },
    });
    expect(status).toBe(403);
  });

  it("Member — cannot archive event", async () => {
    const { status } = await api(`/api/events/${createdEventId}`, {
      method: "DELETE",
      cookie: memberCookie,
    });
    expect(status).toBe(403);
  });

  it("Moderator — can create, edit, archive events", async () => {
    const futureDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const create = await api("/api/events", {
      method: "POST",
      cookie: modCookie,
      body: { type: "other", title: "Mod Permission Test", start_at: futureDate },
    });
    expect(create.status).toBe(201);
    const eventId = (create.payload as { id: string }).id;

    // Edit
    const edit = await api(`/api/events/${eventId}`, {
      method: "PATCH",
      cookie: modCookie,
      body: { title: "Mod Permission Test Edited" },
    });
    expect(edit.status).toBe(200);

    // Archive
    const archive = await api(`/api/events/${eventId}`, {
      method: "DELETE",
      cookie: modCookie,
    });
    expect(archive.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. Edge Cases (from spec)
// ═══════════════════════════════════════════════════════════════════

describe("Edge Cases", () => {
  it("Archive event with participants — participants preserved (soft delete)", async () => {
    // Create event, add participant, archive
    const futureDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
    const created = await api("/api/events", {
      method: "POST",
      cookie: modCookie,
      body: { type: "social", title: "Archive With Participants", start_at: futureDate, capacity: 10 },
    });
    const eventId = (created.payload as { id: string }).id;

    // Add participant
    await api(`/api/events/${eventId}/join`, { method: "POST", cookie: memberCookie });

    // Archive
    await api(`/api/events/${eventId}`, { method: "DELETE", cookie: modCookie });

    // Verify event is archived but detail still returns participants
    const detail = await api(`/api/events/${eventId}`, { cookie: modCookie });
    expect((detail.payload as { archived_at: string | null }).archived_at).not.toBeNull();
    expect(
      ((detail.payload as { participants: unknown[] }).participants ?? []).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("capacity=null means unlimited — join always succeeds", async () => {
    const futureDate = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString();
    const created = await api("/api/events", {
      method: "POST",
      cookie: modCookie,
      body: { type: "social", title: "Unlimited Event", start_at: futureDate },
      // No capacity → null → unlimited
    });
    const eventId = (created.payload as { id: string }).id;

    const { status } = await api(`/api/events/${eventId}/join`, {
      method: "POST",
      cookie: memberCookie,
    });
    expect([200, 201]).toContain(status);
  });

  it("Event with end_at=null is valid", async () => {
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { status, payload } = await api("/api/events", {
      method: "POST",
      cookie: modCookie,
      body: { type: "other", title: "No End Time", start_at: futureDate },
    });
    expect(status).toBe(201);
    expect((payload as { end_at: string | null }).end_at).toBeNull();
  });

  it("Filter archived events separately", async () => {
    const archived = await api("/api/events?archived=true&page=1&limit=100", { cookie: modCookie });
    expect(archived.status).toBe(200);
    const data = (archived.payload as { data: Array<{ archived_at: string | null }> }).data;
    for (const event of data) {
      expect(event.archived_at).not.toBeNull();
    }
  });

  it("ETag support — 304 on unchanged data", async () => {
    // First request to get ETag
    const first = await api("/api/events?page=1&limit=5", { cookie: modCookie });
    const etag = first.headers.get("etag");

    if (etag) {
      // Second request with If-None-Match
      const second = await api("/api/events?page=1&limit=5", {
        cookie: modCookie,
        headers: { "If-None-Match": etag },
      });
      expect(second.status).toBe(304);
    }
  });

  it("GET /api/events/:id — non-existent event returns 404", async () => {
    const { status } = await api("/api/events/nonexistent-id-12345", { cookie: modCookie });
    expect(status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
// F. Audit Logging
// ═══════════════════════════════════════════════════════════════════

describe("Audit Logging", () => {
  it("Create event → audit_log entry exists", async () => {
    // The admin audit endpoint should show recent event creation entries
    const { status, payload } = await api("/api/admin/audit-log?entity_type=event&page=1&limit=10", {
      cookie: adminCookie,
    });
    expect(status).toBe(200);
    const data = (payload as { data: Array<{ entity_type: string; action: string }> }).data;
    const createEntries = data.filter((e) => e.entity_type === "event" && e.action === "create");
    expect(createEntries.length).toBeGreaterThan(0);
  });

  it("Archive event → audit_log entry exists", async () => {
    const { status, payload } = await api("/api/admin/audit-log?entity_type=event&page=1&limit=10", {
      cookie: adminCookie,
    });
    expect(status).toBe(200);
    const data = (payload as { data: Array<{ entity_type: string; action: string }> }).data;
    const archiveEntries = data.filter((e) => e.entity_type === "event" && e.action === "archive");
    expect(archiveEntries.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// G. Image Attachments
// ═══════════════════════════════════════════════════════════════════

describe("Image Attachments", () => {
  it("POST /api/events/:id/images — upload within limit", async () => {
    const file = pngFile("test.png");
    const form = new FormData();
    form.append("files", file);
    form.append("captions", "Test caption");

    const { status } = await api(`/api/events/${createdEventId}/images`, {
      method: "POST",
      cookie: modCookie,
      body: form,
    });
    // 200 or 201
    expect([200, 201]).toContain(status);
  });

  it("POST /api/events/:id/images — rejects when exceeding max attachments", async () => {
    // Upload 6 files (limit is 5)
    const form = new FormData();
    for (let i = 0; i < 6; i++) {
      form.append("files", pngFile(`test-${i}.png`));
    }

    const { status } = await api(`/api/events/${createdEventId}/images`, {
      method: "POST",
      cookie: modCookie,
      body: form,
    });
    // Should be rejected (400 or similar)
    expect([400, 409, 413]).toContain(status);
  });
});

// ═══════════════════════════════════════════════════════════════════
// H. Date Range Filtering
// ═══════════════════════════════════════════════════════════════════

describe("Date Range Filtering", () => {
  it("GET /api/events — filter by date_from and date_to", async () => {
    const today = new Date().toISOString().split("T")[0];
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const { status, payload } = await api(
      `/api/events?date_from=${today}&date_to=${future}&page=1&limit=50`,
      { cookie: modCookie },
    );
    expect(status).toBe(200);
    expect(payload).toHaveProperty("data");
  });
});
