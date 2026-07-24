import { ApiRequestError, apiRequest } from "../api/client";
import { fetchMemberOnboarding } from "./SiteConfigService";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    apiRequest: vi.fn(),
  };
});

const apiRequestMock = vi.mocked(apiRequest);

describe("SiteConfigService", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it("treats disabled member onboarding as unavailable content", async () => {
    apiRequestMock.mockRejectedValueOnce(new ApiRequestError("Onboarding is disabled", {
      status: 404,
      errorCode: "NOT_FOUND",
    }));

    await expect(fetchMemberOnboarding()).resolves.toBeNull();
  });
});
