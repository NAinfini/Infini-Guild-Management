import type { Editor } from "@tiptap/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTipTapEditorLabels } from "./tiptap-meta";
import { TipTapEditorContextMenu } from "./TipTapEditorContextMenu";

function createEditorMock() {
  const run = vi.fn(() => true);
  const focus = vi.fn(() => true);
  const chain = new Proxy<Record<string, unknown>>({}, {
    get: (_target, property) => (
      property === "run"
        ? run
        : () => chain
    ),
  });

  return {
    editor: {
      chain: () => chain,
      commands: { focus, setDetails: vi.fn() },
    } as unknown as Editor,
    focus,
    run,
  };
}

function renderMenu() {
  const editorMock = createEditorMock();
  const onClose = vi.fn();
  const onInsertLink = vi.fn();
  const onInsertImage = vi.fn();
  const onInsertVideo = vi.fn();

  render(
    <TipTapEditorContextMenu
      editor={editorMock.editor}
      labels={buildTipTapEditorLabels((key) => key)}
      position={{ x: 120, y: 80 }}
      onClose={onClose}
      onInsertLink={onInsertLink}
      onInsertImage={onInsertImage}
      onInsertVideo={onInsertVideo}
    />,
  );

  return {
    ...editorMock,
    onClose,
    onInsertLink,
    onInsertImage,
    onInsertVideo,
  };
}

describe("TipTapEditorContextMenu", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const left = Number.parseFloat(this.style.left) || 0;
      const top = Number.parseFloat(this.style.top) || 0;
      return {
        x: left,
        y: top,
        top,
        left,
        right: left + 120,
        bottom: top + 32,
        width: 120,
        height: 32,
        toJSON: () => ({}),
      } as DOMRect;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses menu semantics and roving keyboard focus, then returns focus on Escape", async () => {
    const user = userEvent.setup();
    const { focus, onClose } = renderMenu();

    expect(await screen.findByRole("menu", { hidden: true })).toBeInTheDocument();
    const undo = screen.getByRole("menuitem", { name: "toolbar.undo", hidden: true });
    const redo = screen.getByRole("menuitem", { name: "toolbar.redo", hidden: true });
    undo.focus();

    await user.keyboard("{ArrowDown}");
    expect(redo).toHaveFocus();
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
      expect(focus).toHaveBeenCalledOnce();
    });
  });

  it("opens the text-color submenu from the keyboard", async () => {
    const user = userEvent.setup();
    renderMenu();

    const textColor = await screen.findByRole("menuitem", {
      name: "toolbar.textColor",
      hidden: true,
    });
    expect(textColor).toHaveAttribute("aria-haspopup", "menu");
    textColor.focus();
    await user.keyboard("{ArrowRight}");

    expect(textColor).toHaveAttribute("aria-expanded", "true");
    const swatch = await screen.findByRole("menuitem", {
      name: "toolbar.textColor #1f6feb",
      hidden: true,
    });
    expect(swatch.closest('[role="menu"]')).not.toBeNull();
    expect(screen.getAllByRole("menu", { hidden: true })).toHaveLength(2);
  });

  it("keeps dialog commands wired while the menu owns closing", async () => {
    const user = userEvent.setup();
    const { onClose, onInsertLink } = renderMenu();

    await user.click(await screen.findByRole("menuitem", { name: "toolbar.link" }));

    expect(onInsertLink).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

});
