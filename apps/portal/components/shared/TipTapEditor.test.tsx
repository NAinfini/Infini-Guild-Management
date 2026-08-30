import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getSchema } from "@tiptap/core";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { EditorState } from "@tiptap/pm/state";
import { CellSelection, mergeCells } from "@tiptap/pm/tables";
import StarterKit from "@tiptap/starter-kit";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@portal/components/ui/drawer";
import { TooltipProvider } from "@portal/components/ui/tooltip";
import { canonicalizeRichTextLinkAttributes, createAnnouncementSchema, createWikiArticleSchema, updateAnnouncementSchema, updateWikiArticleSchema } from "@guild/shared";
import { sanitizeTipTapHtml, TipTapEditor } from "./TipTapEditor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

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
    <TooltipProvider>
      <TipTapEditor
        value="<p>Alpha</p>"
        onChange={onChange}
        mode="html"
        editable
        labels={editorLabels}
      />
    </TooltipProvider>,
  );

  return { onChange };
}

function renderReadOnlyImageEditor() {
  render(
    <TooltipProvider>
      <TipTapEditor
        value={'<img src="https://example.com/raid-map.jpg" alt="Raid map"><img src="https://example.com/no-alt.jpg">'}
        onChange={vi.fn()}
        mode="html"
        readOnly
        labels={editorLabels}
      />
    </TooltipProvider>,
  );
}

function NestedDrawerEditor() {
  const [opened, setOpened] = useState(true);

  return (
    <TooltipProvider>
      <button type="button" onClick={() => setOpened(true)}>
        Edit article
      </button>
      <Drawer
        open={opened}
        onOpenChange={setOpened}
        swipeDirection="down"
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Wiki editor</DrawerTitle>
          </DrawerHeader>
          <div className="p-4">
            <TipTapEditor
              value="<p>Alpha</p>"
              onChange={vi.fn()}
              mode="html"
              editable
              ariaLabel="Article body"
              labels={editorLabels}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </TooltipProvider>
  );
}

describe("TipTapEditor shared contracts", () => {
  it("saves real editor link attributes through wiki and announcement schemas", () => {
    const schema = getSchema([StarterKit]);
    const link = schema.mark("link", { href: "https://example.com/guide" });
    expect(link.attrs.title).toBeNull();
    const attrs = canonicalizeRichTextLinkAttributes(link.attrs, "https://guild.example");
    const document = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Guide", [schema.mark("link", attrs)])]),
    ]);
    const body_json = JSON.stringify(document.toJSON());
    expect(updateWikiArticleSchema.safeParse({ body_json }).success).toBe(true);
    expect(createWikiArticleSchema.safeParse({ title: "Guide", category_id: "guides", body_json }).success).toBe(true);
    expect(updateAnnouncementSchema.safeParse({ body_json }).success).toBe(true);
    expect(createAnnouncementSchema.safeParse({ title: "Dispatch", body_json }).success).toBe(true);
  });

  it("saves merged table cells with an unmeasured column width", () => {
    const schema = getSchema([StarterKit, Table, TableRow, TableHeader, TableCell]);
    const cell = (colwidth: number[] | null) => schema.node("tableCell", { colwidth }, [schema.node("paragraph")]);
    const document = schema.node("doc", null, [
      schema.node("table", null, [schema.node("tableRow", null, [cell([100]), cell(null)])]),
    ]);
    const state = EditorState.create({
      schema,
      doc: document,
      selection: CellSelection.create(document, 2, 6),
    });
    let mergedDocument = document;
    expect(mergeCells(state, (transaction) => { mergedDocument = transaction.doc; })).toBe(true);
    expect(mergedDocument.firstChild?.firstChild?.firstChild?.attrs.colwidth).toEqual([100, 0]);
    const body_json = JSON.stringify(mergedDocument.toJSON());
    expect(updateWikiArticleSchema.safeParse({ body_json }).success).toBe(true);
    expect(updateAnnouncementSchema.safeParse({ body_json }).success).toBe(true);
  });

  it("saves table JSON produced by the real editor through wiki and announcement schemas", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <TipTapEditor
          value={JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] })}
          onChange={onChange}
          editable
          labels={editorLabels}
        />
      </TooltipProvider>,
    );
    await user.click(await screen.findByRole("button", { name: editorLabels.table }));
    await user.click(await screen.findByRole("menuitem", { name: editorLabels.table }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const body_json = onChange.mock.lastCall![0] as string;
    expect(body_json).toContain('"tableHeader"');
    expect(body_json).toContain('"tableCell"');
    expect(updateWikiArticleSchema.safeParse({ body_json }).success).toBe(true);
    expect(createWikiArticleSchema.safeParse({ title: "Guide", category_id: "guides", body_json }).success).toBe(true);
    expect(updateAnnouncementSchema.safeParse({ body_json }).success).toBe(true);
    expect(createAnnouncementSchema.safeParse({ title: "Dispatch", body_json }).success).toBe(true);
  });

  beforeAll(() => {
    if (!HTMLElement.prototype.getClientRects) {
      Object.defineProperty(HTMLElement.prototype, "getClientRects", {
        configurable: true,
        value: () => [{ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 }],
      });
    }
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

  it("does not request externally hosted images from persisted JSON content", async () => {
    render(
      <TooltipProvider>
        <TipTapEditor
          value={JSON.stringify({
            type: "doc",
            content: [
              { type: "image", attrs: { src: "https://tracker.example/pixel.gif", alt: "Tracker" } },
              { type: "image", attrs: { src: "/api/media/123456789012345678901/view", alt: "Managed" } },
            ],
          })}
          onChange={vi.fn()}
          readOnly
          labels={editorLabels}
        />
      </TooltipProvider>,
    );

    expect(await screen.findByRole("button", { name: "Managed" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tracker" })).not.toBeInTheDocument();
  });

  it("normalizes unsafe saved link attributes before read-only JSON rendering", async () => {
    render(
      <TooltipProvider>
        <TipTapEditor
          value={JSON.stringify({
            type: "doc",
            content: [{
              type: "paragraph",
              content: [{
                type: "text",
                text: "External guide",
                marks: [{
                  type: "link",
                  attrs: {
                    href: "https://external.example/guide",
                    target: "_blank",
                    rel: "opener",
                    class: "unsafe-link",
                  },
                }],
              }],
            }],
          })}
          onChange={vi.fn()}
          readOnly
          labels={editorLabels}
        />
      </TooltipProvider>,
    );

    const link = await screen.findByRole("link", { name: "External guide" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("opens an in-app link dialog instead of the browser prompt", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("https://example.com");
    const user = userEvent.setup();
    renderHtmlEditor();

    await user.click(await screen.findByRole("button", { name: editorLabels.moreFormatting }));
    await user.click(await screen.findByRole("menuitem", { name: editorLabels.link }));

    expect(prompt).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: editorLabels.linkPrompt })).toBeInTheDocument();
  });

  it("exposes the editable surface as a named multiline textbox", async () => {
    render(
      <TooltipProvider>
        <TipTapEditor
          value="<p>Alpha</p>"
          onChange={vi.fn()}
          mode="html"
          editable
          ariaLabel="Article body"
          labels={editorLabels}
        />
      </TooltipProvider>,
    );

    expect(
      await screen.findByRole("textbox", { name: "Article body" }),
    ).toHaveAttribute("aria-multiline", "true");
  });

  it("closes only the nested link or video modal on Escape and restores toolbar focus", async () => {
    const user = userEvent.setup();
    render(<NestedDrawerEditor />);

    const drawer = await screen.findByRole("dialog", { name: "Wiki editor" });
    const formattingTrigger = await within(drawer).findByRole("button", {
      name: editorLabels.moreFormatting,
    });
    await user.click(formattingTrigger);
    await user.click(await screen.findByRole("menuitem", { name: editorLabels.link }));

    expect(await screen.findByRole("dialog", { name: editorLabels.linkPrompt })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: editorLabels.linkPrompt })).not.toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Wiki editor" })).toBeInTheDocument();
      expect(formattingTrigger).toHaveFocus();
    });

    const insertTrigger = within(drawer).getByRole("button", { name: editorLabels.moreInsert });
    await user.click(insertTrigger);
    await user.click(await screen.findByRole("menuitem", { name: editorLabels.embedVideo }));

    expect(await screen.findByRole("dialog", { name: editorLabels.embedVideo })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: editorLabels.embedVideo })).not.toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Wiki editor" })).toBeInTheDocument();
      expect(insertTrigger).toHaveFocus();
    });
  });

  it("applies heading commands from the rendered toolbar", async () => {
    const { onChange } = renderHtmlEditor();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: editorLabels.moreFormatting }));
    await user.click(await screen.findByRole("menuitem", { name: editorLabels.h1 }));

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
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: editorLabels.lightboxTitle })).not.toBeInTheDocument();
    });

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
    render(
      <TooltipProvider>
        <TipTapEditor
          value={'<img src="https://example.com/editable.jpg" alt="Editable image">'}
          onChange={vi.fn()}
          mode="html"
          editable
          labels={editorLabels}
        />
      </TooltipProvider>,
    );

    const image = await screen.findByAltText("Editable image");
    expect(image).not.toHaveAttribute("role", "button");
    expect(image).not.toHaveAttribute("tabindex");

    fireEvent.keyDown(image, { key: "Enter" });
    expect(screen.queryByRole("dialog", { name: editorLabels.lightboxTitle })).not.toBeInTheDocument();
  });

});
