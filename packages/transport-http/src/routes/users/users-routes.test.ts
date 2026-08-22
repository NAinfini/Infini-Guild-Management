import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import type { MemberView } from "@guild/server/modules/members";
import type { MemberAbsence } from "@guild/shared";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../../core/error-handler.js";
import type { HttpEnv } from "../../core/http-env.js";
import { createUsersRoutes } from "./users-routes.js";

const NOW = "2026-08-09T12:00:00.000Z";
const AVATAR_ID = "aaaaaaaaaaaaaaaaaaaaa";
const IMAGE_ID = "bbbbbbbbbbbbbbbbbbbbb";
const AUDIO_ID = "ccccccccccccccccccccc";
const view: MemberView = {
  projection: "admin",
  record: {
    user: {
      id: "user-1", username: "Member", roleId: "member", roleName: "Member", roleColor: null,
      roleLevel: 100, isActive: true, deletedAt: null, createdAt: NOW, updatedAt: NOW,
      lastLoginAt: null,
    },
    profile: {
      userId: "user-1", power: 12, classes: ["class-1"], titleHtml: null, bio: "Bio",
      videoUrls: [], availability: null, vacationStart: null, vacationEnd: null, notes: "Admin note",
      createdAt: NOW, updatedAt: NOW,
    },
    badges: [{ id: "badge-1", name: "Badge", label_html: "Badge", color: "#fff" }],
  },
  media: { avatarMediaId: AVATAR_ID, images: [IMAGE_ID], audioMediaId: AUDIO_ID, audioName: "intro.opus" },
};
const profile = {
  user_id: "user-1", power: 12, classes: ["class-1"], title_html: null, bio: "Bio",
  avatar_media_id: AVATAR_ID, images: [IMAGE_ID], audio_media_id: AUDIO_ID, audio_name: "intro.opus",
  video_urls: [], availability: null, vacation_start: null, vacation_end: null, notes: "Admin note",
  created_at: NOW, updated_at: NOW,
};
const absence: MemberAbsence = {
  id: "absence-1", user_id: "user-1", username: "Member", role_id: "member", role_name: "Member",
  role_color: null, role_level: 100, start_date: "2026-08-10", end_date: "2026-08-11", note: "Away", created_at: NOW,
};

function buildApp() {
  const service = {
    list: vi.fn().mockResolvedValue({ data: [view], total: 1, page: 1, limit: 20, totalPages: 1 }),
    stats: vi.fn().mockResolvedValue({ active_members: 1, total_members: 1 }),
    detail: vi.fn().mockResolvedValue(view),
    updateProfile: vi.fn().mockResolvedValue(profile),
    listAbsenceWindow: vi.fn().mockResolvedValue({ data: [absence] }),
    listUserAbsences: vi.fn().mockResolvedValue({ data: [absence] }),
    createAbsence: vi.fn().mockResolvedValue(absence),
    deleteAbsence: vi.fn().mockResolvedValue({ ok: true as const }),
    uploadImages: vi.fn().mockResolvedValue({ media_ids: ["image-2"] }),
    deleteImages: vi.fn().mockResolvedValue({ ok: true as const, deleted: 1 }),
    uploadAvatar: vi.fn().mockResolvedValue({ media_id: "avatar-2" }),
    deleteAvatar: vi.fn().mockResolvedValue({ ok: true as const }),
    uploadAudio: vi.fn().mockResolvedValue({ media_id: "audio-2" }),
    deleteAudio: vi.fn().mockResolvedValue({ ok: true as const }),
  };
  const authService = {
    changePassword: vi.fn().mockResolvedValue({ ok: true as const }),
    changeUsername: vi.fn().mockResolvedValue({ ok: true as const }),
  };
  const app = new Hono<HttpEnv>();
  app.onError(createHttpErrorHandler());
  app.use("*", async (context, next) => {
    context.set("requestContext", createRequestContext({
      requestId: "request-1",
      now: NOW,
      authorization: createAuthorizationContext({
        userId: "admin-1", sessionId: "session-1", roleId: "admin", roleLevel: 900,
        permissions: ["admin.users.view", "admin.users.edit"],
      }),
    }));
    await next();
  });
  app.route("/api/users", createUsersRoutes({ service, authService }));
  return { app, service, authService };
}

describe("users Portal HTTP contract", () => {
  it("presents roster and detail projections in the frozen snake_case shape", async () => {
    const { app, service } = buildApp();
    const list = await app.request("/api/users?page=1&limit=20&include_total=true&external_view=true&role=member&class=class-1&active=true");
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      data: [{
        user: { id: "user-1", role_name: "Member", is_active: true },
        profile: { user_id: "user-1", avatar_media_id: AVATAR_ID, audio_name: "intro.opus" },
        badges: [{ id: "badge-1" }],
      }],
      total: 1,
      total_pages: 1,
    });
    expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ requestId: "request-1" }), {
      page: 1,
      limit: 20,
      roleId: "member",
      classId: "class-1",
      active: true,
      includeTotal: true,
      externalView: true,
    });
    const detail = await app.request("/api/users/user-1?external_view=true");
    expect(await detail.json()).toMatchObject({ user: { role_level: 100 }, profile: { images: [IMAGE_ID] } });
  });

  it("keeps every current profile, absence, media, and credential route", async () => {
    const { app, service } = buildApp();
    const requests: Array<readonly [string, string, BodyInit | undefined, number]> = [
      ["GET", "/api/users/stats", undefined, 200],
      ["GET", "/api/users/absences?from=2026-08-01&to=2026-08-31", undefined, 200],
      ["GET", "/api/users/user-1/absences", undefined, 200],
      ["PATCH", "/api/users/user-1/profile", json({ bio: "Next" }), 200],
      ["POST", "/api/users/user-1/absences", json({ start_date: "2026-08-10", end_date: "2026-08-11", note: "Away" }), 201],
      ["DELETE", "/api/users/user-1/absences/absence-1", undefined, 200],
      ["POST", "/api/users/user-1/media/images", imageForm(), 201],
      ["DELETE", "/api/users/user-1/media/images", json({ media_ids: [IMAGE_ID] }), 200],
      ["POST", "/api/users/user-1/media/avatar", imageForm(), 201],
      ["DELETE", "/api/users/user-1/media/avatar", undefined, 200],
      ["POST", "/api/users/user-1/media/audio", audioForm(), 201],
      ["DELETE", "/api/users/user-1/media/audio", undefined, 200],
      ["POST", "/api/users/user-1/change-password", json({ currentPassword: "old", newPassword: "new-pass-1", confirmNewPassword: "new-pass-1" }), 200],
      ["POST", "/api/users/user-1/change-username", json({ currentPassword: "old", newUsername: "Member2" }), 200],
    ];
    for (const [method, path, body, status] of requests) {
      const response = await app.request(path, {
        method,
        body,
        ...(typeof body === "string" ? { headers: { "Content-Type": "application/json" } } : {}),
      });
      expect(response.status, `${method} ${path}: ${await response.clone().text()}`).toBe(status);
    }
    expect(service.uploadAudio).toHaveBeenCalledWith(expect.anything(), "user-1", {
      full: expect.any(Uint8Array),
      originalName: "intro.opus",
    });
  });

  it("maps absence and credential DTOs before calling domain services", async () => {
    const { app, service, authService } = buildApp();
    await app.request("/api/users/user-1/absences", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_date: "2026-08-10", end_date: "2026-08-11", note: " Away " }),
    });
    expect(service.createAbsence).toHaveBeenCalledWith(expect.anything(), "user-1", {
      startDate: "2026-08-10", endDate: "2026-08-11", note: "Away",
    });
    await app.request("/api/users/user-1/change-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "old", newPassword: "new-pass-1", confirmNewPassword: "new-pass-1" }),
    });
    expect(authService.changePassword).toHaveBeenCalledWith(expect.anything(), {
      targetUserId: "user-1", currentPassword: "old", newPassword: "new-pass-1",
    });
  });
});

function json(value: unknown): string {
  return JSON.stringify(value);
}

function imageForm(): FormData {
  const form = new FormData();
  form.append("full", new File(["full"], "full.webp", { type: "image/webp" }));
  form.append("view", new File(["view"], "view.webp", { type: "image/webp" }));
  return form;
}

function audioForm(): FormData {
  const form = new FormData();
  form.append("file", new File(["audio"], "intro.opus", { type: "audio/ogg" }));
  return form;
}
