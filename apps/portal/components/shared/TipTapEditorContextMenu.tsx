import { Menu, Portal } from "@mantine/core";
import type { Editor } from "@tiptap/react";
import { useRef, type CSSProperties } from "react";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowBackUpIcon,
  ArrowForwardUpIcon,
  BlockquoteIcon,
  BoldIcon,
  CheckboxIcon,
  CodeIcon,
  ColumnInsertRightIcon,
  ColumnRemoveIcon,
  EraserIcon,
  H1Icon,
  H2Icon,
  H3Icon,
  HighlightIcon,
  ItalicIcon,
  LayoutListIcon,
  LinkIcon,
  LinkOffIcon,
  ListIcon,
  ListNumbersIcon,
  PaletteIcon,
  PhotoIcon,
  PlayerPlayIcon,
  RowInsertBottomIcon,
  RowRemoveIcon,
  SeparatorHorizontalIcon,
  StrikethroughIcon,
  TableIcon,
  TableOffIcon,
  UnderlineIcon,
} from "@portal/components/icons";
import type { TipTapEditorLabels } from "./tiptap-meta";

const TEXT_COLORS = ["#1f6feb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#ec4899", "#0891b2", "#334155"];
const HIGHLIGHT_COLORS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecdd3", "#e9d5ff", "#fed7aa"];
const ICON_SIZE = 14;
const CONTEXT_MENU_Z_INDEX = 1100;

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
  const returnFocusOnCloseRef = useRef(true);

  const handleClose = () => {
    const shouldReturnFocus = returnFocusOnCloseRef.current;
    returnFocusOnCloseRef.current = true;
    onClose();
    if (shouldReturnFocus) {
      window.requestAnimationFrame(() => editor.commands.focus());
    }
  };

  const runDialogAction = (action: () => void) => {
    returnFocusOnCloseRef.current = false;
    action();
  };

  return (
    <Menu
      opened
      onClose={handleClose}
      position="bottom-start"
      withinPortal
      shadow="md"
      width={220}
      zIndex={CONTEXT_MENU_Z_INDEX}
      returnFocus={false}
    >
      <Menu.Target>
        <span
          aria-hidden="true"
          style={{
            position: "fixed",
            left: position.x,
            top: position.y,
            width: 1,
            height: 1,
            pointerEvents: "none",
          }}
        />
      </Menu.Target>

      <Menu.Dropdown
        className="infini-tiptap-context-menu"
        aria-label={labels.moreFormatting}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <Menu.Item
          leftSection={<ArrowBackUpIcon size={ICON_SIZE} />}
          onClick={() => editor.chain().focus().undo().run()}
        >
          {labels.undo}
        </Menu.Item>
        <Menu.Item
          leftSection={<ArrowForwardUpIcon size={ICON_SIZE} />}
          onClick={() => editor.chain().focus().redo().run()}
        >
          {labels.redo}
        </Menu.Item>

        <Menu.Divider />

        <Menu.Item leftSection={<BoldIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().toggleBold().run()}>
          {labels.bold}
        </Menu.Item>
        <Menu.Item leftSection={<ItalicIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().toggleItalic().run()}>
          {labels.italic}
        </Menu.Item>
        <Menu.Item leftSection={<UnderlineIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          {labels.underline}
        </Menu.Item>
        <Menu.Item leftSection={<StrikethroughIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().toggleStrike().run()}>
          {labels.strike}
        </Menu.Item>
        <Menu.Item leftSection={<EraserIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
          {labels.clearFormatting}
        </Menu.Item>

        <Menu.Divider />

        <Menu.Sub>
          <Menu.Sub.Target>
            <Menu.Sub.Item leftSection={<PaletteIcon size={ICON_SIZE} />}>
              {labels.textColor}
            </Menu.Sub.Item>
          </Menu.Sub.Target>
          <Portal>
            <Menu.Sub.Dropdown w={180} style={{ zIndex: CONTEXT_MENU_Z_INDEX + 1 }}>
              <div className="infini-tiptap-color-grid">
                {TEXT_COLORS.map((color) => (
                  <Menu.Item
                    key={color}
                    className="infini-tiptap-color-swatch"
                    style={{ "--swatch-color": color } as CSSProperties}
                    aria-label={`${labels.textColor} ${color}`}
                    onClick={() => editor.chain().focus().setColor(color).run()}
                  />
                ))}
              </div>
              <Menu.Divider />
              <label className="infini-tiptap-color-custom">
                <span>{labels.customTextColor}</span>
                <input
                  type="color"
                  defaultValue={TEXT_COLORS[0]}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => editor.chain().focus().setColor(event.currentTarget.value).run()}
                />
              </label>
              <Menu.Divider />
              <Menu.Item onClick={() => editor.chain().focus().unsetColor().run()}>
                {labels.clearFormatting}
              </Menu.Item>
            </Menu.Sub.Dropdown>
          </Portal>
        </Menu.Sub>

        <Menu.Sub>
          <Menu.Sub.Target>
            <Menu.Sub.Item leftSection={<HighlightIcon size={ICON_SIZE} />}>
              {labels.highlight}
            </Menu.Sub.Item>
          </Menu.Sub.Target>
          <Portal>
            <Menu.Sub.Dropdown w={180} style={{ zIndex: CONTEXT_MENU_Z_INDEX + 1 }}>
              <div className="infini-tiptap-color-grid">
                {HIGHLIGHT_COLORS.map((color) => (
                  <Menu.Item
                    key={color}
                    className="infini-tiptap-color-swatch"
                    style={{ "--swatch-color": color } as CSSProperties}
                    aria-label={`${labels.highlight} ${color}`}
                    onClick={() => editor.chain().focus().setHighlight({ color }).run()}
                  />
                ))}
              </div>
              <Menu.Divider />
              <label className="infini-tiptap-color-custom">
                <span>{labels.customHighlightColor}</span>
                <input
                  type="color"
                  defaultValue={HIGHLIGHT_COLORS[0]}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => editor.chain().focus().setHighlight({ color: event.currentTarget.value }).run()}
                />
              </label>
              <Menu.Divider />
              <Menu.Item onClick={() => editor.chain().focus().unsetHighlight().run()}>
                {labels.clearFormatting}
              </Menu.Item>
            </Menu.Sub.Dropdown>
          </Portal>
        </Menu.Sub>

        <Menu.Divider />

        <Menu.Item leftSection={<AlignLeftIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
          {labels.alignLeft}
        </Menu.Item>
        <Menu.Item leftSection={<AlignCenterIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
          {labels.alignCenter}
        </Menu.Item>
        <Menu.Item leftSection={<AlignRightIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
          {labels.alignRight}
        </Menu.Item>

        <Menu.Divider />

        <Menu.Item
          leftSection={<LinkIcon size={ICON_SIZE} />}
          onClick={() => runDialogAction(onInsertLink)}
        >
          {labels.link}
        </Menu.Item>
        <Menu.Item leftSection={<LinkOffIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().unsetLink().run()}>
          {labels.unlink}
        </Menu.Item>
        <Menu.Item leftSection={<H1Icon size={ICON_SIZE} />} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
          {labels.h1}
        </Menu.Item>
        <Menu.Item leftSection={<H2Icon size={ICON_SIZE} />} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          {labels.h2}
        </Menu.Item>
        <Menu.Item leftSection={<H3Icon size={ICON_SIZE} />} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          {labels.h3}
        </Menu.Item>

        <Menu.Divider />

        <Menu.Item leftSection={<ListIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          {labels.bullet}
        </Menu.Item>
        <Menu.Item leftSection={<ListNumbersIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          {labels.number}
        </Menu.Item>
        <Menu.Item leftSection={<CheckboxIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().toggleTaskList().run()}>
          {labels.taskList}
        </Menu.Item>
        <Menu.Item leftSection={<BlockquoteIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          {labels.quote}
        </Menu.Item>
        <Menu.Item leftSection={<CodeIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
          {labels.code}
        </Menu.Item>

        <Menu.Divider />

        <Menu.Item leftSection={<SeparatorHorizontalIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          {labels.divider}
        </Menu.Item>
        <Menu.Item
          leftSection={<PhotoIcon size={ICON_SIZE} />}
          onClick={() => runDialogAction(onInsertImage)}
        >
          {labels.image}
        </Menu.Item>
        <Menu.Item
          leftSection={<PlayerPlayIcon size={ICON_SIZE} />}
          onClick={() => runDialogAction(onInsertVideo)}
        >
          {labels.embedVideo}
        </Menu.Item>
        <Menu.Item
          leftSection={<LayoutListIcon size={ICON_SIZE} />}
          onClick={() => (editor.commands as unknown as { setDetails: () => void }).setDetails()}
        >
          {labels.details}
        </Menu.Item>

        <Menu.Sub>
          <Menu.Sub.Target>
            <Menu.Sub.Item leftSection={<TableIcon size={ICON_SIZE} />}>
              {labels.table}
            </Menu.Sub.Item>
          </Menu.Sub.Target>
          <Portal>
            <Menu.Sub.Dropdown w={200} style={{ zIndex: CONTEXT_MENU_Z_INDEX + 1 }}>
              <Menu.Item leftSection={<TableIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3 }).run()}>
                {labels.table}
              </Menu.Item>
              <Menu.Item leftSection={<ColumnInsertRightIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().addColumnAfter().run()}>
                {labels.addCol}
              </Menu.Item>
              <Menu.Item leftSection={<RowInsertBottomIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().addRowAfter().run()}>
                {labels.addRow}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item leftSection={<ColumnRemoveIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().deleteColumn().run()}>
                {labels.delCol}
              </Menu.Item>
              <Menu.Item leftSection={<RowRemoveIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().deleteRow().run()}>
                {labels.delRow}
              </Menu.Item>
              <Menu.Item leftSection={<TableOffIcon size={ICON_SIZE} />} onClick={() => editor.chain().focus().deleteTable().run()}>
                {labels.delTable}
              </Menu.Item>
            </Menu.Sub.Dropdown>
          </Portal>
        </Menu.Sub>
      </Menu.Dropdown>
    </Menu>
  );
}
