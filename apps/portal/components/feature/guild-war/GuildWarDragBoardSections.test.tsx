// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DroppableMemberColumn,
  GuildWarDragOverlayCard,
} from "./GuildWarDragBoardSections";

vi.mock("@dnd-kit/core", () => ({
  useDraggable: ({ disabled }: { disabled?: boolean }) => ({
    attributes: disabled ? { "aria-disabled": "true" } : {},
    listeners: {},
    setNodeRef: vi.fn(),
    isDragging: false,
  }),
  useDroppable: () => ({
    isOver: false,
    setNodeRef: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { username?: string; teamName?: string }) => {
      if (options?.username) return `${key} ${options.username}`;
      if (options?.teamName) return `${key} ${options.teamName}`;
      return key;
    },
  }),
}));

describe("GuildWarDragBoardSections", () => {
  it("keeps primary 44px actions visible and moves low-frequency controls into one menu", async () => {
    const { container } = render(
      <MantineProvider>
        <DroppableMemberColumn
          column={{
            containerId: "team-1",
            title: "Team One",
            locked: false,
            members: [{
              itemId: "member-1",
              userId: "user-1",
              username: "Alice",
              power: 1234,
              class: "Mage",
              subtitle: "",
            }],
          }}
          canDrag
          activeSearch=""
          toMemberDomId={(id) => id}
          onToggleLock={vi.fn()}
          onMoveTeam={vi.fn()}
          onCopyTeamMentions={vi.fn()}
          onDeleteTeam={vi.fn()}
          teamIndex={1}
          teamCount={3}
        />
      </MantineProvider>,
    );

    const actions = [
      "active.teamSetup.open",
      "active.teamCopied",
      "active.aria.columnActions",
    ].map((name) => screen.getByRole("button", { name }));

    actions.forEach((action) => {
      expect(action.getAttribute("style")).toContain(
        "--ai-size: calc(2.75rem * var(--mantine-scale))",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "active.aria.columnActions" }));
    /* hidden: true 的理由同 AvailabilityEditor.test.tsx：jsdom 没有布局，
       floating-ui 的 hide 中间件会异步给已打开的浮层盖上 display: none。 */
    const menuItems = await screen.findAllByRole("menuitem", { hidden: true });
    expect(menuItems.map((item) => item.textContent)).toEqual(expect.arrayContaining([
      "active.sort.username",
      "active.teamSetup.moveUp",
      "menu.team.delete",
    ]));
    expect(container.querySelector(".guild-war-member-card .guild-war-class-identity .class-icon")).not.toBeNull();
    expect(container.querySelector("p div")).toBeNull();
  });

  it("keeps the same dynamic class identity in the drag overlay", () => {
    const { container } = render(
      <MantineProvider>
        <GuildWarDragOverlayCard
          activeDragItem={{
            userId: "user-1",
            username: "Alice",
            power: 1234,
            class: "鸣金虹",
            subtitle: "",
          }}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("鸣金虹")).toBeInTheDocument();
    expect(container.querySelector(".guild-war-class-identity .class-icon")).not.toBeNull();
  });

  it.each([
    { canDrag: false, locked: false, scenario: "read-only access" },
    { canDrag: true, locked: true, scenario: "a locked team" },
  ])("keeps member details available during $scenario", async ({ canDrag, locked }) => {
    const user = userEvent.setup();
    const onOpenMember = vi.fn();

    render(
      <MantineProvider>
        <DroppableMemberColumn
          column={{
            containerId: "team-1",
            title: "Team One",
            locked,
            members: [{
              itemId: "member-1",
              userId: "user-1",
              username: "Alice",
              power: 1234,
              class: "Mage",
              subtitle: "",
            }],
          }}
          canDrag={canDrag}
          activeSearch=""
          toMemberDomId={(id) => id}
          onOpenMember={onOpenMember}
        />
      </MantineProvider>,
    );

    const member = screen.getByRole("button", {
      name: "active.aria.openMember Alice",
    });
    expect(member).not.toBeDisabled();
    expect(member).not.toHaveAttribute("aria-disabled", "true");

    await user.click(member);
    expect(onOpenMember).toHaveBeenCalledWith("user-1");
  });

  it("opens member details on a normal click without selecting the card", async () => {
    const user = userEvent.setup();
    const onOpenMember = vi.fn();
    const { container } = render(
      <MantineProvider>
        <DroppableMemberColumn
          column={{
            containerId: "pool",
            title: "Pool",
            locked: false,
            members: [{
              itemId: "member-1",
              userId: "user-1",
              username: "Alice",
              power: 1234,
              class: "Mage",
              subtitle: "",
            }],
          }}
          canDrag
          activeSearch=""
          toMemberDomId={(id) => id}
          onOpenMember={onOpenMember}
        />
      </MantineProvider>,
    );

    await user.click(screen.getByRole("button", {
      name: "active.aria.openMember Alice",
    }));

    expect(onOpenMember).toHaveBeenCalledWith("user-1");
    expect(container.querySelector(".guild-war-member-card--selected")).toBeNull();
  });

  it("allows keyboard users to start editing a team name", async () => {
    const user = userEvent.setup();

    render(
      <MantineProvider>
        <DroppableMemberColumn
          column={{
            containerId: "team-1",
            title: "Team One",
            locked: false,
            members: [],
          }}
          canDrag
          activeSearch=""
          toMemberDomId={(id) => id}
          onDraftNameChange={vi.fn()}
        />
      </MantineProvider>,
    );

    const editName = screen.getByRole("button", {
      name: "active.aria.editTeamName Team One",
    });
    editName.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("textbox", {
      name: "active.aria.teamName Team One",
    })).toBeInTheDocument();
  });
});
