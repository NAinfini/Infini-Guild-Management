// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { PERMISSIONS, type Event, type MemberProfile, type Permission, type User } from "@guild/shared";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
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

function createEvent(): Event {
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

function renderCardsView(memberCount = 9) {
  const event = createEvent();
  const members = Array.from({ length: memberCount }, (_, index) => createMember(index + 1));

  render(
    <MantineProvider>
      <EventCardsView
        events={[event]}
        cardsEmptyDescription="No events"
        canManage={false}
        canInteract={false}
        currentUserId={null}
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
        onLeaveEvent={() => {}}
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

  it("renders the first ten member avatars and an overflow count", () => {
    renderCardsView(12);

    expect(screen.getAllByTestId("member-avatar")).toHaveLength(10);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("uses a wrapping avatar layout without a fixed per-row column count", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/feature/events/EventCardsView.css"), "utf8");
    const avatarGridRule = css.match(/\.event-card__avatar-grid\s*\{[^}]*\}/)?.[0] ?? "";

    expect(avatarGridRule).toContain("display: flex");
    expect(avatarGridRule).toContain("flex-wrap: wrap");
    expect(avatarGridRule).not.toContain("grid-template-columns");
  });
});
