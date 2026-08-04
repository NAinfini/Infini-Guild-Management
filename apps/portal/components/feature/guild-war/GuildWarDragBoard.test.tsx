// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
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

import {
  GuildWarDragBoard,
  guildWarCollisionDetection,
} from "./GuildWarDragBoard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));

vi.mock("./GuildWarDragBoardSections", () => ({
  GuildWarDragBoardLayout: ({ readinessContent }: { readinessContent?: React.ReactNode }) => (
    <div>
      board-layout
      {readinessContent}
    </div>
  ),
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

  it("uses one direct-drag board with only the three useful readiness totals", () => {
    render(
      <MantineProvider>
        <GuildWarDragBoard
          {...baseProps}
          teamsDirty
          saveTeamsPending
        />
      </MantineProvider>,
    );

    expect(screen.getByText("board-layout")).toBeInTheDocument();
    expect(screen.getByText("active.readiness.title")).toBeInTheDocument();
    expect(screen.getByText("active.readiness.assigned")).toBeInTheDocument();
    expect(screen.getByText("active.readiness.pool")).toBeInTheDocument();
    expect(screen.getByText("active.readiness.squads")).toBeInTheDocument();
    expect(screen.queryByText("active.readiness.locked")).not.toBeInTheDocument();
    expect(screen.queryByText("active.readiness.absent")).not.toBeInTheDocument();
    expect(screen.queryByText("active.readiness.selected")).not.toBeInTheDocument();
    expect(screen.queryByText("active.mobile.moveTo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "active.saveTeams" })).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("offers a next action when a selected war has no board yet", async () => {
    const onAddToPool = vi.fn();
    render(
      <MantineProvider>
        <GuildWarDragBoard
          {...baseProps}
          dragColumns={[]}
          onAddToPool={onAddToPool}
        />
      </MantineProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "active.addToPool" }));
    expect(onAddToPool).toHaveBeenCalledOnce();
  });
});
