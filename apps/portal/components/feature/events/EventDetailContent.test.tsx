import { screen } from "@testing-library/react";
import { renderWithQueryClient as render } from "@portal/tests/query-harness";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EventDetailContent } from "./EventDetailContent";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "detail.membersWithCap") return `Members (${options?.count} / ${options?.capacity})`;
      if (key === "detail.members") return `Members (${options?.count})`;
      return key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("@portal/components/shared/MediaGallery", () => ({
  MediaGallery: ({ images }: { images: string[] }) => <div data-testid="media-gallery">{images.join(",")}</div>,
  buildMediaGalleryLabels: () => ({}),
}));

function renderContent(attachments: string[] = []) {
  return render(
    <>
      <EventDetailContent
        event={{
          id: "event-1",
          title: "Evening Mission",
          type: "social",
          start_at: "2099-03-12T16:00:00.000Z",
          end_at: "2099-03-12T18:00:00.000Z",
          description: "Bring supplies.",
          capacity: 10,
          attachments,
          class_quotas: [],
        } as never}
        members={[]}
        allUsers={[]}
        canManage={false}
        onAddParticipant={() => {}}
        onRemoveParticipant={() => {}}
      />
    </>,
  );
}

describe("EventDetailContent", () => {
  it("renders detail content directly without a business modal wrapper", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/events/EventDetailContent.tsx"),
      "utf8",
    );

    expect(source).not.toContain("<Modal");
    renderContent();

    expect(document.querySelector(".event-detail-content__layout")).toBeInTheDocument();
    expect(screen.getByText("Members (0 / 10)")).toBeVisible();
    expect(screen.getByText("Bring supplies.")).toBeVisible();
  });

  it("keeps every attachment in the gallery instead of selecting a cover item", () => {
    renderContent(["media-a", "media-b"]);

    expect(screen.getByTestId("media-gallery")).toHaveTextContent("media-a,media-b");
  });

  it("shows start and end as separate schedule cards", () => {
    const { container } = renderContent();
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/events/EventDetailContent.css"),
      "utf8",
    );

    expect(screen.getByText("field.startsAt")).toBeVisible();
    expect(screen.getByText("field.endsAt")).toBeVisible();
    expect(container.querySelectorAll(".event-detail-content__meta-card--time")).toHaveLength(2);
    expect(container.querySelector("time[datetime='2099-03-12T16:00:00.000Z']")).toBeVisible();
    expect(container.querySelector("time[datetime='2099-03-12T18:00:00.000Z']")).toBeVisible();
    expect(css).toMatch(/\.event-detail-content__time-value\s*{[^}]*display:\s*flex/s);
    expect(css).toMatch(/@media \(max-width: 47\.99em\)[^{]*{[\s\S]*grid-template-columns:\s*repeat\(2,/);
    expect(css).not.toMatch(/@media \(max-width: 39\.99em\)[\s\S]*event-detail-content__meta-grid/);
  });

  it("separates both work panes from the scenic background and caps the media stage", () => {
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/events/EventDetailContent.css"),
      "utf8",
    );

    expect(css).toMatch(/\.event-detail-content__pane\s*{[^}]*background:\s*var\(--plate-fill\)/s);
    expect(css).toMatch(/\.event-detail-content__pane\s*{[^}]*box-shadow:\s*var\(--edge-top\)/s);
    expect(css).toMatch(/\.event-detail-content__media\s+\.infini-media-gallery-slide\s*{[^}]*max-height:\s*420px/s);
    expect(css).toMatch(/\.event-detail-content__media\s+\.infini-media-gallery-slide\s*{[^}]*height:\s*clamp\([^,]+,[^,]+,\s*420px\)/s);
  });

  it("bounds the roster and scrolls members inside the list", () => {
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/events/EventDetailContent.css"),
      "utf8",
    );

    expect(css).toMatch(/\.event-detail-content__member-list\s*{[^}]*max-height:\s*(?!none)/s);
    expect(css).toMatch(/\.event-detail-content__member-list\s*{[^}]*overflow-y:\s*auto/s);
  });
});
