import {
  DndContext,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient as render } from "@portal/tests/query-harness";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DroppableMemberColumn } from "./GuildWarDragBoardSections";
import {
  guildWarCollisionDetection,
  guildWarKeyboardCoordinates,
  guildWarMeasuring,
} from "./guildWarDragGeometry";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { display_name?: string }) =>
      options?.display_name ? `${key} ${options.display_name}` : key,
  }),
}));

const rects = new Map<string, DOMRect>([
  ["member:user-1", new DOMRect(10, 20, 120, 44)],
  ["member:user-2", new DOMRect(210, 20, 120, 44)],
]);

function KeyboardDragHarness({ onDragEnd }: { onDragEnd: (event: DragEndEvent) => void }) {
  const sensors = useSensors(useSensor(KeyboardSensor, {
    coordinateGetter: guildWarKeyboardCoordinates,
  }));
  const [activeId, setActiveId] = useState<string | null>(null);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={guildWarCollisionDetection}
      measuring={guildWarMeasuring}
      onDragStart={(event) => setActiveId(String(event.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={(event) => {
        setActiveId(null);
        onDragEnd(event);
      }}
    >
      <div style={{ display: "flex" }} data-active-id={activeId ?? ""}>
        {[
          { containerId: "pool", itemId: "member:user-1", userId: "user-1", display_name: "Alice" },
          { containerId: "team-1", itemId: "member:user-2", userId: "user-2", display_name: "Bob" },
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
                display_name: entry.display_name,
                power: 100,
                class: "",
                subtitle: "",
                avatarMediaId: null,
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
    /* 列的投放区没有 id，量它就量它那一行：这两列各只有一个人，行在哪儿列就在哪儿。
       jsdom 一律返回全零矩形，不喂尺寸的话键盘找不到「右边那一列」。 */
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      const own = rects.get(this.id);
      if (own) return own;
      if (this.classList.contains("guild-war-column-card__body")) {
        const row = this.querySelector<HTMLElement>(".guild-war-member-card");
        const rowRect = row ? rects.get(row.id) : undefined;
        if (rowRect) return rowRect;
      }
      return originalGetBoundingClientRect.call(this);
    };

    try {
      const onDragEnd = vi.fn();
      const user = userEvent.setup();
      render(<KeyboardDragHarness onDragEnd={onDragEnd} />);

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
      // 落点是列，不是行：行不是投放目标，键盘和鼠标必须落到同一种目标上。
      expect(onDragEnd.mock.calls[0]?.[0].over?.id).toBe("container:team-1");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });
});
