// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EventDetailModal } from "./EventDetailModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
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

vi.mock("@portal/components/shared/MemberRoleAvatar", () => ({
  MemberRoleAvatar: ({ user }: { user: { username: string } }) => (
    <div data-testid="poll-voter-avatar">{user.username.slice(0, 1).toUpperCase()}</div>
  ),
}));

describe("EventDetailModal", () => {
  it("does not show a fallback title while the detail modal is closing", () => {
    const source = readFileSync(resolve(process.cwd(), "apps/portal/components/feature/events/EventDetailModal.tsx"), "utf8");

    expect(source).not.toContain('title={event?.title ?? t("detail.title")}');

    render(
      <MantineProvider>
        <EventDetailModal
          event={null}
          members={[]}
          allUsers={[]}
          canManage={false}
          onClose={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
        />
      </MantineProvider>,
    );

    expect(screen.queryByText("detail.title")).not.toBeInTheDocument();
  });

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

  it("unmounts content immediately when the modal closes", () => {
    const event = {
      id: "event-closing",
      title: "Closing Event",
      type: "social",
      start_at: "2026-03-12T16:00:00.000Z",
      end_at: null,
      description: "Should not linger after close",
      capacity: null,
      attachments: [],
    } as never;

    const { rerender } = render(
      <MantineProvider>
        <EventDetailModal
          event={event}
          members={[]}
          allUsers={[]}
          canManage={false}
          onClose={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
        />
      </MantineProvider>,
    );

    rerender(
      <MantineProvider>
        <EventDetailModal
          event={null}
          members={[]}
          allUsers={[]}
          canManage={false}
          onClose={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
        />
      </MantineProvider>,
    );

    expect(screen.queryByText("Closing Event")).not.toBeInTheDocument();
    expect(screen.queryByText("Should not linger after close")).not.toBeInTheDocument();
  });

  it("lets users vote in poll detail and still shows voter breakdown", async () => {
    const user = userEvent.setup();
    const onVotePoll = vi.fn();

    render(
      <MantineProvider>
        <EventDetailModal
          event={{
            id: "event-1",
            title: "Next activity?",
            type: "poll",
            start_at: "2026-06-12T16:00:00.000Z",
            end_at: "2026-06-12T18:00:00.000Z",
            description: null,
            capacity: null,
            attachments: [],
            poll: {
              results_visibility: "after_vote",
              show_voter_names: false,
              has_voted: false,
              can_vote: true,
              options: [
                { id: "opt-1", label: "Raid", vote_count: 2, voter_ids: ["user-1", "user-2"], voted_by_me: true },
                { id: "opt-2", label: "Dungeon", vote_count: 0, voter_ids: [], voted_by_me: false },
              ],
            },
          } as never}
          members={[]}
          allUsers={[
            { user: { id: "user-1", username: "member-1" }, profile: {} },
            { user: { id: "user-2", username: "member-2" }, profile: {} },
          ] as never}
          canManage={false}
          currentUserId="user-1"
          onClose={() => {}}
          onJoin={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
          onVotePoll={onVotePoll}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("Raid")).toBeInTheDocument();
    expect(screen.getByText("Dungeon")).toBeInTheDocument();
    expect(document.querySelector(".event-detail-modal__poll-result-board")).toBeInTheDocument();
    expect(document.querySelectorAll(".event-detail-modal__poll-result-row")).toHaveLength(2);
    expect(document.querySelectorAll(".event-detail-modal__poll-result-row[role='checkbox']")).toHaveLength(2);
    expect(document.querySelector(".event-detail-modal__poll-choice .mantine-Checkbox-input")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".event-detail-modal__poll-voters")).toHaveLength(1);
    expect(screen.getByText("poll.detail.noVotes")).toBeInTheDocument();
    expect(screen.getAllByTestId("poll-voter-avatar")).toHaveLength(2);
    expect(screen.getByText("member-1")).toBeInTheDocument();
    expect(screen.getByText("member-2")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Raid/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: /Dungeon/i })).toHaveAttribute("aria-checked", "false");
    await user.click(screen.getByRole("checkbox", { name: /Dungeon/i }));
    expect(screen.getByRole("checkbox", { name: /Dungeon/i })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: /poll\.vote/i }));

    expect(onVotePoll).toHaveBeenCalledWith("event-1", ["opt-1", "opt-2"]);
    expect(screen.queryByRole("button", { name: /button\.join/i })).not.toBeInTheDocument();
  });
});
