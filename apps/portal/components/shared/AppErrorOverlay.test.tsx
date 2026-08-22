
import { notifications } from "@mantine/notifications";
import { render } from "@testing-library/react";
import i18n from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorOverlay } from "./AppErrorOverlay";

vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },
}));

describe("AppErrorOverlay", () => {
  beforeEach(async () => {
    vi.mocked(notifications.show).mockClear();
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
    vi.mocked(notifications.show).mockClear();
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

    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({
      title: "Localized conflict title",
      message: expect.stringContaining("Localized conflict message"),
    }));
    expect(JSON.stringify(vi.mocked(notifications.show).mock.calls)).not.toContain("Raw backend conflict text");
  });
});
