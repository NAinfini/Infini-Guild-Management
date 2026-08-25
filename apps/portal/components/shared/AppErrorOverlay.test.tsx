
import { render } from "@testing-library/react";
import i18n from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { portalToast } from "../../overlays";
import { AppErrorOverlay } from "./AppErrorOverlay";

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
  });

  it("does not show raw API conflict messages", () => {
    render(<AppErrorOverlay />);

    window.dispatchEvent(new CustomEvent("guild-api-conflict", {
      detail: {
        message: "Raw backend conflict text",
        errorCode: "CONFLICT",
        requestId: "req_123",
      },
    }));

    expect(portalToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Localized conflict title",
      message: expect.stringContaining("Localized conflict message"),
    }));
    expect(JSON.stringify(vi.mocked(portalToast).mock.calls)).not.toContain("Raw backend conflict text");
  });
});
