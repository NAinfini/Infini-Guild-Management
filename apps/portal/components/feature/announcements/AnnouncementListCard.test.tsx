import type { AnnouncementSummary } from "@guild/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { PortalThemeProvider } from "../../../providers/ThemeProvider";
import { AnnouncementListCard } from "./AnnouncementListCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { title?: string }) =>
      key === "aria.openAnnouncement" ? `Open ${options?.title}` : key,
  }),
}));

const announcement = {
  id: "announcement-1",
  title: "Welcome to Infini Guild",
  category: "announcement",
  view_count: 0,
  excerpt: "Join us for the next chapter of the guild.",
  preview_media_id: null,
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

function renderList(card: ReactElement) {
  return render(
    <PortalThemeProvider>
      {card}
    </PortalThemeProvider>,
  );
}

describe("AnnouncementListCard", () => {
  it("uses an explicit accessible name without invalid expanded state", () => {
    renderList(
      <AnnouncementListCard
          title="Announcement List"
          rows={[announcement]}
          canCreate={false}
          isLoading={false}
          isError={false}
          warningMessage=""
          onRetry={vi.fn()}
          emptyText=""
          onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("region", { name: "Announcement List" })).toHaveAttribute("data-slot", "card");
    const row = screen.getByRole("button", { name: /Welcome to Infini Guild/ });
    expect(row).toHaveAttribute("aria-label", "Open Welcome to Infini Guild");
    expect(row.querySelector("[aria-expanded]")).toBeNull();
  });

  it("shows the pinned state, category, author, and publication metadata", () => {
    renderList(
      <AnnouncementListCard
          title="Announcement List"
          rows={[{ ...announcement, pinned: true }]}
          canCreate={false}
          isLoading={false}
          isError={false}
          warningMessage=""
          onRetry={vi.fn()}
          emptyText=""
          onSelect={vi.fn()}
      />,
    );

    const row = screen.getByRole("button", { name: /Welcome to Infini Guild/ });
    expect(row.querySelector(".content-preview-card__title")).toHaveTextContent(
      "Welcome to Infini Guild",
    );
    const meta = row.querySelector(".content-preview-card__meta");
    expect(meta).not.toBeNull();
    expect(meta?.querySelectorAll("svg").length).toBe(1);
    expect(screen.getByText("status.pinned")).toBeInTheDocument();
    expect(screen.getByText("category.announcement")).toBeInTheDocument();
    expect(screen.getByText("Guild Keeper")).toBeInTheDocument();
    expect(screen.getByText("Join us for the next chapter of the guild.")).toBeInTheDocument();
    expect(row.querySelector(".content-preview-card__views")).toBeInTheDocument();
  });

  it("offers retry in an error empty state when the first list load fails", () => {
    const onRetry = vi.fn();
    renderList(
      <AnnouncementListCard
        title="Announcement List"
        rows={[]}
        canCreate={false}
        isLoading={false}
        isError
        warningMessage="Load failed"
        onRetry={onRetry}
        emptyText=""
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Load failed").closest(".empty-state")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps cached announcements visible and offers retry when refresh fails", () => {
    const onRetry = vi.fn();
    renderList(
      <AnnouncementListCard
        title="Announcement List"
        rows={[announcement]}
        canCreate={false}
        isLoading={false}
        isError
        warningMessage="Load failed"
        onRetry={onRetry}
        emptyText=""
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Open Welcome to Infini Guild" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
