import { fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient as render } from "@portal/tests/query-harness";
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
    t: (key: string, options?: { display_name?: string; teamName?: string }) => {
      if (options?.display_name) return `${key} ${options.display_name}`;
      if (options?.teamName) return `${key} ${options.teamName}`;
      return key;
    },
  }),
}));

describe("GuildWarDragBoardSections", () => {
  it("keeps primary actions visible and moves low-frequency controls into one menu", async () => {
    const { container } = render(
      <DroppableMemberColumn
          column={{
            containerId: "team-1",
            title: "Team One",
            locked: false,
            members: [{
              itemId: "member-1",
              userId: "user-1",
              display_name: "Alice",
              power: 1234,
              class: "Mage",
              subtitle: "",
              avatarMediaId: null,
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
      />,
    );

    const actions = [
      "active.teamSetup.open",
      "active.teamCopied",
      "active.aria.columnActions",
    ].map((name) => screen.getByRole("button", { name }));

    actions.forEach((action) => {
      expect(action).toBeVisible();
    });

    fireEvent.click(screen.getByRole("button", { name: "active.aria.columnActions" }));
    /* hidden: true 的理由同 AvailabilityEditor.test.tsx：jsdom 没有布局，
       floating-ui 的 hide 中间件会异步给已打开的浮层盖上 display: none。 */
    const menuItems = await screen.findAllByRole("menuitem", { hidden: true });
    expect(menuItems.map((item) => item.textContent)).toEqual(expect.arrayContaining([
      "active.sort.display_name",
      "active.teamSetup.moveUp",
      "menu.team.delete",
    ]));
    expect(container.querySelector(".guild-war-member-card .guild-war-class-identity .class-icon")).not.toBeNull();
    expect(container.querySelector("p div")).toBeNull();
  });

  it("keeps the same dynamic class identity in the drag overlay", () => {
    const { container } = render(
      <GuildWarDragOverlayCard
          activeDragItem={{
            userId: "user-1",
            display_name: "Alice",
            power: 1234,
            class: "鸣金虹",
            subtitle: "",
            avatarMediaId: null,
          }}
      />,
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
      <DroppableMemberColumn
          column={{
            containerId: "team-1",
            title: "Team One",
            locked,
            members: [{
              itemId: "member-1",
              userId: "user-1",
              display_name: "Alice",
              power: 1234,
              class: "Mage",
              subtitle: "",
              avatarMediaId: null,
            }],
          }}
          canDrag={canDrag}
          activeSearch=""
          toMemberDomId={(id) => id}
          onOpenMember={onOpenMember}
      />,
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
      <DroppableMemberColumn
          column={{
            containerId: "pool",
            title: "Pool",
            locked: false,
            members: [{
              itemId: "member-1",
              userId: "user-1",
              display_name: "Alice",
              power: 1234,
              class: "Mage",
              subtitle: "",
              avatarMediaId: null,
            }],
          }}
          canDrag
          activeSearch=""
          toMemberDomId={(id) => id}
          onOpenMember={onOpenMember}
      />,
    );

    await user.click(screen.getByRole("button", {
      name: "active.aria.openMember Alice",
    }));

    expect(onOpenMember).toHaveBeenCalledWith("user-1");
    expect(container.querySelector(".guild-war-member-card--selected")).toBeNull();
  });

  it("opens the team editor from the column head", async () => {
    const user = userEvent.setup();
    const onEditTeam = vi.fn();

    render(
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
          onEditTeam={onEditTeam}
      />,
    );

    await user.click(screen.getByRole("button", { name: "active.teamSetup.edit" }));

    expect(onEditTeam).toHaveBeenCalledWith("team-1");
  });
});
