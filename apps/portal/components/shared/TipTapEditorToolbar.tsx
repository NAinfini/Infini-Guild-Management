import type { Editor } from "@tiptap/react";
import { ActionIcon, Menu, Tooltip } from "@mantine/core";
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBold,
  IconItalic,
  IconUnderline,
  IconStrikethrough,
  IconLink,
  IconLinkOff,
  IconCheckbox,
  IconH1,
  IconH2,
  IconH3,
  IconList,
  IconListNumbers,
  IconBlockquote,
  IconCode,
  IconTable,
  IconColumnInsertRight,
  IconRowInsertBottom,
  IconColumnRemove,
  IconRowRemove,
  IconTableOff,
  IconPhoto,
  IconPalette,
  IconHighlight,
  IconEraser,
  IconSeparatorHorizontal,
  IconPlayerPlay,
  IconLayoutList,
  IconSearch,
} from "@tabler/icons-react";
import type { TipTapEditorLabels } from "./TipTapEditor";

const TEXT_COLORS = ["#1f6feb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#ec4899", "#0891b2", "#334155"];
const HIGHLIGHT_COLORS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecdd3", "#e9d5ff", "#fed7aa"];
const TOOLTIP_PROPS = { withArrow: true, withinPortal: true, zIndex: 1000 };

type TipTapEditorToolbarProps = {
  editor: Editor;
  labels: TipTapEditorLabels;
  onInsertLink: () => void;
  onInsertImage: () => void;
  onInsertVideo: () => void;
  onToggleFindReplace: () => void;
};

export function TipTapEditorToolbar({ editor, labels, onInsertLink, onInsertImage, onInsertVideo, onToggleFindReplace }: TipTapEditorToolbarProps) {
  return (
    <div
      className="infini-tiptap-toolbar"
      onMouseDown={(event) => {
        if (event.target instanceof HTMLInputElement) return;
        event.preventDefault();
      }}
    >
      <div className="infini-tiptap-toolbar__group">
        <Tooltip label={labels.undo} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.undo} size="sm" variant="default" onClick={() => editor.chain().focus().undo().run()}><IconArrowBackUp size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.redo} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.redo} size="sm" variant="default" onClick={() => editor.chain().focus().redo().run()}><IconArrowForwardUp size={16} /></ActionIcon></Tooltip>
      </div>
      <div className="infini-tiptap-toolbar__group">
        <Tooltip label={labels.bold} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.bold} size="sm" variant="default" onClick={() => editor.chain().focus().toggleBold().run()}><IconBold size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.italic} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.italic} size="sm" variant="default" onClick={() => editor.chain().focus().toggleItalic().run()}><IconItalic size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.underline} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.underline} size="sm" variant="default" onClick={() => editor.chain().focus().toggleUnderline().run()}><IconUnderline size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.strike} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.strike} size="sm" variant="default" onClick={() => editor.chain().focus().toggleStrike().run()}><IconStrikethrough size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.clearFormatting} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.clearFormatting} size="sm" variant="default" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><IconEraser size={16} /></ActionIcon></Tooltip>
      </div>
      <div className="infini-tiptap-toolbar__group">
        <Menu withinPortal position="bottom-start">
          <Tooltip label={labels.textColor} {...TOOLTIP_PROPS}>
            <Menu.Target>
              <ActionIcon aria-label={labels.textColor} size="sm" variant="default"><IconPalette size={16} /></ActionIcon>
            </Menu.Target>
          </Tooltip>
          <Menu.Dropdown>
            <div className="infini-tiptap-color-grid">
              {TEXT_COLORS.map((nextColor) => (
                <button key={nextColor} type="button" className="infini-tiptap-color-swatch" style={{ background: nextColor }} aria-label={`${labels.textColor} ${nextColor}`} onClick={() => editor.chain().focus().setColor(nextColor).run()} />
              ))}
            </div>
            <Menu.Divider />
            <label className="infini-tiptap-color-custom">
              <span>{labels.customTextColor}</span>
              <input
                type="color"
                aria-label={labels.customTextColor}
                defaultValue={TEXT_COLORS[0]}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => editor.chain().focus().setColor(event.currentTarget.value).run()}
              />
            </label>
            <Menu.Divider />
            <Menu.Item onClick={() => editor.chain().focus().unsetColor().run()}>{labels.clearFormatting}</Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <Menu withinPortal position="bottom-start">
          <Tooltip label={labels.highlight} {...TOOLTIP_PROPS}>
            <Menu.Target>
              <ActionIcon aria-label={labels.highlight} size="sm" variant="default"><IconHighlight size={16} /></ActionIcon>
            </Menu.Target>
          </Tooltip>
          <Menu.Dropdown>
            <div className="infini-tiptap-color-grid">
              {HIGHLIGHT_COLORS.map((nextColor) => (
                <button key={nextColor} type="button" className="infini-tiptap-color-swatch" style={{ background: nextColor }} aria-label={`${labels.highlight} ${nextColor}`} onClick={() => editor.chain().focus().setHighlight({ color: nextColor }).run()} />
              ))}
            </div>
            <Menu.Divider />
            <label className="infini-tiptap-color-custom">
              <span>{labels.customHighlightColor}</span>
              <input
                type="color"
                aria-label={labels.customHighlightColor}
                defaultValue={HIGHLIGHT_COLORS[0]}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => editor.chain().focus().setHighlight({ color: event.currentTarget.value }).run()}
              />
            </label>
            <Menu.Divider />
            <Menu.Item onClick={() => editor.chain().focus().unsetHighlight().run()}>{labels.clearFormatting}</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>
      <div className="infini-tiptap-toolbar__group">
        <Tooltip label={labels.alignLeft} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.alignLeft} size="sm" variant="default" onClick={() => editor.chain().focus().setTextAlign("left").run()}><IconAlignLeft size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.alignCenter} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.alignCenter} size="sm" variant="default" onClick={() => editor.chain().focus().setTextAlign("center").run()}><IconAlignCenter size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.alignRight} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.alignRight} size="sm" variant="default" onClick={() => editor.chain().focus().setTextAlign("right").run()}><IconAlignRight size={16} /></ActionIcon></Tooltip>
      </div>
      <div className="infini-tiptap-toolbar__group">
        <Tooltip label={labels.link} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.link} size="sm" variant="default" onClick={onInsertLink}><IconLink size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.unlink} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.unlink} size="sm" variant="default" onClick={() => editor.chain().focus().unsetLink().run()}><IconLinkOff size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.h1} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.h1} size="sm" variant="default" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><IconH1 size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.h2} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.h2} size="sm" variant="default" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><IconH2 size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.h3} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.h3} size="sm" variant="default" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><IconH3 size={16} /></ActionIcon></Tooltip>
      </div>
      <div className="infini-tiptap-toolbar__group">
        <Tooltip label={labels.bullet} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.bullet} size="sm" variant="default" onClick={() => editor.chain().focus().toggleBulletList().run()}><IconList size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.number} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.number} size="sm" variant="default" onClick={() => editor.chain().focus().toggleOrderedList().run()}><IconListNumbers size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.taskList} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.taskList} size="sm" variant="default" onClick={() => editor.chain().focus().toggleTaskList().run()}><IconCheckbox size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.quote} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.quote} size="sm" variant="default" onClick={() => editor.chain().focus().toggleBlockquote().run()}><IconBlockquote size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.code} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.code} size="sm" variant="default" onClick={() => editor.chain().focus().toggleCodeBlock().run()}><IconCode size={16} /></ActionIcon></Tooltip>
      </div>
      <div className="infini-tiptap-toolbar__group">
        <Tooltip label={labels.divider} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.divider} size="sm" variant="default" onClick={() => editor.chain().focus().setHorizontalRule().run()}><IconSeparatorHorizontal size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.image} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.image} size="sm" variant="default" onClick={onInsertImage}><IconPhoto size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.embedVideo} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.embedVideo} size="sm" variant="default" onClick={onInsertVideo}><IconPlayerPlay size={16} /></ActionIcon></Tooltip>
        <Tooltip label={labels.details} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.details} size="sm" variant="default" onClick={() => (editor.commands as Record<string, Function>).setDetails()}><IconLayoutList size={16} /></ActionIcon></Tooltip>
        <Menu withinPortal position="bottom-end">
          <Tooltip label={labels.table} {...TOOLTIP_PROPS}>
            <Menu.Target>
              <ActionIcon aria-label={labels.table} size="sm" variant="default"><IconTable size={16} /></ActionIcon>
            </Menu.Target>
          </Tooltip>
          <Menu.Dropdown>
            <Menu.Label>{labels.table}</Menu.Label>
            <Menu.Item leftSection={<IconTable size={14} />} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3 }).run()}>{labels.table}</Menu.Item>
            <Menu.Item leftSection={<IconColumnInsertRight size={14} />} onClick={() => editor.chain().focus().addColumnAfter().run()}>{labels.addCol}</Menu.Item>
            <Menu.Item leftSection={<IconRowInsertBottom size={14} />} onClick={() => editor.chain().focus().addRowAfter().run()}>{labels.addRow}</Menu.Item>
            <Menu.Divider />
            <Menu.Item leftSection={<IconColumnRemove size={14} />} onClick={() => editor.chain().focus().deleteColumn().run()}>{labels.delCol}</Menu.Item>
            <Menu.Item leftSection={<IconRowRemove size={14} />} onClick={() => editor.chain().focus().deleteRow().run()}>{labels.delRow}</Menu.Item>
            <Menu.Item leftSection={<IconTableOff size={14} />} onClick={() => editor.chain().focus().deleteTable().run()}>{labels.delTable}</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>
      <div className="infini-tiptap-toolbar__group">
        <Tooltip label={labels.findReplace} {...TOOLTIP_PROPS}><ActionIcon aria-label={labels.findReplace} size="sm" variant="default" onClick={onToggleFindReplace}><IconSearch size={16} /></ActionIcon></Tooltip>
      </div>
    </div>
  );
}
