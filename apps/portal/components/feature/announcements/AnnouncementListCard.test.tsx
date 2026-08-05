// @vitest-environment jsdom
import type { Announcement } from "@guild/shared";
import { PortalThemeProvider } from "@portal/providers/ThemeProvider";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnnouncementListCard } from "./AnnouncementListCard";

const announcement = {
  id: "announcement-1",
  title: "Welcome to Infini Guild",
  body_json: "{}",
  pinned: false,
  status: "published",
  publish_at: null,
  expires_at: null,
  archived_at: null,
  created_by: "admin",
  updated_by: null,
  created_at: "2026-07-28T17:17:00.000Z",
  updated_at: "2026-07-28T17:17:00.000Z",
} satisfies Announcement;

describe("AnnouncementListCard", () => {
  it("uses visible row content as its accessible name without invalid expanded state", () => {
    render(
      <PortalThemeProvider>
        <AnnouncementListCard
          title="Announcement List"
          rows={[announcement]}
          selectedId={announcement.id}
          canEdit
          canCreate={false}
          announcementsLastSeenAt={null}
          isLoading={false}
          isError={false}
          warningMessage=""
          emptyText=""
          onSelect={vi.fn()}
        />
      </PortalThemeProvider>,
    );

    const row = screen.getByRole("button", { name: /Welcome to Infini Guild/ });
    expect(row).not.toHaveAttribute("aria-label");
    expect(row.querySelector("[aria-expanded]")).toBeNull();
  });

  it("keeps the title flexible and pin/status metadata in a stable trailing region", () => {
    render(
      <PortalThemeProvider>
        <AnnouncementListCard
          title="Announcement List"
          rows={[{ ...announcement, pinned: true }]}
          selectedId={announcement.id}
          canEdit
          canCreate={false}
          announcementsLastSeenAt={null}
          isLoading={false}
          isError={false}
          warningMessage=""
          emptyText=""
          onSelect={vi.fn()}
        />
      </PortalThemeProvider>,
    );

    const row = screen.getByRole("button", { name: /Welcome to Infini Guild/ });
    expect(row.querySelector(".announcement-item-title-text")).toHaveTextContent(
      "Welcome to Infini Guild",
    );
    const meta = row.querySelector(".announcement-item-meta");
    expect(meta).not.toBeNull();
    expect(meta?.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
  });
});
