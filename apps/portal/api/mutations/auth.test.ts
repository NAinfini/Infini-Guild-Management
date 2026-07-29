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
      user: { id: "user-1", username: "new-member" },
      profile: { id: "profile-1", user_id: "user-1" },
    };
    apiRequestMock.mockResolvedValueOnce(response as never);

    await expect(register("INVITE-1", {
      username: "new-member",
      password: "password123",
      confirmPassword: "password123",
    })).resolves.toBe(response);

    expect(apiRequestMock).toHaveBeenCalledOnce();
    expect(apiRequestMock).toHaveBeenCalledWith("/api/auth/register/INVITE-1", {
      method: "POST",
      bodyJson: {
        username: "new-member",
        password: "password123",
        confirmPassword: "password123",
      },
    });
  });
});
