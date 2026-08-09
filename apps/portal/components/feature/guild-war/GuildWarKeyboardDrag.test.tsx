// @vitest-environment jsdom
import {
  DndContext,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DroppableMemberColumn } from "./GuildWarDragBoardSections";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { username?: string }) =>
      options?.username ? `${key} ${options.username}` : key,
  }),
}));

const rects = new Map<string, DOMRect>([
  ["member:user-1", new DOMRect(10, 20, 120, 44)],
  ["member:user-2", new DOMRect(210, 20, 120, 44)],
]);

function KeyboardDragHarness({ onDragEnd }: { onDragEnd: (event: DragEndEvent) => void }) {
  const sensors = useSensors(useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  }));
  const [activeId, setActiveId] = useState<string | null>(null);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event) => setActiveId(String(event.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={(event) => {
        setActiveId(null);
        onDragEnd(event);
      }}
    >
      <div style={{ display: "flex" }} data-active-id={activeId ?? ""}>
        {[
          { containerId: "pool", itemId: "member:user-1", userId: "user-1", username: "Alice" },
          { containerId: "team-1", itemId: "member:user-2", userId: "user-2", username: "Bob" },
        ].map((entry) => (
          <DroppableMemberColumn
            key={entry.containerId}
            column={{
              containerId: entry.containerId,
              title: entry.containerId,
              locked: false,
              members: [{
                itemId: entry.itemId,
                userId: entry.userId,
                username: entry.username,
                power: 100,
                class: "",
                subtitle: "",
              }],
            }}
            canDrag
            activeSearch=""
            toMemberDomId={(itemId) => itemId}
          />
        ))}
      </div>
    </DndContext>
  );
}

describe("guild war keyboard dragging", () => {
  it("moves between member cards with Space, ArrowRight, Space", async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return rects.get(this.id) ?? originalGetBoundingClientRect.call(this);
    };

    try {
      const onDragEnd = vi.fn();
      const user = userEvent.setup();
      render(
        <MantineProvider>
          <KeyboardDragHarness onDragEnd={onDragEnd} />
        </MantineProvider>,
      );

      const alice = screen.getByRole("button", {
        name: "active.aria.dragMember Alice",
      });
      alice.focus();
      await user.keyboard("[Space]");
      await waitFor(() => {
        expect(document.querySelector("[data-active-id]")).toHaveAttribute(
          "data-active-id",
          "member:user-1",
        );
      });
      await user.keyboard("[ArrowRight]");
      await user.keyboard("[Space]");

      expect(onDragEnd).toHaveBeenCalledOnce();
      expect(onDragEnd.mock.calls[0]?.[0].active.id).toBe("member:user-1");
      expect(onDragEnd.mock.calls[0]?.[0].over?.id).toBe("member:user-2");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });
});
