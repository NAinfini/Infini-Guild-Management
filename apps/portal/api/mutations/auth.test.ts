// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from "../client";
import { register } from "./auth";

const apiRequestMock = vi.mocked(apiRequest);

describe("register", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it("uses the registration response as the authenticated session without a second request", async () => {
    const response = {
      user: { id: "user-1", display_name: "new_member" },
      profile: { user_id: "user-1" },
    };
    apiRequestMock.mockResolvedValueOnce(response as never);

    await expect(register("INVITE-1", {
      login_name: "new_login",
      display_name: "new_member",
      password: "password123456789",
      confirmPassword: "password123456789",
    })).resolves.toBe(response);

    expect(apiRequestMock).toHaveBeenCalledOnce();
    expect(apiRequestMock).toHaveBeenCalledWith("/api/auth/register/INVITE-1", {
      method: "POST",
      bodyJson: {
        login_name: "new_login",
        display_name: "new_member",
        password: "password123456789",
        confirmPassword: "password123456789",
      },
    });
  });
});
