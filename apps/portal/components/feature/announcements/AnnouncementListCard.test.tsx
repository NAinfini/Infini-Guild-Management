import type { AnnouncementSummary } from "@guild/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnnouncementListCard } from "./AnnouncementListCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key === "status.important" ? "Important" : key,
  }),
}));

const announcement = {
  id: "announcement-1",
  title: "Welcome to Infini Guild",
  pinned: false,
  status: "published",
  publish_at: null,
  expires_at: null,
  archived_at: null,
  created_by: "admin",
  updated_by: null,
  created_at: "2026-07-28T17:17:00.000Z",
  updated_at: "2026-07-28T17:17:00.000Z",
  author: {
    id: "admin",
    display_name: "Guild Keeper",
    avatar_media_id: null,
  },
} satisfies AnnouncementSummary;

describe("AnnouncementListCard", () => {
  it("uses visible row content as its accessible name without invalid expanded state", () => {
    render(
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
      />,
    );

    const row = screen.getByRole("button", { name: /Welcome to Infini Guild/ });
    expect(row).not.toHaveAttribute("aria-label");
    expect(row.querySelector("[aria-expanded]")).toBeNull();
  });

  it("shows the important badge, author, and publication time without crowding status metadata", () => {
    render(
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
      />,
    );

    const row = screen.getByRole("button", { name: /Welcome to Infini Guild/ });
    expect(row.querySelector(".announcement-item-title-text")).toHaveTextContent(
      "Welcome to Infini Guild",
    );
    const meta = row.querySelector(".announcement-item-meta");
    expect(meta).not.toBeNull();
    expect(meta?.querySelectorAll("svg").length).toBe(1);
    expect(screen.getByText("Important")).toBeInTheDocument();
    expect(screen.getByText("Guild Keeper")).toBeInTheDocument();
    expect(row.querySelector(".announcement-item-time")).toBeInTheDocument();
  });
});
