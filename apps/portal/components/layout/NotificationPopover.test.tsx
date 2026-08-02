// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NotificationPopover } from "./NotificationPopover";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

const entry = {
  id: "notification-1",
  title: "A deliberately long notification title",
  message: "A notification body that must remain readable in the narrow overlay.",
  type: "event_created",
  readAt: null,
  occurredAt: "2026-07-29T12:00:00.000Z",
};

function renderPopover(onClose = vi.fn()) {
  render(
    <MantineProvider>
      <NotificationPopover
        user={{ id: "user-1" }}
        pushHasUnread
        notificationAnnouncementsHasNew={false}
        displayPushEntries={[entry]}
        onClose={onClose}
        onClearHistory={vi.fn()}
        onEntryClick={vi.fn()}
      />
    </MantineProvider>,
  );

  return onClose;
}

describe("NotificationPopover", () => {
  it("uses a viewport-safe width and bounded scrolling contract", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/layout/NotificationPopover.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/layout/NotificationPopover.module.css"),
      "utf8",
    );

    expect(source).not.toContain("width={420}");
    expect(styles).toMatch(/width:\s*min\(26\.25rem,\s*calc\(100vw - var\(--space-xl\)\)\)/);
    expect(styles).toMatch(/max-height:\s*min\(/);
    expect(styles).toContain("overflow-y: auto");
  });

  it("opens from the keyboard, closes with Escape, and returns focus", async () => {
    const user = userEvent.setup();
    const onClose = renderPopover();
    const trigger = screen.getByRole("button", { name: "label.notificationsUnread" });

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText(entry.title)).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
      expect(trigger).toHaveFocus();
    });
  });
});
