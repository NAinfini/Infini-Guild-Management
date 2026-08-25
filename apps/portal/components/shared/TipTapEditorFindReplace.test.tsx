import type { Editor } from "@tiptap/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@portal/components/ui/tooltip";
import { TipTapEditorFindReplace } from "./TipTapEditorFindReplace";
import type { TipTapEditorLabels } from "./tiptap-meta";

const labels: TipTapEditorLabels = {
  bold: "Bold",
  italic: "Italic",
  underline: "Underline",
  strike: "Strikethrough",
  link: "Link",
  unlink: "Unlink",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  bullet: "Bullet list",
  number: "Numbered list",
  quote: "Blockquote",
  code: "Code block",
  table: "Table",
  addCol: "Add column",
  addRow: "Add row",
  delCol: "Delete column",
  delRow: "Delete row",
  delTable: "Delete table",
  image: "Image",
  textColor: "Text color",
  customTextColor: "Custom text color",
  highlight: "Highlight",
  customHighlightColor: "Custom background color",
  clearFormatting: "Clear formatting",
  alignLeft: "Align left",
  alignCenter: "Align center",
  alignRight: "Align right",
  divider: "Divider",
  taskList: "Task checklist",
  undo: "Undo",
  redo: "Redo",
  moreFormatting: "More formatting",
  moreInsert: "Insert",
  close: "Close",
  slashCommands: "Slash commands",
  linkPrompt: "Enter URL",
  imageInserted: "Image inserted",
  imageUploadFailed: "Image upload failed",
  uploading: "Uploading...",
  lightboxTitle: "Image preview",
  lightboxPreview: "Preview image",
  lightboxZoomOut: "Zoom out",
  lightboxZoomReset: "Reset zoom",
  lightboxZoomIn: "Zoom in",
  lightboxZoomLevel: "Zoom {{percent}}%",
  youtube: "YouTube",
  bilibili: "Bilibili",
  videoUrl: "Video URL",
  embedVideo: "Embed video",
  details: "Toggle section",
  findReplace: "Find & Replace",
  findPlaceholder: "Find...",
  replacePlaceholder: "Replace...",
  findNext: "Next",
  findPrev: "Previous",
  replaceOne: "Replace",
  replaceAllLabel: "Replace all",
  tableOfContents: "Table of Contents",
  wordCount: "{{words}} words · {{characters}} characters",
  words: "words",
  characters: "characters",
};

function createEditorMock() {
  const commands = {
    setSearchTerm: vi.fn(),
    nextSearchResult: vi.fn(),
    prevSearchResult: vi.fn(),
    clearSearch: vi.fn(),
    setReplaceTerm: vi.fn(),
    replaceCurrent: vi.fn(),
    replaceAll: vi.fn(),
  };

  return {
    editor: {
      commands,
      storage: {
        searchReplace: {
          searchTerm: "alpha",
          replaceTerm: "beta",
          results: [{}, {}],
          activeIndex: 0,
        },
      },
    } as unknown as Editor,
    commands,
  };
}

function renderFindReplace() {
  const editorMock = createEditorMock();
  const onClose = vi.fn();
  render(
    <TooltipProvider>
      <TipTapEditorFindReplace editor={editorMock.editor} labels={labels} onClose={onClose} />
    </TooltipProvider>,
  );
  return { ...editorMock, onClose };
}

describe("TipTapEditorFindReplace", () => {
  it("keeps find and replace actions keyboard-accessible", () => {
    const { commands } = renderFindReplace();
    const findInput = screen.getByRole("textbox", { name: labels.findPlaceholder });
    const replaceInput = screen.getByRole("textbox", { name: labels.replacePlaceholder });

    fireEvent.keyDown(findInput, { key: "Enter" });
    fireEvent.keyDown(replaceInput, { key: "Enter" });

    expect(commands.nextSearchResult).toHaveBeenCalledOnce();
    expect(commands.replaceCurrent).toHaveBeenCalledOnce();
  });

  it("does not treat Enter from an IME composition as a find or replace action", () => {
    const { commands } = renderFindReplace();
    const findInput = screen.getByRole("textbox", { name: labels.findPlaceholder });
    const replaceInput = screen.getByRole("textbox", { name: labels.replacePlaceholder });

    fireEvent.keyDown(findInput, { key: "Enter", isComposing: true });
    fireEvent.keyDown(replaceInput, { key: "Enter", isComposing: true });

    expect(commands.nextSearchResult).not.toHaveBeenCalled();
    expect(commands.replaceCurrent).not.toHaveBeenCalled();
  });

  it("clears the editor search and closes on Escape", () => {
    const { commands, onClose } = renderFindReplace();
    const findInput = screen.getByRole("textbox", { name: labels.findPlaceholder });

    fireEvent.keyDown(findInput, { key: "Escape" });

    expect(commands.clearSearch).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the result count announced without creating a second modal layer", () => {
    renderFindReplace();

    expect(screen.getByRole("dialog", { name: labels.findReplace })).toBeInTheDocument();
    expect(screen.getByText("1/2")).toHaveAttribute("aria-live", "polite");
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });
});
