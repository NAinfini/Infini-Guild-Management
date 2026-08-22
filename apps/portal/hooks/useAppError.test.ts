// @vitest-environment node
import { notifications } from "@mantine/notifications";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiRequestError } from "../api/client";
import { presentAppError } from "./useAppError";

vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },
}));

describe("presentAppError", () => {
  beforeEach(() => {
    vi.mocked(notifications.show).mockClear();
  });

  it("uses the localized fallback for local Zod validation errors", () => {
    const schema = z.object({ site_name: z.string().min(1), onboarding: z.string().min(1) });
    const result = schema.safeParse({ site_name: "", onboarding: "" });
    if (result.success) throw new Error("Expected validation failure");

    presentAppError(result.error, "Localized site config save failed");

    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({
      message: "Localized site config save failed",
    }));
    expect(JSON.stringify(vi.mocked(notifications.show).mock.calls)).not.toContain("site_name");
    expect(JSON.stringify(vi.mocked(notifications.show).mock.calls)).not.toContain("Too small");
  });

  it("uses the localized fallback for API validation details", () => {
    presentAppError(new ApiRequestError("Invalid site config payload", {
      status: 400,
      errorCode: "VALIDATION_ERROR",
      details: {
        fieldErrors: {
          site_name: ["Too small: expected string to have >=1 characters"],
        },
      },
    }), "Localized site config save failed");

    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({
      message: "Localized site config save failed",
    }));
    expect(JSON.stringify(vi.mocked(notifications.show).mock.calls)).not.toContain("site_name");
    expect(JSON.stringify(vi.mocked(notifications.show).mock.calls)).not.toContain("Too small");
  });

  it("uses the localized fallback for API error messages", () => {
    presentAppError(new ApiRequestError("Raw backend failure text", {
      status: 500,
      errorCode: "SERVER_ERROR",
    }), "Localized operation failed");

    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({
      message: "Localized operation failed",
    }));
    expect(JSON.stringify(vi.mocked(notifications.show).mock.calls)).not.toContain("Raw backend failure text");
  });
});
