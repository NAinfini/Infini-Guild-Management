// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { PERMISSIONS, type Event, type MemberProfile, type Permission, type User } from "@guild/shared";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { calculateEventCardAvatarSize } from "./EventCardAvatarStrip";
import { EventCardsView } from "./EventCardsView";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../../shared/MemberRoleAvatar", () => ({
  MemberRoleAvatar: ({ user }: { user: User }) => <div data-testid="member-avatar">{user.username}</div>,
}));

const now = "2026-05-07T16:11:00.000Z";
const noPermissions = Object.fromEntries(PERMISSIONS.map((permission) => [permission, false])) as Record<Permission, boolean>;

function createEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "event-1",
    type: "weekly_mission",
    title: "Weekly Mission Alpha",
    description: "Primary weekly mission",
    start_at: now,
    end_at: "2026-05-07T18:11:00.000Z",
    capacity: 10,
    pinned: false,
    signup_locked: false,
    auto_archive: false,
    auto_archived: false,
    visible_at: null,
    archived_at: null,
    created_by: "user-1",
    recurrence_rule: null,
    attachments: [],
    series_id: null,
    is_series_parent: false,
    instance_date: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  } as unknown as Event;
}

function createMember(index: number): { user: User; profile: MemberProfile } {
  const userId = `user-${index}`;

  return {
    user: {
      id: userId,
      username: `member-${index}`,
      role: "member",
      permissions: noPermissions,
      is_active: true,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    },
    profile: {
      id: `profile-${index}`,
      user_id: userId,
      power: 1000,
      classes: ["mage"],
      title_html: null,
      bio: null,
      avatar_key: null,
      images: [],
      audio_key: null,
      video_urls: [],
      availability: null,
      vacation_start: null,
      vacation_end: null,
      notes: null,
      created_at: now,
      updated_at: now,
    },
  };
}

function renderCardsView(
  memberCount = 9,
  options: {
    eventOverrides?: Partial<Event>;
    canInteract?: boolean;
    currentUserId?: string | null;
    onLeaveEvent?: (eventId: string) => void;
    onVotePoll?: (eventId: string, optionIds: string[]) => void;
  } = {},
) {
  const event = createEvent(options.eventOverrides);
  const members = Array.from({ length: memberCount }, (_, index) => createMember(index + 1));

  render(
    <MantineProvider>
      <EventCardsView
        events={[event]}
        cardsEmptyDescription="No events"
        canManage={false}
        canInteract={options.canInteract ?? false}
        currentUserId={options.currentUserId ?? null}
        eventType={undefined}
        archivedOnly={false}
        pinnedOnly={false}
        lockedOnly={false}
        focusedEventId={null}
        eventFlags={new Map()}
        eventMembersMap={new Map([[event.id, members]])}
        allUsers={members}
        createPending={false}
        updatePending={false}
        archivePending={false}
        joinPending={false}
        leavePending={false}
        onResetFilters={() => {}}
        onCreateEvent={() => {}}
        onJoinEvent={() => {}}
        onLeaveEvent={options.onLeaveEvent ?? (() => {})}
        onCopyMentions={() => {}}
        onEditEvent={() => {}}
        onDuplicateEvent={() => {}}
        onTogglePinEvent={() => {}}
        onToggleLockEvent={() => {}}
        onArchiveEvent={() => {}}
        onUnarchiveEvent={() => {}}
        onDeleteEvent={() => {}}
        onAddParticipant={() => {}}
        onRemoveParticipant={() => {}}
        onVotePoll={options.onVotePoll}
      />
    </MantineProvider>,
  );
}

describe("EventCardsView", () => {
  it("shows player count in the event card header without progress percentage", () => {
    renderCardsView();

    expect(screen.queryByText("90%")).not.toBeInTheDocument();

    const capacityText = screen.getByText("9 / 10");
    expect(capacityText.closest(".event-card__header")).not.toBeNull();
  });

  it("groups event state indicators separately from the event type header", () => {
    renderCardsView(9, {
      eventOverrides: {
        pinned: true,
        signup_locked: true,
      },
    });

    expect(document.querySelector(".event-card__status-rail")).not.toBeNull();
    expect(document.querySelector(".event-card__header-left .event-card__status-rail")).toBeNull();
  });

  it("renders nine member avatars and an overflow count when more than ten members signed up", () => {
    renderCardsView(12);

    expect(screen.getAllByTestId("member-avatar")).toHaveLength(9);
    expect(screen.getByText("+3")).toBeInTheDocument();
  });

  it("renders ten member avatars without overflow when exactly ten members signed up", () => {
    renderCardsView(10);

    expect(screen.getAllByTestId("member-avatar")).toHaveLength(10);
    expect(screen.queryByText(/\+\d+/)).not.toBeInTheDocument();
  });

  it("renders an empty member placeholder when nobody has signed up", () => {
    renderCardsView(0);

    expect(screen.queryByTestId("member-avatar")).not.toBeInTheDocument();
    expect(document.querySelector(".event-card__avatar-placeholder")).not.toBeNull();
  });

  it("keeps event card avatars on one row", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/feature/events/EventCardsView.css"), "utf8");
    const avatarGridRule = css.match(/\.event-card__avatar-grid\s*\{[^}]*\}/)?.[0] ?? "";

    expect(avatarGridRule).toContain("display: flex");
    expect(avatarGridRule).toContain("flex-wrap: nowrap");
    expect(avatarGridRule).not.toContain("grid-template-columns");
  });

  it("allows event card avatar badges to render outside the avatar circle", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/feature/events/EventCardsView.css"), "utf8");
    const avatarGridRule = css.match(/\.event-card__avatar-grid\s*\{[^}]*\}/)?.[0] ?? "";

    expect(avatarGridRule).toContain("overflow: visible");
  });

  it("uses larger event card avatar slots to reduce unused row space", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/feature/events/EventCardsView.css"), "utf8");
    const overflowRule = css.match(/\.event-card__avatar-overflow\s*\{[^}]*\}/)?.[0] ?? "";

    expect(overflowRule).toContain("width: var(--event-card-avatar-size, 36px)");
    expect(overflowRule).toContain("height: var(--event-card-avatar-size, 36px)");
  });

  it("shrinks event card avatars to fit narrow card widths", () => {
    expect(calculateEventCardAvatarSize(420, 10)).toBe(36);
    expect(calculateEventCardAvatarSize(310, 10)).toBe(28);
    expect(calculateEventCardAvatarSize(230, 10)).toBe(24);
  });

  it("disables leaving an archived event from the card", () => {
    const onLeaveEvent = vi.fn();
    renderCardsView(1, {
      eventOverrides: { archived_at: "2026-05-08T16:11:00.000Z" },
      canInteract: true,
      currentUserId: "user-1",
      onLeaveEvent,
    });

    const leaveButton = screen.getByRole("button", { name: /button\.leave/i });

    expect(leaveButton).toBeDisabled();
    expect(onLeaveEvent).not.toHaveBeenCalled();
  });

  it("shows poll status without card voting controls", () => {
    const onVotePoll = vi.fn();
    renderCardsView(0, {
      eventOverrides: {
        type: "poll",
        capacity: null,
        poll: {
          results_visibility: "after_vote",
          show_voter_names: false,
          has_voted: false,
          can_vote: true,
          options: [
            { id: "opt-1", label: "Raid", vote_count: 0, voter_ids: [], voted_by_me: false },
            { id: "opt-2", label: "Dungeon", vote_count: 0, voter_ids: [], voted_by_me: false },
          ],
        },
      } as Partial<Event>,
      canInteract: true,
      currentUserId: "user-1",
      onVotePoll,
    });

    expect(screen.getByText("poll.status.open")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Raid/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Dungeon/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /poll\.vote/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /button\.join/i })).not.toBeInTheDocument();
    expect(onVotePoll).not.toHaveBeenCalled();
  });
});
