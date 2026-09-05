import { type Event, type MemberProfile, type MemberSummary } from "@guild/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EventCardsView } from "./EventCardsView";
import { getParticipantActionDisabledReasonKey } from "./participant-action";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

vi.mock("../../shared/MemberRoleAvatar", () => ({
  MemberRoleAvatar: ({ user }: { user: MemberSummary }) => <span>{user.display_name}</span>,
}));


function event(overrides: Partial<Event> = {}): Event {
  return {
    id: "event-1",
    type: "weekly_mission",
    title: "Weekly Mission Alpha",
    description: "Primary weekly mission",
    start_at: "2026-08-30T16:00:00.000Z",
    end_at: "2099-08-30T18:00:00.000Z",
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
    class_quotas: [],
    series_id: null,
    is_series_parent: false,
    instance_date: null,
    created_at: "2026-08-30T12:00:00.000Z",
    updated_at: "2026-08-30T12:00:00.000Z",
    ...overrides,
  } as Event;
}

function member(id: string, name = id): { user: MemberSummary; profile: MemberProfile } {
  return {
    user: {
      id,
      display_name: name,
      role: "member",
      role_name: "Member",
      role_color: null,
      role_level: 1,
      is_active: true,
      deleted_at: null,
      created_at: "2026-08-30T12:00:00.000Z",
      updated_at: "2026-08-30T12:00:00.000Z",
      last_login_at: null,
    },
    profile: {
      user_id: id,
      power: 1000,
      classes: ["mage"],
      title_html: null,
      bio: null,
      avatar_media_id: null,
      images: [],
      audio_media_id: null,
      audio_name: null,
      video_urls: [],
      availability: null,
      vacation_start: null,
      vacation_end: null,
      notes: null,
      created_at: "2026-08-30T12:00:00.000Z",
      updated_at: "2026-08-30T12:00:00.000Z",
    },
  };
}

type ViewOptions = {
  events?: Event[];
  members?: Array<{ user: MemberSummary; profile: MemberProfile }>;
  canCreate?: boolean;
  canEdit?: boolean;
  canArchive?: boolean;
  canDelete?: boolean;
  canInteract?: boolean;
  currentUserId?: string | null;
  pendingIds?: ReadonlySet<string>;
  hasAnyFilter?: boolean;
  onResetFilters?: () => void;
  onCreateEvent?: () => void;
  onLeaveEvent?: (eventId: string) => void;
  onOpenEvent?: (value: Event) => void;
};

function renderCards(options: ViewOptions = {}) {
  const events = options.events ?? [event()];
  const members = options.members ?? [];
  const eventMembersMap = new Map(events.map((item) => [item.id, members]));
  render(
    <EventCardsView
      events={events}
      cardsEmptyDescription="No events"
      canCreate={options.canCreate ?? false}
      canEdit={options.canEdit ?? false}
      canArchive={options.canArchive ?? false}
      canDelete={options.canDelete ?? false}
      canInteract={options.canInteract ?? false}
      currentUserId={options.currentUserId ?? null}
      eventType={undefined}
      archivedOnly={false}
      pinnedOnly={false}
      lockedOnly={false}
      hasAnyFilter={options.hasAnyFilter}
      eventFlags={new Map()}
      eventMembersMap={eventMembersMap}
      allUsers={members}
      participantPendingEventIds={options.pendingIds ?? new Set()}
      onResetFilters={options.onResetFilters ?? vi.fn()}
      onCreateEvent={options.onCreateEvent ?? vi.fn()}
      onJoinEvent={vi.fn()}
      onLeaveEvent={options.onLeaveEvent ?? vi.fn()}
      onCopyMentions={vi.fn()}
      onEditEvent={vi.fn()}
      onDuplicateEvent={vi.fn()}
      onTogglePinEvent={vi.fn()}
      onToggleLockEvent={vi.fn()}
      onArchiveEvent={vi.fn()}
      onUnarchiveEvent={vi.fn()}
      onDeleteEvent={vi.fn()}
      onOpenEvent={options.onOpenEvent ?? vi.fn()}
    />,
  );
}

describe("EventCardsView", () => {
  it("exposes event titles as semantic headings", () => {
    renderCards();

    expect(screen.getByRole("heading", { level: 2, name: "Weekly Mission Alpha" })).toBeInTheDocument();
  });

  const actionCases: Array<[string, ViewOptions, string[], string[]]> = [
    ["create", { canCreate: true }, ["menu.duplicate"], ["menu.edit", "menu.archive", "menu.delete"]],
    ["archive", { canArchive: true }, ["menu.archive"], ["menu.edit", "menu.unarchive", "menu.delete"]],
    ["edit", { canEdit: true, events: [event({ archived_at: "2026-08-30T20:00:00.000Z" })] }, ["menu.edit", "menu.unarchive"], ["menu.archive", "menu.delete"]],
    ["delete", { canDelete: true }, ["menu.delete"], ["menu.edit", "menu.archive", "menu.duplicate"]],
  ];

  it.each(actionCases)("shows only the independently granted %s action", async (_name, options, visible, hidden) => {
    renderCards(options);
    await userEvent.click(screen.getByRole("button", { name: "menu.actions" }));
    for (const label of visible) expect(await screen.findByText(label)).toBeInTheDocument();
    for (const label of hidden) expect(screen.queryByText(label)).not.toBeInTheDocument();
  });

  it("disables only the event whose participant mutation is pending", () => {
    const first = event({ id: "event-1", title: "First" });
    const second = event({ id: "event-2", title: "Second" });
    renderCards({
      events: [first, second],
      canInteract: true,
      currentUserId: "viewer",
      pendingIds: new Set([first.id]),
    });

    const buttons = screen.getAllByRole("button", { name: /button\.join/i });
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeEnabled();
  });

  it("renders role quotas from the signed-up members", () => {
    renderCards({
      events: [event({
        capacity: 2,
        class_quotas: [{
          tag_id: "mage",
          label: "Mage",
          class_ids: ["mage"],
          required: 1,
          one_time: false,
        }],
      })],
      members: [member("user-1")],
    });

    expect(screen.getByRole("group", { name: "quota.roles.label" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Mage" })).toHaveAttribute("aria-valuenow", "1");
  });

  it("leaves an active event for its signed-up member but blocks archived leave actions", async () => {
    const onLeaveEvent = vi.fn();
    const signedUp = [member("user-1")];
    const { rerender } = render(
      <EventCardsView
        events={[event()]}
        cardsEmptyDescription="No events"
        canCreate={false}
        canEdit={false}
        canArchive={false}
        canDelete={false}
        canInteract
        currentUserId="user-1"
        eventType={undefined}
        archivedOnly={false}
        pinnedOnly={false}
        lockedOnly={false}
        eventFlags={new Map()}
        eventMembersMap={new Map([["event-1", signedUp]])}
        allUsers={signedUp}
        participantPendingEventIds={new Set()}
        onResetFilters={vi.fn()}
        onCreateEvent={vi.fn()}
        onJoinEvent={vi.fn()}
        onLeaveEvent={onLeaveEvent}
        onCopyMentions={vi.fn()}
        onEditEvent={vi.fn()}
        onDuplicateEvent={vi.fn()}
        onTogglePinEvent={vi.fn()}
        onToggleLockEvent={vi.fn()}
        onArchiveEvent={vi.fn()}
        onUnarchiveEvent={vi.fn()}
        onDeleteEvent={vi.fn()}
        onOpenEvent={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /button\.leave/i }));
    expect(onLeaveEvent).toHaveBeenCalledWith("event-1");

    rerender(
      <EventCardsView
        events={[event({ archived_at: "2026-08-30T20:00:00.000Z" })]}
        cardsEmptyDescription="No events"
        canCreate={false}
        canEdit={false}
        canArchive={false}
        canDelete={false}
        canInteract
        currentUserId="user-1"
        eventType={undefined}
        archivedOnly={false}
        pinnedOnly={false}
        lockedOnly={false}
        eventFlags={new Map()}
        eventMembersMap={new Map([["event-1", signedUp]])}
        allUsers={signedUp}
        participantPendingEventIds={new Set()}
        onResetFilters={vi.fn()}
        onCreateEvent={vi.fn()}
        onJoinEvent={vi.fn()}
        onLeaveEvent={onLeaveEvent}
        onCopyMentions={vi.fn()}
        onEditEvent={vi.fn()}
        onDuplicateEvent={vi.fn()}
        onTogglePinEvent={vi.fn()}
        onToggleLockEvent={vi.fn()}
        onArchiveEvent={vi.fn()}
        onUnarchiveEvent={vi.fn()}
        onDeleteEvent={vi.fn()}
        onOpenEvent={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /button\.leave/i })).toBeDisabled();
  });

  it("caps visible member avatars and exposes the remaining participant count", () => {
    renderCards({ members: Array.from({ length: 15 }, (_, index) => member(`user-${index + 1}`)) });

    expect(screen.getAllByText(/^user-\d+$/)).toHaveLength(5);
    expect(document.querySelector(".member-avatar-stack__overflow")).toHaveTextContent("+10");
  });

  it("offers the useful empty-state action for filters and creation", async () => {
    const onResetFilters = vi.fn();
    const onCreateEvent = vi.fn();
    const { rerender } = render(
      <EventCardsView
        events={[]}
        cardsEmptyDescription="No matching events"
        canCreate
        canEdit={false}
        canArchive={false}
        canDelete={false}
        canInteract={false}
        currentUserId={null}
        eventType="social"
        archivedOnly={false}
        pinnedOnly={false}
        lockedOnly={false}
        hasAnyFilter
        eventFlags={new Map()}
        eventMembersMap={new Map()}
        allUsers={[]}
        participantPendingEventIds={new Set()}
        onResetFilters={onResetFilters}
        onCreateEvent={onCreateEvent}
        onJoinEvent={vi.fn()}
        onLeaveEvent={vi.fn()}
        onCopyMentions={vi.fn()}
        onEditEvent={vi.fn()}
        onDuplicateEvent={vi.fn()}
        onTogglePinEvent={vi.fn()}
        onToggleLockEvent={vi.fn()}
        onArchiveEvent={vi.fn()}
        onUnarchiveEvent={vi.fn()}
        onDeleteEvent={vi.fn()}
        onOpenEvent={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "card.resetFilters" }));
    expect(onResetFilters).toHaveBeenCalledOnce();

    rerender(
      <EventCardsView
        events={[]}
        cardsEmptyDescription="No matching events"
        canCreate
        canEdit={false}
        canArchive={false}
        canDelete={false}
        canInteract={false}
        currentUserId={null}
        eventType={undefined}
        archivedOnly={false}
        pinnedOnly={false}
        lockedOnly={false}
        hasAnyFilter={false}
        eventFlags={new Map()}
        eventMembersMap={new Map()}
        allUsers={[]}
        participantPendingEventIds={new Set()}
        onResetFilters={onResetFilters}
        onCreateEvent={onCreateEvent}
        onJoinEvent={vi.fn()}
        onLeaveEvent={vi.fn()}
        onCopyMentions={vi.fn()}
        onEditEvent={vi.fn()}
        onDuplicateEvent={vi.fn()}
        onTogglePinEvent={vi.fn()}
        onToggleLockEvent={vi.fn()}
        onArchiveEvent={vi.fn()}
        onUnarchiveEvent={vi.fn()}
        onDeleteEvent={vi.fn()}
        onOpenEvent={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "button.create" }));
    expect(onCreateEvent).toHaveBeenCalledOnce();
  });

  it("gives state explanations a keyboard-focusable accessible name", () => {
    renderCards({ events: [event({ pinned: true })] });

    expect(screen.getByRole("img", { name: "tooltip.pinned.title" })).toHaveAttribute("tabindex", "0");
  });

  it("prioritizes the actionable reason for a disabled participant action", () => {
    const base = { isArchived: false, hasEnded: false, signupLocked: false, isFull: false, isJoined: false, pending: false };

    expect(getParticipantActionDisabledReasonKey({ ...base, isArchived: true, hasEnded: true })).toBe("button.disabled.archived");
    expect(getParticipantActionDisabledReasonKey({ ...base, hasEnded: true, signupLocked: true })).toBe("button.disabled.ended");
    expect(getParticipantActionDisabledReasonKey({ ...base, signupLocked: true, isFull: true })).toBe("button.disabled.locked");
    expect(getParticipantActionDisabledReasonKey({ ...base, isFull: true, pending: true })).toBe("button.disabled.full");
    expect(getParticipantActionDisabledReasonKey({ ...base, pending: true })).toBe("button.disabled.pending");
  });

  it.each([
    ["archived", event({ archived_at: "2026-08-30T20:00:00.000Z" })],
    ["ended", event({ end_at: "2000-01-01T00:00:00.000Z" })],
    ["locked", event({ signup_locked: true })],
  ])("disables leaving an %s event", (_state, item) => {
    renderCards({ events: [item], members: [member("user-1")], canInteract: true, currentUserId: "user-1" });

    expect(screen.getByRole("button", { name: /button\.leave/i })).toBeDisabled();
  });

  it("opens poll details from the vote action", async () => {
    const onOpenEvent = vi.fn();
    renderCards({
      events: [event({
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
      } as Partial<Event>)],
      canInteract: true,
      currentUserId: "user-1",
      onOpenEvent,
    });

    await userEvent.click(screen.getByRole("button", { name: /poll\.vote/i }));
    expect(onOpenEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "event-1" }));
  });
});
