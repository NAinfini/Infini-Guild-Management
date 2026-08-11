import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from "./client";
import { resetAdminUserLoginLock } from "./mutations/admin";
import { fetchAdminUserLoginLock } from "./queries/admin";

const apiRequestMock = vi.mocked(apiRequest);

describe("admin login-lock API", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it("reads lock state and preserves the cleared pre-reset state", async () => {
    const state = {
      fail_count: 5,
      locked_until: "2026-08-09T12:01:00.000Z",
      is_locked: true,
      retry_after_seconds: 60,
    };
    apiRequestMock.mockResolvedValueOnce(state).mockResolvedValueOnce({ ok: true, ...state });

    await expect(fetchAdminUserLoginLock("user-1")).resolves.toEqual(state);
    const reset = await resetAdminUserLoginLock("user-1");

    expect(reset.retry_after_seconds).toBe(60);
    expect(reset.locked_until).toBe(state.locked_until);
    expect(apiRequestMock).toHaveBeenNthCalledWith(1, "/api/admin/users/user-1/login-lock");
    expect(apiRequestMock).toHaveBeenNthCalledWith(2, "/api/admin/users/user-1/reset-login-lock", {
      method: "POST",
      bodyJson: {},
    });
  });
});
