import { screen } from "@testing-library/react";
import { renderWithQueryClient as render } from "@portal/tests/query-harness";
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

function renderContent({
  attachments = [],
  participants = [],
  capacity = 10,
  memberIdentitiesUnavailable = false,
  currentUserId,
  onJoin,
}: {
  attachments?: string[];
  participants?: Array<{ id: string; event_id: string; user_id: string; joined_at: string }>;
  capacity?: number;
  memberIdentitiesUnavailable?: boolean;
  currentUserId?: string;
  onJoin?: (eventId: string) => void;
} = {}) {
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
          capacity,
          attachments,
          class_quotas: [],
          participants,
        } as never}
        members={[]}
        allUsers={[]}
        canManage={false}
        currentUserId={currentUserId}
        onJoin={onJoin}
        memberIdentitiesUnavailable={memberIdentitiesUnavailable}
        onAddParticipant={() => {}}
        onRemoveParticipant={() => {}}
      />
    </>,
  );
}

describe("EventDetailContent", () => {
  it("shows the member capacity and event description", () => {
    renderContent();

    expect(screen.getByText("Members (0 / 10)")).toBeVisible();
    expect(screen.getByText("Bring supplies.")).toBeVisible();
  });

  it("keeps every attachment in the gallery instead of selecting a cover item", () => {
    renderContent({ attachments: ["media-a", "media-b"] });

    expect(screen.getByTestId("media-gallery")).toHaveTextContent("media-a,media-b");
  });

  it("shows start and end as separate schedule cards", () => {
    renderContent();

    expect(screen.getByText("field.startsAt")).toBeVisible();
    expect(screen.getByText("field.endsAt")).toBeVisible();
    expect(screen.getAllByRole("time")).toHaveLength(2);
  });

  it("uses server participants for capacity while member identities are unavailable", () => {
    renderContent({
      capacity: 1,
      participants: [{
        id: "participant-1",
        event_id: "event-1",
        user_id: "member-1",
        joined_at: "2099-03-01T00:00:00.000Z",
      }],
      memberIdentitiesUnavailable: true,
      currentUserId: "viewer-1",
      onJoin: vi.fn(),
    });

    expect(screen.getByText("Members (1 / 1)")).toBeVisible();
    expect(screen.getByRole("button", { name: "button.full" })).toBeDisabled();
    expect(screen.queryByText("detail.noMembers")).not.toBeInTheDocument();
  });

});
