import type { Editor } from "@tiptap/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowBackUpIcon,
  ArrowForwardUpIcon,
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  StrikethroughIcon,
  LinkIcon,
  LinkOffIcon,
  CheckboxIcon,
  H1Icon,
  H2Icon,
  H3Icon,
  ListIcon,
  ListNumbersIcon,
  BlockquoteIcon,
  CodeIcon,
  TableIcon,
  ColumnInsertRightIcon,
  RowInsertBottomIcon,
  ColumnRemoveIcon,
  RowRemoveIcon,
  TableOffIcon,
  PhotoIcon,
  PaletteIcon,
  HighlightIcon,
  EraserIcon,
  SeparatorHorizontalIcon,
  PlayerPlayIcon,
  LayoutListIcon,
} from "@portal/components/icons";
import type { TipTapEditorLabels } from "./TipTapEditor";

const TEXT_COLORS = ["#1f6feb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#ec4899", "#0891b2", "#334155"];
const HIGHLIGHT_COLORS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecdd3", "#e9d5ff", "#fed7aa"];
const ICON_SIZE = 14;
const MENU_MARGIN = 8;

type TipTapEditorContextMenuProps = {
  editor: Editor;
  labels: TipTapEditorLabels;
  position: { x: number; y: number };
  onClose: () => void;
  onInsertLink: () => void;
  onInsertImage: () => void;
  onInsertVideo: () => void;
};

export function TipTapEditorContextMenu({
  editor,
  labels,
  position,
  onClose,
  onInsertLink,
  onInsertImage,
  onInsertVideo,
}: TipTapEditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let x = position.x;
    let y = position.y;
    if (x + rect.width > window.innerWidth - MENU_MARGIN) {
      x = window.innerWidth - rect.width - MENU_MARGIN;
    }
    if (y + rect.height > window.innerHeight - MENU_MARGIN) {
      y = window.innerHeight - rect.height - MENU_MARGIN;
    }
    if (x < MENU_MARGIN) x = MENU_MARGIN;
    if (y < MENU_MARGIN) y = MENU_MARGIN;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [position]);

  const run = (fn: () => void) => {
    fn();
    onClose();
  };

  return createPortal(
    <div
      className="infini-tiptap-context-backdrop"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        className="infini-tiptap-context-menu"
        style={{ left: position.x, top: position.y }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        {/* Undo / Redo */}
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().undo().run())}>
          <ArrowBackUpIcon size={ICON_SIZE} /> {labels.undo}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().redo().run())}>
          <ArrowForwardUpIcon size={ICON_SIZE} /> {labels.redo}
        </button>

        <div className="infini-tiptap-context-divider" />

        {/* Text formatting */}
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().toggleBold().run())}>
          <BoldIcon size={ICON_SIZE} /> {labels.bold}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().toggleItalic().run())}>
          <ItalicIcon size={ICON_SIZE} /> {labels.italic}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().toggleUnderline().run())}>
          <UnderlineIcon size={ICON_SIZE} /> {labels.underline}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().toggleStrike().run())}>
          <StrikethroughIcon size={ICON_SIZE} /> {labels.strike}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().unsetAllMarks().clearNodes().run())}>
          <EraserIcon size={ICON_SIZE} /> {labels.clearFormatting}
        </button>

        <div className="infini-tiptap-context-divider" />

        {/* Colors */}
        <div className="infini-tiptap-context-submenu-wrapper">
          <button type="button" className="infini-tiptap-context-item infini-tiptap-context-item--submenu">
            <PaletteIcon size={ICON_SIZE} /> {labels.textColor} <span className="infini-tiptap-context-chevron">▸</span>
          </button>
          <div className="infini-tiptap-context-submenu">
            <div className="infini-tiptap-color-grid">
              {TEXT_COLORS.map((c) => (
                <button key={c} type="button" className="infini-tiptap-color-swatch" style={{ background: c }} aria-label={`${labels.textColor} ${c}`} onClick={() => run(() => editor.chain().focus().setColor(c).run())} />
              ))}
            </div>
            <div className="infini-tiptap-context-divider" />
            <label className="infini-tiptap-color-custom">
              <span>{labels.customTextColor}</span>
              <input type="color" defaultValue={TEXT_COLORS[0]} onClick={(e) => e.stopPropagation()} onChange={(e) => editor.chain().focus().setColor(e.currentTarget.value).run()} />
            </label>
            <div className="infini-tiptap-context-divider" />
            <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().unsetColor().run())}>
              {labels.clearFormatting}
            </button>
          </div>
        </div>
        <div className="infini-tiptap-context-submenu-wrapper">
          <button type="button" className="infini-tiptap-context-item infini-tiptap-context-item--submenu">
            <HighlightIcon size={ICON_SIZE} /> {labels.highlight} <span className="infini-tiptap-context-chevron">▸</span>
          </button>
          <div className="infini-tiptap-context-submenu">
            <div className="infini-tiptap-color-grid">
              {HIGHLIGHT_COLORS.map((c) => (
                <button key={c} type="button" className="infini-tiptap-color-swatch" style={{ background: c }} aria-label={`${labels.highlight} ${c}`} onClick={() => run(() => editor.chain().focus().setHighlight({ color: c }).run())} />
              ))}
            </div>
            <div className="infini-tiptap-context-divider" />
            <label className="infini-tiptap-color-custom">
              <span>{labels.customHighlightColor}</span>
              <input type="color" defaultValue={HIGHLIGHT_COLORS[0]} onClick={(e) => e.stopPropagation()} onChange={(e) => editor.chain().focus().setHighlight({ color: e.currentTarget.value }).run()} />
            </label>
            <div className="infini-tiptap-context-divider" />
            <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().unsetHighlight().run())}>
              {labels.clearFormatting}
            </button>
          </div>
        </div>

        <div className="infini-tiptap-context-divider" />

        {/* Alignment */}
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().setTextAlign("left").run())}>
          <AlignLeftIcon size={ICON_SIZE} /> {labels.alignLeft}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().setTextAlign("center").run())}>
          <AlignCenterIcon size={ICON_SIZE} /> {labels.alignCenter}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().setTextAlign("right").run())}>
          <AlignRightIcon size={ICON_SIZE} /> {labels.alignRight}
        </button>

        <div className="infini-tiptap-context-divider" />

        {/* Links & Headings */}
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(onInsertLink)}>
          <LinkIcon size={ICON_SIZE} /> {labels.link}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().unsetLink().run())}>
          <LinkOffIcon size={ICON_SIZE} /> {labels.unlink}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}>
          <H1Icon size={ICON_SIZE} /> {labels.h1}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}>
          <H2Icon size={ICON_SIZE} /> {labels.h2}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().toggleHeading({ level: 3 }).run())}>
          <H3Icon size={ICON_SIZE} /> {labels.h3}
        </button>

        <div className="infini-tiptap-context-divider" />

        {/* Lists & blocks */}
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().toggleBulletList().run())}>
          <ListIcon size={ICON_SIZE} /> {labels.bullet}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().toggleOrderedList().run())}>
          <ListNumbersIcon size={ICON_SIZE} /> {labels.number}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().toggleTaskList().run())}>
          <CheckboxIcon size={ICON_SIZE} /> {labels.taskList}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().toggleBlockquote().run())}>
          <BlockquoteIcon size={ICON_SIZE} /> {labels.quote}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().toggleCodeBlock().run())}>
          <CodeIcon size={ICON_SIZE} /> {labels.code}
        </button>

        <div className="infini-tiptap-context-divider" />

        {/* Insert */}
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().setHorizontalRule().run())}>
          <SeparatorHorizontalIcon size={ICON_SIZE} /> {labels.divider}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(onInsertImage)}>
          <PhotoIcon size={ICON_SIZE} /> {labels.image}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(onInsertVideo)}>
          <PlayerPlayIcon size={ICON_SIZE} /> {labels.embedVideo}
        </button>
        <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => (editor.commands as unknown as { setDetails: () => void }).setDetails())}>
          <LayoutListIcon size={ICON_SIZE} /> {labels.details}
        </button>

        {/* Table submenu */}
        <div className="infini-tiptap-context-submenu-wrapper">
          <button type="button" className="infini-tiptap-context-item infini-tiptap-context-item--submenu">
            <TableIcon size={ICON_SIZE} /> {labels.table} <span className="infini-tiptap-context-chevron">▸</span>
          </button>
          <div className="infini-tiptap-context-submenu">
            <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().insertTable({ rows: 3, cols: 3 }).run())}>
              <TableIcon size={ICON_SIZE} /> {labels.table}
            </button>
            <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().addColumnAfter().run())}>
              <ColumnInsertRightIcon size={ICON_SIZE} /> {labels.addCol}
            </button>
            <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().addRowAfter().run())}>
              <RowInsertBottomIcon size={ICON_SIZE} /> {labels.addRow}
            </button>
            <div className="infini-tiptap-context-divider" />
            <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().deleteColumn().run())}>
              <ColumnRemoveIcon size={ICON_SIZE} /> {labels.delCol}
            </button>
            <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().deleteRow().run())}>
              <RowRemoveIcon size={ICON_SIZE} /> {labels.delRow}
            </button>
            <button type="button" className="infini-tiptap-context-item" onClick={() => run(() => editor.chain().focus().deleteTable().run())}>
              <TableOffIcon size={ICON_SIZE} /> {labels.delTable}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
