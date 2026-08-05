// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PERMISSIONS, type Event, type MemberProfile, type Permission, type User } from "@guild/shared";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EventCardsView } from "./EventCardsView";
import { getParticipantActionDisabledReasonKey } from "./participant-action";

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
    class_quotas: [],
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
        participantPendingEventIds={new Set()}
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
  it("uses semantic headings for event titles", () => {
    renderCardsView();

    expect(
      screen.getByRole("heading", { level: 2, name: "Weekly Mission Alpha" }),
    ).toBeInTheDocument();
  });

  it("shows signup progress on a card without class quotas", () => {
    renderCardsView(3, { eventOverrides: { capacity: 10, class_quotas: [] } });

    const progress = screen.getByRole("progressbar", { name: "quota.generic.label" });
    expect(progress).toHaveAttribute("aria-valuenow", "3");
    expect(progress).toHaveAttribute("aria-valuemax", "10");
    expect(document.querySelector(".quota-bar__role-count")).toBeNull();
    expect(screen.getAllByText("3/10")).toHaveLength(1);
  });

  it.each(["light", "dark"] as const)(
    "only disables the signup action for the event with a pending participant mutation in the %s theme",
    (colorScheme) => {
      const firstEvent = createEvent({
        id: "event-1",
        title: "Weekly Mission Alpha",
        end_at: "2099-05-07T18:11:00.000Z",
      });
      const secondEvent = createEvent({
        id: "event-2",
        title: "Weekly Mission Beta",
        end_at: "2099-05-07T18:11:00.000Z",
      });

      render(
        <MantineProvider forceColorScheme={colorScheme}>
          <EventCardsView
            events={[firstEvent, secondEvent]}
            cardsEmptyDescription="No events"
            canManage={false}
            canInteract
            currentUserId="user-99"
            eventType={undefined}
            archivedOnly={false}
            pinnedOnly={false}
            lockedOnly={false}
            focusedEventId={null}
            eventFlags={new Map()}
            eventMembersMap={new Map()}
            allUsers={[]}
            participantPendingEventIds={new Set([firstEvent.id])}
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

      const signupButtons = screen.getAllByRole("button", { name: /button\.join/i });
      expect(signupButtons[0]).toBeDisabled();
      expect(signupButtons[1]).toBeEnabled();
    },
  );

  it("offers one context-aware next action in an empty result", async () => {
    const onResetFilters = vi.fn();
    const onCreateEvent = vi.fn();
    const baseEmptyProps = {
      events: [],
      cardsEmptyDescription: "No matching events",
      canInteract: false,
      currentUserId: null,
      archivedOnly: false,
      pinnedOnly: false,
      lockedOnly: false,
      focusedEventId: null,
      eventFlags: new Map<string, "NEW" | "UPDATED">(),
      eventMembersMap: new Map(),
      allUsers: [],
      participantPendingEventIds: new Set<string>(),
      onResetFilters,
      onCreateEvent,
      onJoinEvent: vi.fn(),
      onLeaveEvent: vi.fn(),
      onCopyMentions: vi.fn(),
      onEditEvent: vi.fn(),
      onDuplicateEvent: vi.fn(),
      onTogglePinEvent: vi.fn(),
      onToggleLockEvent: vi.fn(),
      onArchiveEvent: vi.fn(),
      onUnarchiveEvent: vi.fn(),
      onDeleteEvent: vi.fn(),
      onAddParticipant: vi.fn(),
      onRemoveParticipant: vi.fn(),
    };
    const { rerender } = render(
      <MantineProvider>
        <EventCardsView
          {...baseEmptyProps}
          canManage
          eventType="social"
          hasAnyFilter
        />
      </MantineProvider>,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "card.resetFilters" }));
    expect(onResetFilters).toHaveBeenCalledOnce();

    rerender(
      <MantineProvider>
        <EventCardsView
          {...baseEmptyProps}
          canManage
          eventType={undefined}
          hasAnyFilter={false}
        />
      </MantineProvider>,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "button.create" }));
    expect(onCreateEvent).toHaveBeenCalledOnce();
  });

  it("gives status explanations a keyboard-focusable accessible name", () => {
    renderCardsView(1, {
      eventOverrides: { pinned: true },
    });

    expect(
      screen.getByRole("img", { name: "tooltip.pinned.title" }),
    ).toHaveAttribute("tabindex", "0");
  });

  it("prioritizes actionable signup-disabled reasons", () => {
    const base = {
      isArchived: false,
      hasEnded: false,
      signupLocked: false,
      isFull: false,
      isJoined: false,
      pending: false,
    };

    expect(getParticipantActionDisabledReasonKey({
      ...base,
      isArchived: true,
      hasEnded: true,
      signupLocked: true,
      isFull: true,
      pending: true,
    })).toBe("button.disabled.archived");
    expect(getParticipantActionDisabledReasonKey({
      ...base,
      hasEnded: true,
      signupLocked: true,
      isFull: true,
      pending: true,
    })).toBe("button.disabled.ended");
    expect(getParticipantActionDisabledReasonKey({
      ...base,
      isJoined: true,
      hasEnded: true,
    })).toBe("button.disabled.ended");
    expect(getParticipantActionDisabledReasonKey({
      ...base,
      signupLocked: true,
      isFull: true,
      pending: true,
    })).toBe("button.disabled.locked");
    expect(getParticipantActionDisabledReasonKey({
      ...base,
      isJoined: true,
      signupLocked: true,
    })).toBe("button.disabled.locked");
    expect(getParticipantActionDisabledReasonKey({
      ...base,
      isFull: true,
      pending: true,
    })).toBe("button.disabled.full");
    expect(getParticipantActionDisabledReasonKey({
      ...base,
      pending: true,
    })).toBe("button.disabled.pending");
    expect(getParticipantActionDisabledReasonKey(base)).toBeNull();
  });

  it("shows player count as a capacity pill in the header band", () => {
    renderCardsView();

    expect(screen.queryByText("90%")).not.toBeInTheDocument();

    const capacityPill = document.querySelector(".event-card__capacity");
    expect(capacityPill).not.toBeNull();
    expect(capacityPill!.textContent).toContain("9/10");
    expect(capacityPill).not.toHaveAttribute("data-capacity-state");
  });

  it("puts the stronger over-capacity signal on the header count", () => {
    renderCardsView(12);

    const capacityPill = document.querySelector(".event-card__capacity");
    expect(capacityPill).toHaveAttribute("data-capacity-state", "over");
    expect(capacityPill).toHaveTextContent("12/10");
    expect(screen.getAllByText("12/10")).toHaveLength(1);

    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/events/EventCardsView.css"),
      "utf8",
    );
    const overRule = css.match(
      /\.event-card__capacity\[data-capacity-state="over"\]\s*\{[^}]*\}/,
    )?.[0] ?? "";
    expect(overRule).toContain("color: var(--status-danger)");
    expect(overRule).toContain("background: color-mix");
  });

  it("shows unlimited capacity as text without adding a second attendance count", () => {
    renderCardsView(3, { eventOverrides: { capacity: null, class_quotas: [] } });

    expect(document.querySelector(".event-card__capacity")).toHaveTextContent("3/∞");
    expect(screen.getByText("quota.generic.unlimited")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(document.querySelector(".quota-bar__progress")).toBeNull();
  });

  it("keeps the 390px header shrinkable and uses a compact mobile density", () => {
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/events/EventCardsView.css"),
      "utf8",
    );
    const headerRule = css.match(/\.event-card__header\s*\{[^}]*\}/)?.[0] ?? "";
    const headerLeftRule = css.match(/\.event-card__header-left\s*\{[^}]*\}/)?.[0] ?? "";

    expect(headerRule).toContain("min-width: 0");
    expect(headerLeftRule).toContain("flex: 1 1 auto");
    expect(css).toContain("@media (max-width: 30rem)");
    expect(css).toMatch(
      /@media \(max-width: 30rem\)[\s\S]*\.event-card__header\s*\{[^}]*gap:\s*4px/,
    );
    expect(css).toMatch(
      /@media \(max-width: 30rem\)[\s\S]*\.event-card__status-icon\s*\{[^}]*width:\s*18px[^}]*height:\s*18px/,
    );
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

  it("caps the avatar stack at five and counts the rest in a +N badge", () => {
    renderCardsView(15);

    expect(screen.getAllByTestId("member-avatar")).toHaveLength(5);
    expect(document.querySelector(".member-avatar-stack__overflow")?.textContent).toBe("+10");
  });

  it("renders an empty member placeholder when nobody has signed up", () => {
    renderCardsView(0);

    expect(screen.queryByTestId("member-avatar")).not.toBeInTheDocument();
    expect(document.querySelector(".member-avatar-stack__placeholder")).not.toBeNull();
  });

  it("keeps event card avatars on one row", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/shared/MemberAvatarStack.css"), "utf8");
    const stackRule = css.match(/\.member-avatar-stack\s*\{[^}]*\}/)?.[0] ?? "";

    expect(stackRule).toContain("display: flex");
    expect(stackRule).toContain("flex-wrap: nowrap");
    expect(stackRule).not.toContain("grid-template-columns");
  });

  it("keeps adjacent interactive avatars at least 24px apart", () => {
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/shared/MemberAvatarStack.css"),
      "utf8",
    );
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/shared/MemberAvatarStack.tsx"),
      "utf8",
    );

    const avatarSize = Number(source.match(/const AVATAR_SIZE = (\d+);/)?.[1]);
    const overlapRatio = Number(
      css.match(/margin-left:\s*calc\(var\(--member-avatar-stack-size\) \* -([0-9.]+)\)/)?.[1],
    );

    expect(avatarSize).toBeGreaterThan(0);
    expect(overlapRatio).toBeLessThanOrEqual(0.25);
    expect(avatarSize * (1 - overlapRatio)).toBeGreaterThanOrEqual(24);
  });

  it("allows event card avatar badges to render outside the avatar circle", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/shared/MemberAvatarStack.css"), "utf8");
    const stackRule = css.match(/\.member-avatar-stack\s*\{[^}]*\}/)?.[0] ?? "";

    expect(stackRule).toContain("overflow: visible");
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
    expect(leaveButton.parentElement).toHaveAttribute("data-disabled-tooltip-target");
    expect(onLeaveEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["ended", { end_at: "2000-01-01T00:00:00.000Z" }],
    ["signup-locked", { end_at: "2099-12-31T23:59:59.000Z", signup_locked: true }],
  ])("disables leaving an %s event from the card", (_state, eventOverrides) => {
    renderCardsView(1, {
      eventOverrides,
      canInteract: true,
      currentUserId: "user-1",
    });

    expect(screen.getByRole("button", { name: /button\.leave/i })).toBeDisabled();
  });

  it("routes a poll card through one clear voting action", () => {
    const onVotePoll = vi.fn();
    renderCardsView(0, {
      eventOverrides: {
        type: "poll",
        capacity: null,
        end_at: "2099-12-31T23:59:59.000Z",
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

    expect(screen.queryByRole("checkbox", { name: /Raid/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Dungeon/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /poll\.vote/i })).toBeEnabled();
    /* 卡片只负责把人带到详情里投票，不在紧凑卡片中复制选项，也不显示不存在的报名入口。 */
    expect(screen.queryByRole("button", { name: /button\.join/i })).not.toBeInTheDocument();
    expect(onVotePoll).not.toHaveBeenCalled();
  });
});
