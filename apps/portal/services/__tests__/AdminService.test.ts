// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockJsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

import {
  updateAdminUserRole,
  deactivateAdminUser,
  reactivateAdminUser,
  resetAdminUserPassword,
  createAdminMember,
  batchUpdateAdminUserRole,
  batchDeactivateAdminUsers,
  batchReactivateAdminUsers,
  batchDeleteAdminUsers,
  revokeAdminInviteLink,
  deleteAdminInviteLink,
  createAdminInviteLink,
  fetchAdminInviteLinks,
} from "../AdminService";

describe("AdminService mutations", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("updateAdminUserRole sends PATCH with role payload", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    await updateAdminUserRole("user-1", "moderator");
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/admin/users/user-1/role");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ role: "moderator" });
  });

  it("deactivateAdminUser sends PATCH with optional reason", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    await deactivateAdminUser("user-1", "Inactive");
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/admin/users/user-1/deactivate");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ reason: "Inactive" });
  });

  it("deactivateAdminUser omits reason when undefined", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    await deactivateAdminUser("user-2");
    const [, init] = mockFetch.mock.calls[0]!;
    expect(JSON.parse(init.body)).toEqual({});
  });

  it("reactivateAdminUser sends PATCH to reactivate endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    await reactivateAdminUser("user-1");
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/admin/users/user-1/reactivate");
    expect(init.method).toBe("PATCH");
  });

  it("resetAdminUserPassword sends POST and returns temporary password", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true, temporary_password: "abc123" }));
    const result = await resetAdminUserPassword("user-1");
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/admin/users/user-1/reset-password");
    expect(init.method).toBe("POST");
    expect(result.temporary_password).toBe("abc123");
  });

  it("createAdminMember validates and sends POST", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true, user_id: "u-new", username: "newuser", temporary_password: "pass" }));
    const result = await createAdminMember({ username: "newuser", role_id: "member" });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/admin/users");
    expect(init.method).toBe("POST");
    expect(result.username).toBe("newuser");
  });

  it("createAdminMember rejects empty username", () => {
    expect(() => createAdminMember({ username: "", role_id: "member" })).toThrow();
  });

  it("batchUpdateAdminUserRole sends batch role PATCH", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true, updated: 3 }));
    await batchUpdateAdminUserRole({ user_ids: ["u-1", "u-2", "u-3"], new_role: "member" });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/admin/users/batch/role");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ user_ids: ["u-1", "u-2", "u-3"], new_role: "member" });
  });

  it("batchDeactivateAdminUsers sends batch deactivate PATCH", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true, updated: 2 }));
    await batchDeactivateAdminUsers({ user_ids: ["u-1", "u-2"] });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/admin/users/batch/deactivate");
    expect(init.method).toBe("PATCH");
  });

  it("batchReactivateAdminUsers sends batch reactivate PATCH", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true, updated: 1 }));
    await batchReactivateAdminUsers({ user_ids: ["u-1"] });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/admin/users/batch/reactivate");
    expect(init.method).toBe("PATCH");
  });

  it("batchDeleteAdminUsers sends batch delete PATCH", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true, updated: 2 }));
    await batchDeleteAdminUsers({ user_ids: ["u-1", "u-2"] });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/admin/users/batch/delete");
    expect(init.method).toBe("PATCH");
  });

  it("batchUpdateAdminUserRole rejects empty user_ids", () => {
    expect(() => batchUpdateAdminUserRole({ user_ids: [], new_role: "member" })).toThrow();
  });

  it("createAdminInviteLink sends POST with payload", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ id: "inv-1", code: "A1b2C3d4E5" }));
    await createAdminInviteLink({ role_id: "member", max_uses: 10 });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/admin/invite-links");
    expect(init.method).toBe("POST");
  });

  it("fetchAdminInviteLinks sends cursor, visibility, and search filters", async () => {
    const cursor = "eyJjcmVhdGVkX2F0IjoiMjAyNi0wNS0xOFQwMDowMDowMC4wMDBaIiwiaWQiOiJpbnZpdGUtNTAifQ";
    const response = {
      data: [],
      next_cursor: cursor,
      total: 75,
    };
    mockFetch.mockResolvedValueOnce(mockJsonResponse(response));

    const result = await fetchAdminInviteLinks({
      cursor,
      limit: 50,
      visibility: "expired",
      search: "2026-07",
    });

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/admin/invite-links?");
    expect(url).toContain(`cursor=${cursor}`);
    expect(url).toContain("limit=50");
    expect(url).toContain("visibility=expired");
    expect(url).toContain("search=2026-07");
    expect(result).toEqual(response);
  });

  it("revokeAdminInviteLink sends DELETE", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    await revokeAdminInviteLink("inv-1");
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/admin/invite-links/inv-1");
    expect(init.method).toBe("DELETE");
  });

  it("deleteAdminInviteLink sends DELETE to permanent endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    await deleteAdminInviteLink("inv-1");
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/admin/invite-links/inv-1/permanent");
    expect(init.method).toBe("DELETE");
  });
});
