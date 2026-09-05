import type { ReactNode } from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageGridEditor } from "./ImageGridEditor";

const harness = vi.hoisted(() => ({
  reduced: false,
  item: null as null | {
    children: ReactNode;
    onDragEnd: () => void;
    layout: "position";
    transition?: { duration: number };
    dragMomentum: boolean;
    style: { x: { get: () => number; set: (value: number) => void; jump: (value: number) => void } };
  },
}));

vi.mock("@portal/hooks/useReducedMotionPreference", () => ({
  useReducedMotionPreference: () => harness.reduced,
}));

vi.mock("motion/react", async (importOriginal) => {
  const motion = await importOriginal<typeof import("motion/react")>();
  return {
    ...motion,
    Reorder: {
      Group: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
      Item: (props: NonNullable<typeof harness.item>) => {
        harness.item = props;
        return <li>{props.children}</li>;
      },
    },
  };
});

function grid() {
  return <ImageGridEditor items={[{ id: "portrait" }]} maxImages={2} onReorder={vi.fn()} />;
}

beforeEach(() => {
  harness.reduced = false;
  harness.item = null;
});

describe("ImageGridEditor reduced motion", () => {
  it("keeps pointer dragging but returns to rest immediately on release", () => {
    harness.reduced = true;
    render(grid());
    const item = harness.item!;
    expect(item.transition).toEqual({ duration: 0 });
    expect(item.dragMomentum).toBe(false);
    item.style.x.set(60);
    act(() => item.onDragEnd());
    expect(item.style.x.get()).toBe(0);
  });

  it("clears an existing offset when reduced motion becomes effective", () => {
    const { rerender } = render(grid());
    expect(harness.item!.layout).toBe("position");
    expect(harness.item!.dragMomentum).toBe(true);
    harness.item!.style.x.set(45);
    const jump = vi.spyOn(harness.item!.style.x, "jump");
    harness.reduced = true;
    rerender(grid());
    expect(jump).toHaveBeenCalledWith(0);
    expect(harness.item!.style.x.get()).toBe(0);
  });
});
