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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@portal/components/ui/dropdown-menu";
import type { TipTapEditorLabels } from "./tiptap-meta";

const TEXT_COLORS = ["#1f6feb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#ec4899", "#0891b2", "#334155"];
const HIGHLIGHT_COLORS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecdd3", "#e9d5ff", "#fed7aa"];
const ICON_SIZE = 14;

type TipTapEditorContextMenuProps = {
  editor: Editor;
  labels: TipTapEditorLabels;
  position: { x: number; y: number };
  onClose: () => void;
  onInsertLink: () => void;
  onInsertImage: () => void;
  onInsertVideo: () => void;
};

type ColorSubmenuProps = {
  label: string;
  customLabel: string;
  colors: string[];
  icon: React.ReactNode;
  clearLabel: string;
  onSelect: (color: string) => void;
  onClear: () => void;
};

function ColorSubmenu({
  label,
  customLabel,
  colors,
  icon,
  clearLabel,
  onSelect,
  onClear,
}: ColorSubmenuProps) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {icon}
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="infini-tiptap-context-submenu !z-[1101] !w-[180px]">
        <div className="infini-tiptap-color-grid">
          {colors.map((color) => (
            <DropdownMenuItem
              key={color}
              className="infini-tiptap-color-swatch"
              style={{ "--swatch-color": color } as CSSProperties}
              aria-label={`${label} ${color}`}
              onClick={() => onSelect(color)}
            />
          ))}
        </div>
        <DropdownMenuSeparator />
        <label className="infini-tiptap-color-custom">
          <span>{customLabel}</span>
          <input
            type="color"
            aria-label={customLabel}
            defaultValue={colors[0]}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onSelect(event.currentTarget.value)}
          />
        </label>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClear}>{clearLabel}</DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

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
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DropdownMenuTrigger
        nativeButton={false}
        render={(
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
        )}
      />
      <DropdownMenuContent
        className="infini-tiptap-context-menu !z-[1100] !w-[220px]"
        aria-label={labels.moreFormatting}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <DropdownMenuItem onClick={() => editor.chain().focus().undo().run()}>
          <ArrowBackUpIcon size={ICON_SIZE} />
          {labels.undo}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().redo().run()}>
          <ArrowForwardUpIcon size={ICON_SIZE} />
          {labels.redo}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => editor.chain().focus().toggleBold().run()}>
          <BoldIcon size={ICON_SIZE} />
          {labels.bold}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().toggleItalic().run()}>
          <ItalicIcon size={ICON_SIZE} />
          {labels.italic}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon size={ICON_SIZE} />
          {labels.underline}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().toggleStrike().run()}>
          <StrikethroughIcon size={ICON_SIZE} />
          {labels.strike}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
          <EraserIcon size={ICON_SIZE} />
          {labels.clearFormatting}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <ColorSubmenu
          label={labels.textColor}
          customLabel={labels.customTextColor}
          colors={TEXT_COLORS}
          icon={<PaletteIcon size={ICON_SIZE} />}
          clearLabel={labels.clearFormatting}
          onSelect={(color) => editor.chain().focus().setColor(color).run()}
          onClear={() => editor.chain().focus().unsetColor().run()}
        />
        <ColorSubmenu
          label={labels.highlight}
          customLabel={labels.customHighlightColor}
          colors={HIGHLIGHT_COLORS}
          icon={<HighlightIcon size={ICON_SIZE} />}
          clearLabel={labels.clearFormatting}
          onSelect={(color) => editor.chain().focus().setHighlight({ color }).run()}
          onClear={() => editor.chain().focus().unsetHighlight().run()}
        />

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => editor.chain().focus().setTextAlign("left").run()}>
          <AlignLeftIcon size={ICON_SIZE} />
          {labels.alignLeft}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().setTextAlign("center").run()}>
          <AlignCenterIcon size={ICON_SIZE} />
          {labels.alignCenter}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().setTextAlign("right").run()}>
          <AlignRightIcon size={ICON_SIZE} />
          {labels.alignRight}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => runDialogAction(onInsertLink)}>
          <LinkIcon size={ICON_SIZE} />
          {labels.link}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().unsetLink().run()}>
          <LinkOffIcon size={ICON_SIZE} />
          {labels.unlink}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
          <H1Icon size={ICON_SIZE} />
          {labels.h1}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <H2Icon size={ICON_SIZE} />
          {labels.h2}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <H3Icon size={ICON_SIZE} />
          {labels.h3}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <ListIcon size={ICON_SIZE} />
          {labels.bullet}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListNumbersIcon size={ICON_SIZE} />
          {labels.number}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().toggleTaskList().run()}>
          <CheckboxIcon size={ICON_SIZE} />
          {labels.taskList}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <BlockquoteIcon size={ICON_SIZE} />
          {labels.quote}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
          <CodeIcon size={ICON_SIZE} />
          {labels.code}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <SeparatorHorizontalIcon size={ICON_SIZE} />
          {labels.divider}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => runDialogAction(onInsertImage)}>
          <PhotoIcon size={ICON_SIZE} />
          {labels.image}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => runDialogAction(onInsertVideo)}>
          <PlayerPlayIcon size={ICON_SIZE} />
          {labels.embedVideo}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => (editor.commands as unknown as { setDetails: () => void }).setDetails()}>
          <LayoutListIcon size={ICON_SIZE} />
          {labels.details}
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <TableIcon size={ICON_SIZE} />
            {labels.table}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="infini-tiptap-context-submenu !z-[1101] !w-[200px]">
            <DropdownMenuItem onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3 }).run()}>
              <TableIcon size={ICON_SIZE} />
              {labels.table}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().addColumnAfter().run()}>
              <ColumnInsertRightIcon size={ICON_SIZE} />
              {labels.addCol}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().addRowAfter().run()}>
              <RowInsertBottomIcon size={ICON_SIZE} />
              {labels.addRow}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => editor.chain().focus().deleteColumn().run()}>
              <ColumnRemoveIcon size={ICON_SIZE} />
              {labels.delCol}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().deleteRow().run()}>
              <RowRemoveIcon size={ICON_SIZE} />
              {labels.delRow}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().deleteTable().run()}>
              <TableOffIcon size={ICON_SIZE} />
              {labels.delTable}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
