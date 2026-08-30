import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@portal/components/ui/tooltip";
import type { TipTapEditorLabels } from "./tiptap-meta";
import { TipTapEditorToolbar } from "./TipTapEditorToolbar";

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

function createEditorStub(): Editor {
  const setColor = vi.fn();
  const setHighlight = vi.fn();
  const chain = {
    focus: () => chain,
    undo: () => chain,
    redo: () => chain,
    toggleBold: () => chain,
    toggleItalic: () => chain,
    toggleUnderline: () => chain,
    toggleStrike: () => chain,
    unsetAllMarks: () => chain,
    clearNodes: () => chain,
    setColor: (color: string) => {
      setColor(color);
      return chain;
    },
    unsetColor: () => chain,
    setHighlight: (attrs: { color: string }) => {
      setHighlight(attrs);
      return chain;
    },
    unsetHighlight: () => chain,
    setTextAlign: () => chain,
    unsetLink: () => chain,
    toggleHeading: () => chain,
    toggleBulletList: () => chain,
    toggleOrderedList: () => chain,
    toggleTaskList: () => chain,
    toggleBlockquote: () => chain,
    toggleCodeBlock: () => chain,
    setHorizontalRule: () => chain,
    insertTable: () => chain,
    addColumnAfter: () => chain,
    addRowAfter: () => chain,
    deleteColumn: () => chain,
    deleteRow: () => chain,
    deleteTable: () => chain,
    run: vi.fn(),
  };

  return {
    chain: () => chain,
    __calls: { setColor, setHighlight },
  } as unknown as Editor;
}

function renderToolbar() {
  render(
    <TooltipProvider>
      <TipTapEditorToolbar
        editor={createEditorStub()}
        labels={labels}
        onInsertImage={() => {}}
        onInsertLink={() => {}}
        onInsertVideo={() => {}}
        onToggleFindReplace={() => {}}
      />
    </TooltipProvider>,
  );
}

describe("TipTapEditorToolbar", () => {
  it("keeps common actions visible and moves secondary formatting into a named menu", async () => {
    renderToolbar();

    expect(screen.getByRole("button", { name: labels.bold })).toBeInTheDocument();
    expect(screen.queryByText(labels.h1)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: labels.moreFormatting }));

    await waitFor(() => expect(screen.getByText(labels.h1)).toBeInTheDocument());
    expect(screen.getByText(labels.clearFormatting)).toBeInTheDocument();
  });

  it("shows a tooltip for menu trigger buttons", async () => {
    renderToolbar();

    fireEvent.mouseEnter(screen.getByRole("button", { name: labels.textColor }));

    await waitFor(() => expect(screen.getByText(labels.textColor)).toBeInTheDocument());
  });

  it("keeps menu trigger buttons clickable after adding tooltips", async () => {
    renderToolbar();

    fireEvent.click(screen.getByRole("button", { name: labels.textColor }));

    await waitFor(() => expect(screen.getByRole("button", { name: `${labels.textColor} #1f6feb` })).toBeInTheDocument());
  });

  it("prevents toolbar buttons from stealing the editor selection before block commands run", () => {
    renderToolbar();

    expect(fireEvent.mouseDown(screen.getByRole("button", { name: labels.moreFormatting }))).toBe(false);
    expect(fireEvent.mouseDown(screen.getByRole("button", { name: labels.bullet }))).toBe(false);
    expect(fireEvent.mouseDown(screen.getByRole("button", { name: labels.moreInsert }))).toBe(false);
  });

  it("applies a custom text color from the color picker", async () => {
    const editor = createEditorStub();
    render(
      <TooltipProvider>
        <TipTapEditorToolbar editor={editor} labels={labels} onInsertImage={() => {}} onInsertLink={() => {}} onInsertVideo={() => {}} onToggleFindReplace={() => {}} />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: labels.textColor }));
    fireEvent.change(await screen.findByLabelText(labels.customTextColor), { target: { value: "#123456" } });

    expect((editor as unknown as { __calls: { setColor: ReturnType<typeof vi.fn> } }).__calls.setColor).toHaveBeenCalledWith("#123456");
  });

  it("applies a custom background color from the color picker", async () => {
    const editor = createEditorStub();
    render(
      <TooltipProvider>
        <TipTapEditorToolbar editor={editor} labels={labels} onInsertImage={() => {}} onInsertLink={() => {}} onInsertVideo={() => {}} onToggleFindReplace={() => {}} />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: labels.highlight }));
    fireEvent.change(await screen.findByLabelText(labels.customHighlightColor), { target: { value: "#654321" } });

    expect((editor as unknown as { __calls: { setHighlight: ReturnType<typeof vi.fn> } }).__calls.setHighlight).toHaveBeenCalledWith({ color: "#654321" });
  });

});
