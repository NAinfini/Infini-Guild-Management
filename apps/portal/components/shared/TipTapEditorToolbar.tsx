import type { Editor } from "@tiptap/react";
import type { CSSProperties, ReactNode, Ref } from "react";
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
  SearchIcon,
} from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@portal/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@portal/components/ui/tooltip";
import type { TipTapEditorLabels } from "./tiptap-meta";

const TEXT_COLORS = ["#1f6feb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#ec4899", "#0891b2", "#334155"];
const HIGHLIGHT_COLORS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecdd3", "#e9d5ff", "#fed7aa"];
const ICON_SIZE = 16;

type TipTapEditorToolbarProps = {
  editor: Editor;
  labels: TipTapEditorLabels;
  onInsertLink: () => void;
  onInsertImage: () => void;
  onInsertVideo: () => void;
  onToggleFindReplace: () => void;
  linkTriggerRef?: Ref<HTMLButtonElement>;
  videoTriggerRef?: Ref<HTMLButtonElement>;
};

type ToolbarActionProps = {
  label: string;
  children: ReactNode;
  onClick: () => void;
  actionRef?: Ref<HTMLButtonElement>;
};

function ToolbarAction({ label, children, onClick, actionRef }: ToolbarActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <Button
            ref={actionRef}
            type="button"
            variant="outline"
            size="icon-sm"
            className="infini-tiptap-toolbar__button"
            aria-label={label}
            onClick={onClick}
          />
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

type ToolbarMenuTriggerProps = {
  label: string;
  children: ReactNode;
};

function ToolbarMenuTrigger({ label, children }: ToolbarMenuTriggerProps) {
  return (
    <Tooltip>
      <DropdownMenuTrigger
        render={(
          <TooltipTrigger
            render={(
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="infini-tiptap-toolbar__button"
                aria-label={label}
              />
            )}
          />
        )}
      >
        {children}
      </DropdownMenuTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

type ColorMenuProps = {
  label: string;
  customLabel: string;
  clearLabel: string;
  colors: string[];
  icon: ReactNode;
  onSelect: (color: string) => void;
  onClear: () => void;
};

function ColorMenu({ label, customLabel, clearLabel, colors, icon, onSelect, onClear }: ColorMenuProps) {
  return (
    <DropdownMenu>
      <ToolbarMenuTrigger label={label}>{icon}</ToolbarMenuTrigger>
      <DropdownMenuContent className="infini-tiptap-toolbar-menu !w-[180px]">
        <div className="infini-tiptap-color-grid">
          {colors.map((color) => (
            <button
              key={color}
              type="button"
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TipTapEditorToolbar({
  editor,
  labels,
  onInsertLink,
  onInsertImage,
  onInsertVideo,
  onToggleFindReplace,
  linkTriggerRef,
  videoTriggerRef,
}: TipTapEditorToolbarProps) {
  return (
    <div
      className="infini-tiptap-toolbar"
      onMouseDown={(event) => {
        if (event.target instanceof HTMLInputElement) return;
        event.preventDefault();
      }}
    >
      <div className="infini-tiptap-toolbar__group">
        <ToolbarAction label={labels.undo} onClick={() => editor.chain().focus().undo().run()}>
          <ArrowBackUpIcon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.redo} onClick={() => editor.chain().focus().redo().run()}>
          <ArrowForwardUpIcon size={ICON_SIZE} />
        </ToolbarAction>
      </div>
      <div className="infini-tiptap-toolbar__group">
        <ToolbarAction label={labels.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
          <BoldIcon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <ItalicIcon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <StrikethroughIcon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.clearFormatting} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
          <EraserIcon size={ICON_SIZE} />
        </ToolbarAction>
      </div>
      <div className="infini-tiptap-toolbar__group">
        <ColorMenu
          label={labels.textColor}
          customLabel={labels.customTextColor}
          clearLabel={labels.clearFormatting}
          colors={TEXT_COLORS}
          icon={<PaletteIcon size={ICON_SIZE} />}
          onSelect={(color) => editor.chain().focus().setColor(color).run()}
          onClear={() => editor.chain().focus().unsetColor().run()}
        />
        <ColorMenu
          label={labels.highlight}
          customLabel={labels.customHighlightColor}
          clearLabel={labels.clearFormatting}
          colors={HIGHLIGHT_COLORS}
          icon={<HighlightIcon size={ICON_SIZE} />}
          onSelect={(color) => editor.chain().focus().setHighlight({ color }).run()}
          onClear={() => editor.chain().focus().unsetHighlight().run()}
        />
      </div>
      <div className="infini-tiptap-toolbar__group">
        <ToolbarAction label={labels.alignLeft} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
          <AlignLeftIcon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.alignCenter} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
          <AlignCenterIcon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.alignRight} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
          <AlignRightIcon size={ICON_SIZE} />
        </ToolbarAction>
      </div>
      <div className="infini-tiptap-toolbar__group">
        <ToolbarAction label={labels.link} actionRef={linkTriggerRef} onClick={onInsertLink}>
          <LinkIcon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.unlink} onClick={() => editor.chain().focus().unsetLink().run()}>
          <LinkOffIcon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.h1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
          <H1Icon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <H2Icon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <H3Icon size={ICON_SIZE} />
        </ToolbarAction>
      </div>
      <div className="infini-tiptap-toolbar__group">
        <ToolbarAction label={labels.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <ListIcon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.number} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListNumbersIcon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.taskList} onClick={() => editor.chain().focus().toggleTaskList().run()}>
          <CheckboxIcon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <BlockquoteIcon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.code} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
          <CodeIcon size={ICON_SIZE} />
        </ToolbarAction>
      </div>
      <div className="infini-tiptap-toolbar__group">
        <ToolbarAction label={labels.divider} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <SeparatorHorizontalIcon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.image} onClick={onInsertImage}>
          <PhotoIcon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.embedVideo} actionRef={videoTriggerRef} onClick={onInsertVideo}>
          <PlayerPlayIcon size={ICON_SIZE} />
        </ToolbarAction>
        <ToolbarAction label={labels.details} onClick={() => (editor.commands as unknown as { setDetails: () => void }).setDetails()}>
          <LayoutListIcon size={ICON_SIZE} />
        </ToolbarAction>
        <DropdownMenu>
          <ToolbarMenuTrigger label={labels.table}>
            <TableIcon size={ICON_SIZE} />
          </ToolbarMenuTrigger>
          <DropdownMenuContent align="end" className="infini-tiptap-toolbar-menu !w-[200px]">
            <DropdownMenuLabel>{labels.table}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3 }).run()}>
              <TableIcon size={14} />
              {labels.table}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().addColumnAfter().run()}>
              <ColumnInsertRightIcon size={14} />
              {labels.addCol}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().addRowAfter().run()}>
              <RowInsertBottomIcon size={14} />
              {labels.addRow}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => editor.chain().focus().deleteColumn().run()}>
              <ColumnRemoveIcon size={14} />
              {labels.delCol}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().deleteRow().run()}>
              <RowRemoveIcon size={14} />
              {labels.delRow}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().deleteTable().run()}>
              <TableOffIcon size={14} />
              {labels.delTable}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="infini-tiptap-toolbar__group">
        <ToolbarAction label={labels.findReplace} onClick={onToggleFindReplace}>
          <SearchIcon size={ICON_SIZE} />
        </ToolbarAction>
      </div>
    </div>
  );
}
