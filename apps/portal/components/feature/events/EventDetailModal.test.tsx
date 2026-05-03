// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import type { ButtonHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { EventDetailModal } from "./EventDetailModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../../shared/PortalActionButton", () => ({
  PortalActionButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@portal/components/shared/MediaGallery", () => ({
  MediaGallery: ({
    images,
    resolveMediaUrl,
  }: {
    images: string[];
    resolveMediaUrl?: (key: string) => string;
  }) => (
    <div data-testid="media-gallery">
      {images.map((image) => (
        <span key={image}>{resolveMediaUrl ? resolveMediaUrl(image) : image}</span>
      ))}
    </div>
  ),
  buildMediaGalleryLabels: () => ({}),
}));

describe("EventDetailModal", () => {
  it("resolves raw event attachment keys to the event image endpoint", () => {
    const attachmentKey = "events/p0UhTp1BApaAKsJbVHOiW/images/1773067314787_kKZOKY3Mzi7f2y6458J3l";

    render(
      <MantineProvider>
        <EventDetailModal
          event={{
            id: "event-1",
            title: "Updated Social Event",
            type: "social",
            start_at: "2026-03-12T16:00:00.000Z",
            end_at: null,
            description: null,
            capacity: null,
            attachments: [attachmentKey],
          } as never}
          members={[]}
          allUsers={[]}
          canManage={false}
          onClose={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
        />
      </MantineProvider>,
    );

    const expectedUrl = new URL("/api/events/image", window.location.origin);
    expectedUrl.searchParams.set("key", attachmentKey);

    expect(screen.getByText(expectedUrl.toString())).toBeInTheDocument();
  });
});
