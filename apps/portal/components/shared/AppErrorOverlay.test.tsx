
import { render } from "@testing-library/react";
import i18n from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { portalToast } from "../../overlays";
import { AppErrorOverlay } from "./AppErrorOverlay";
import { apiRequest } from "../../api/client";
import { presentAppError } from "../../hooks/useAppError";

vi.mock("../../overlays", () => ({ portalToast: vi.fn(() => true) }));

describe("AppErrorOverlay", () => {
  beforeEach(async () => {
    vi.mocked(portalToast).mockClear();
    if (!i18n.isInitialized) {
      await i18n.init({
        lng: "en",
        fallbackLng: "en",
        resources: {
          en: {
            common: {
              errors: {
                conflict: "Localized conflict message",
                conflictTitle: "Localized conflict title",
                codeLabel: "Code",
                requestLabel: "Request",
              },
            },
          },
        },
      });
    }
    await i18n.changeLanguage("en");
  });

  afterEach(() => {
    vi.mocked(portalToast).mockClear();
    vi.unstubAllGlobals();
  });

  it("reports a failed save conflict once, with localized text and request metadata", async () => {
    render(<AppErrorOverlay />);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: "Raw backend conflict text",
      error_code: "CONFLICT",
      request_id: "req_123",
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    await apiRequest("/api/wiki/articles/article-1", { method: "PATCH", bodyJson: { title: "Guide" } })
      .catch((error) => presentAppError(error, "Save failed"));

    expect(portalToast).toHaveBeenCalledTimes(1);
    expect(portalToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Localized conflict title",
      message: expect.stringContaining("Localized conflict message"),
    }));
    expect(JSON.stringify(vi.mocked(portalToast).mock.calls)).toContain("req_123");
    expect(JSON.stringify(vi.mocked(portalToast).mock.calls)).not.toContain("Raw backend conflict text");
  });

  it("reports a timed-out save instead of silently discarding its error", async () => {
    render(<AppErrorOverlay />);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")));

    await apiRequest("/api/wiki/articles/article-1", { method: "PATCH", bodyJson: { title: "Guide" } })
      .catch((error) => presentAppError(error, "Save failed"));

    expect(portalToast).toHaveBeenCalledTimes(1);
    expect(portalToast).toHaveBeenCalledWith(expect.objectContaining({
      message: "Request timed out. Please try again.",
      status: "error",
    }));
  });
});
