// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildTipTapEditorLabels, sanitizeTipTapHtml, TipTapEditor } from "./TipTapEditor";

const editorLabels = {
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
  linkPrompt: "Link URL",
  imageInserted: "Image inserted",
  imageUploadFailed: "Image upload failed",
  uploading: "Uploading...",
};

function renderHtmlEditor(onChange = vi.fn()) {
  render(
    <MantineProvider>
      <TipTapEditor
        value="<p>Alpha</p>"
        onChange={onChange}
        mode="html"
        editable
        labels={editorLabels}
      />
    </MantineProvider>,
  );

  return { onChange };
}

describe("TipTapEditor shared contracts", () => {
  beforeAll(() => {
    if (!HTMLElement.prototype.getClientRects) {
      Object.defineProperty(HTMLElement.prototype, "getClientRects", {
        configurable: true,
        value: () => [{ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 }],
      });
    }
  });

  it("builds labels for color, formatting cleanup, alignment, divider, tasks, and history controls", () => {
    const labels = buildTipTapEditorLabels((key) => `label:${key}`) as unknown as Record<string, string>;

    expect(labels.textColor).toBe("label:toolbar.textColor");
    expect(labels.customTextColor).toBe("label:toolbar.customTextColor");
    expect(labels.highlight).toBe("label:toolbar.highlight");
    expect(labels.customHighlightColor).toBe("label:toolbar.customHighlightColor");
    expect(labels.clearFormatting).toBe("label:toolbar.clearFormatting");
    expect(labels.alignLeft).toBe("label:toolbar.alignLeft");
    expect(labels.alignCenter).toBe("label:toolbar.alignCenter");
    expect(labels.alignRight).toBe("label:toolbar.alignRight");
    expect(labels.divider).toBe("label:toolbar.divider");
    expect(labels.taskList).toBe("label:toolbar.taskList");
    expect(labels.undo).toBe("label:toolbar.undo");
    expect(labels.redo).toBe("label:toolbar.redo");
  });

  it("preserves safe TipTap style attributes for colored html output", () => {
    const html = sanitizeTipTapHtml(
      '<p style="text-align: center"><span style="color: #1f6feb"><mark style="background-color: #fde047">Title</mark></span></p>',
    );

    expect(html).toContain('style="text-align: center"');
    expect(html).toContain('style="color: #1f6feb"');
    expect(html).toContain('style="background-color: #fde047"');
    expect(html).toContain("<mark");
  });

  it("opens an in-app link dialog instead of the browser prompt", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("https://example.com");
    renderHtmlEditor();

    fireEvent.click(await screen.findByRole("button", { name: editorLabels.link }));

    expect(prompt).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: editorLabels.linkPrompt })).toBeInTheDocument();
  });

  it("applies heading commands from the rendered toolbar", async () => {
    const { onChange } = renderHtmlEditor();

    fireEvent.click(await screen.findByRole("button", { name: editorLabels.h1 }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.stringContaining("<h1>Alpha</h1>"));
    });
  });

  it("applies list commands from the rendered toolbar", async () => {
    const { onChange } = renderHtmlEditor();

    fireEvent.click(await screen.findByRole("button", { name: editorLabels.bullet }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.stringContaining("<ul><li><p>Alpha</p></li></ul>"));
    });
  });

  it("restores visible heading and list styles inside the editor surface", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/shared/tiptap-editor.css"), "utf8");

    expect(css).toContain(".infini-tiptap-surface h1");
    expect(css).toContain(".infini-tiptap-surface ul");
    expect(css).toContain("list-style: disc");
    expect(css).toContain("list-style: decimal");
  });

  it("styles linked text inside the editor surface so assigned links are visible", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/shared/tiptap-editor.css"), "utf8");

    expect(css).toContain(".infini-tiptap-surface a");
    expect(css).toContain("text-decoration");
    expect(css).toContain("text-underline-offset");
  });

  it("keeps task checklist checkboxes and text on the same row", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/shared/tiptap-editor.css"), "utf8");

    expect(css).toContain('.infini-tiptap-surface ul[data-type="taskList"] > li');
    expect(css).toContain('grid-template-columns: auto minmax(0, 1fr)');
    expect(css).toContain('.infini-tiptap-surface ul[data-type="taskList"] > li > div > p');
  });

  it("centers task checklist checkboxes vertically with their text", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/shared/tiptap-editor.css"), "utf8");

    expect(css).toContain("align-items: center");
    expect(css).toContain("padding-top: 0");
  });
});
