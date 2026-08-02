// @vitest-environment jsdom
import { Drawer, MantineProvider } from "@mantine/core";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
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
  lightboxTitle: "Image preview",
  lightboxPreview: "Preview image",
  lightboxZoomOut: "Zoom out",
  lightboxZoomReset: "Reset zoom",
  lightboxZoomIn: "Zoom in",
  lightboxZoomLevel: "Zoom {{percent}}%",
  videoUrl: "Video URL",
  embedVideo: "Embed video",
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

function renderReadOnlyImageEditor() {
  render(
    <MantineProvider>
      <TipTapEditor
        value={'<img src="https://example.com/raid-map.jpg" alt="Raid map"><img src="https://example.com/no-alt.jpg">'}
        onChange={vi.fn()}
        mode="html"
        readOnly
        labels={editorLabels}
      />
    </MantineProvider>,
  );
}

function NestedDrawerEditor() {
  const [opened, setOpened] = useState(true);

  return (
    <MantineProvider>
      <button type="button" onClick={() => setOpened(true)}>
        Edit article
      </button>
      <Drawer
        opened={opened}
        onClose={() => setOpened(false)}
        title="Wiki editor"
        transitionProps={{ duration: 0 }}
      >
        <TipTapEditor
          value="<p>Alpha</p>"
          onChange={vi.fn()}
          mode="html"
          editable
          ariaLabel="Article body"
          labels={editorLabels}
        />
      </Drawer>
    </MantineProvider>
  );
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
    expect(labels.lightboxTitle).toBe("label:lightbox.title");
    expect(labels.lightboxPreview).toBe("label:lightbox.preview");
    expect(labels.lightboxZoomOut).toBe("label:lightbox.zoomOut");
    expect(labels.lightboxZoomReset).toBe("label:lightbox.zoomReset");
    expect(labels.lightboxZoomIn).toBe("label:lightbox.zoomIn");
    expect(labels.lightboxZoomLevel).toBe("label:lightbox.zoomLevel");
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

  it("exposes the editable surface as a named multiline textbox", async () => {
    render(
      <MantineProvider>
        <TipTapEditor
          value="<p>Alpha</p>"
          onChange={vi.fn()}
          mode="html"
          editable
          ariaLabel="Article body"
          labels={editorLabels}
        />
      </MantineProvider>,
    );

    expect(
      await screen.findByRole("textbox", { name: "Article body" }),
    ).toHaveAttribute("aria-multiline", "true");
  });

  it("closes only the nested link or video modal on Escape and restores toolbar focus", async () => {
    const user = userEvent.setup();
    render(<NestedDrawerEditor />);

    const drawer = await screen.findByRole("dialog", { name: "Wiki editor" });
    const linkTrigger = await within(drawer).findByRole("button", { name: editorLabels.link });
    fireEvent.click(linkTrigger);

    expect(await screen.findByRole("dialog", { name: editorLabels.linkPrompt })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: editorLabels.linkPrompt })).not.toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Wiki editor" })).toBeInTheDocument();
      expect(linkTrigger).toHaveFocus();
    });

    const videoTrigger = within(drawer).getByRole("button", { name: editorLabels.embedVideo });
    fireEvent.click(videoTrigger);

    expect(await screen.findByRole("dialog", { name: editorLabels.embedVideo })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: editorLabels.embedVideo })).not.toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Wiki editor" })).toBeInTheDocument();
      expect(videoTrigger).toHaveFocus();
    });
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

  it("stretches an empty editor across the narrow column layout", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/shared/tiptap-editor.css"), "utf8");
    const narrowLayoutRule = css.match(
      /@media \(max-width: 768px\)[\s\S]*?\.infini-tiptap-layout\s*\{([^}]*)\}/,
    )?.[1] ?? "";
    const surfaceRule = css.match(/\.infini-tiptap-surface\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(narrowLayoutRule).toContain("flex-direction: column");
    expect(narrowLayoutRule).toContain("align-items: stretch");
    expect(surfaceRule).toContain("min-height: 180px");
    expect(surfaceRule).not.toContain("overflow-y");
  });

  it("opens read-only images by keyboard with localized lightbox controls and preserved alt text", async () => {
    renderReadOnlyImageEditor();

    const raidMap = await screen.findByRole("button", { name: "Raid map" });
    expect(raidMap).toHaveAttribute("tabindex", "0");

    raidMap.focus();
    fireEvent.keyDown(raidMap, { key: "Enter" });

    let dialog = await screen.findByRole("dialog", { name: editorLabels.lightboxTitle });
    await waitFor(() => {
      expect(dialog).toBeVisible();
    });
    expect(within(dialog).getByRole("img", { name: "Raid map" })).toBeInTheDocument();

    const zoomOut = within(dialog).getByRole("button", { name: editorLabels.lightboxZoomOut });
    const zoomReset = within(dialog).getByRole("button", { name: editorLabels.lightboxZoomReset });
    const zoomIn = within(dialog).getByRole("button", { name: editorLabels.lightboxZoomIn });
    expect(zoomOut).toBeDisabled();
    expect(zoomReset).toBeDisabled();
    expect(zoomIn).toBeEnabled();
    expect(within(dialog).getByText("Zoom 100%")).toHaveAttribute("aria-live", "polite");

    for (let step = 0; step < 8; step += 1) {
      fireEvent.click(zoomIn);
    }

    expect(within(dialog).getByText("260%")).toBeVisible();
    expect(within(dialog).getByText("Zoom 260%")).toHaveAttribute("aria-live", "polite");
    expect(zoomIn).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("button", { name: editorLabels.close }));
    await waitForElementToBeRemoved(dialog);

    const imageWithoutAlt = screen.getByRole("button", { name: editorLabels.lightboxPreview });
    imageWithoutAlt.focus();
    fireEvent.keyDown(imageWithoutAlt, { key: " " });

    dialog = await screen.findByRole("dialog", { name: editorLabels.lightboxTitle });
    await waitFor(() => {
      expect(dialog).toBeVisible();
    });
    expect(
      within(dialog).getByRole("img", { name: editorLabels.lightboxPreview }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(within(dialog).getByText("100%")).toBeVisible();
    });
    expect(within(dialog).getByRole("button", { name: editorLabels.lightboxZoomOut })).toBeDisabled();
  });

  it("does not keyboardize content images while the editor is editable", async () => {
    const { container } = render(
      <MantineProvider>
        <TipTapEditor
          value={'<img src="https://example.com/editable.jpg" alt="Editable image">'}
          onChange={vi.fn()}
          mode="html"
          editable
          labels={editorLabels}
        />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(container.querySelector(".infini-tiptap-surface img")).not.toBeNull();
    });
    const image = container.querySelector(".infini-tiptap-surface img")!;
    expect(image).not.toHaveAttribute("role", "button");
    expect(image).not.toHaveAttribute("tabindex");

    fireEvent.keyDown(image, { key: "Enter" });
    expect(screen.queryByRole("dialog", { name: editorLabels.lightboxTitle })).not.toBeInTheDocument();
  });

  it("keeps lightbox controls touch-sized and contained at narrow widths", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/shared/tiptap-editor.css"), "utf8");
    const controlsRule = css.match(/\.infini-tiptap-lightbox-controls\s*\{([^}]*)\}/)?.[1] ?? "";
    const controlButtonRule = css.match(
      /\.infini-tiptap-lightbox-controls \.mantine-Button-root\s*\{([^}]*)\}/,
    )?.[1] ?? "";
    const viewportRule = css.match(/\.infini-tiptap-lightbox-viewport\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(controlsRule).toContain("flex-wrap: wrap");
    expect(controlButtonRule).toContain("min-width: 44px");
    expect(controlButtonRule).toContain("min-height: 44px");
    expect(viewportRule).toContain("max-width: 100%");
    expect(viewportRule).toContain("min-width: 0");
  });
});
