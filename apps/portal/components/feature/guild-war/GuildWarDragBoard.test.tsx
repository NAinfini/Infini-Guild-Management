import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const collisionMocks = vi.hoisted(() => ({
  closestCenter: vi.fn(() => [{ id: "keyboard-target" }]),
  pointerWithin: vi.fn(() => [{ id: "pointer-target" }]),
}));

vi.mock("@dnd-kit/core", async (importOriginal) => ({
  ...await importOriginal<typeof import("@dnd-kit/core")>(),
  closestCenter: collisionMocks.closestCenter,
  pointerWithin: collisionMocks.pointerWithin,
}));

import { GuildWarDragBoard } from "./GuildWarDragBoard";
import { guildWarCollisionDetection } from "./guildWarDragGeometry";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));

vi.mock("./GuildWarDragBoardSections", () => ({
  GuildWarDragBoardLayout: () => <div>board-layout</div>,
  GuildWarDragOverlayCard: () => null,
}));

const baseProps = {
  dragColumns: [
    {
      containerId: "pool",
      title: "Pool",
      locked: false,
      members: [],
    },
    {
      containerId: "team-1",
      title: "Team One",
      locked: false,
      members: [],
    },
  ],
  canDrag: true,
  emptyText: "empty",
  activeSearch: "",
  activeDragItem: null,
  toMemberDomId: (id: string) => id,
  sensors: [],
  onDragStart: vi.fn(),
  onDragCancel: vi.fn(),
  onDragEnd: vi.fn(),
};

describe("GuildWarDragBoard", () => {
  it("uses pointer collision for pointer drags and a keyboard-safe fallback", () => {
    const baseArgs = {
      active: { id: "member-1", data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      collisionRect: { width: 1, height: 1, top: 0, bottom: 1, left: 0, right: 1 },
      droppableContainers: [],
      droppableRects: new Map(),
    };

    expect(guildWarCollisionDetection({
      ...baseArgs,
      pointerCoordinates: { x: 1, y: 1 },
    } as Parameters<typeof guildWarCollisionDetection>[0])).toEqual([{ id: "pointer-target" }]);
    expect(collisionMocks.pointerWithin).toHaveBeenCalledOnce();

    expect(guildWarCollisionDetection({
      ...baseArgs,
      pointerCoordinates: null,
    } as Parameters<typeof guildWarCollisionDetection>[0])).toEqual([{ id: "keyboard-target" }]);
    expect(collisionMocks.closestCenter).toHaveBeenCalledOnce();
  });

  it("renders one direct-drag board and no totals of its own", () => {
    render(<GuildWarDragBoard {...baseProps} />);

    expect(screen.getAllByText("board-layout")).toHaveLength(1);

    // 人数和战力只在各自那一栏的表头上报。板子再挂一条汇总条就是同一批数字的第二个
    // 出处，两边算法一分岔就会互相打架，而它离要改的那一栏也最远。
    expect(screen.queryByText(/^active\.readiness\./)).not.toBeInTheDocument();
    expect(screen.queryByText("active.mobile.moveTo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "active.saveTeams" })).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("offers a next action when a selected war has no board yet", async () => {
    const onAddToPool = vi.fn();
    render(<GuildWarDragBoard {...baseProps} dragColumns={[]} onAddToPool={onAddToPool} />);

    await userEvent.click(screen.getByRole("button", { name: "active.addToPool" }));
    expect(onAddToPool).toHaveBeenCalledOnce();
  });
});
