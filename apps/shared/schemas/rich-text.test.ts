import { describe, expect, it } from "vitest";
import { findRichTextProblem, isSafeCssValue } from "./rich-text";

function doc(content: unknown[]): Record<string, unknown> {
  return { type: "doc", content };
}

function text(value: string, marks?: unknown[]): Record<string, unknown> {
  return marks ? { type: "text", text: value, marks } : { type: "text", text: value };
}

describe("findRichTextProblem", () => {
  it("accepts the empty document the editor starts from", () => {
    expect(findRichTextProblem(doc([]))).toBeNull();
    expect(findRichTextProblem(doc([{ type: "paragraph", content: [] }]))).toBeNull();
  });

  it("accepts a document using every editor node and mark", () => {
    const fullDocument = doc([
      { type: "heading", attrs: { level: 2, textAlign: "center" }, content: [text("Title")] },
      {
        type: "paragraph",
        attrs: { textAlign: null },
        content: [
          text("plain "),
          text("styled", [
            { type: "bold" },
            { type: "italic" },
            { type: "strike" },
            { type: "underline" },
            { type: "code" },
            { type: "textStyle", attrs: { color: "#e03131" } },
            { type: "highlight", attrs: { color: "rgba(255, 200, 0, 0.4)" } },
            {
              type: "link",
              attrs: { href: "https://example.com/page", target: "_blank", rel: "noopener noreferrer", class: null },
            },
          ]),
          { type: "hardBreak" },
        ],
      },
      { type: "blockquote", content: [{ type: "paragraph", content: [text("quote")] }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("a")] }] }] },
      {
        type: "orderedList",
        attrs: { start: 3, type: null },
        content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("b")] }] }],
      },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [text("done")] }] }] },
      { type: "codeBlock", attrs: { language: "ts" }, content: [text("const x = 1;")] },
      { type: "horizontalRule" },
      { type: "image", attrs: { src: "/api/media/media1234567890abcdef/view", alt: null, title: null } },
      { type: "image", attrs: { src: "/api/media/image1234567890abcdef/view", alt: "diagram", title: "Diagram" } },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: [120] }, content: [{ type: "paragraph", content: [text("h")] }] },
              { type: "tableCell", attrs: { colspan: 2, rowspan: 1, colwidth: null }, content: [{ type: "paragraph", content: [text("c")] }] },
            ],
          },
        ],
      },
      { type: "youtube", attrs: { src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", start: 0, width: 640, height: 480 } },
      { type: "bilibili", attrs: { src: "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&high_quality=1", width: 640, height: 480 } },
      {
        type: "details",
        attrs: { open: false },
        content: [
          { type: "detailsSummary", content: [text("summary")] },
          { type: "detailsContent", content: [{ type: "paragraph", content: [text("body")] }] },
        ],
      },
    ]);

    expect(findRichTextProblem(fullDocument)).toBeNull();
  });

  it("rejects roots and node types outside the editor set", () => {
    expect(findRichTextProblem([])).toContain("object");
    expect(findRichTextProblem({ type: "paragraph" })).toContain('root must be a "doc"');
    expect(findRichTextProblem(doc([{ type: "script" }]))).toContain('unknown node type "script"');
    expect(findRichTextProblem(doc([{ type: "doc", content: [] }]))).toContain("only allowed at the root");
  });

  it("rejects javascript: and data: URLs wherever a URL is stored", () => {
    expect(findRichTextProblem(doc([
      { type: "paragraph", content: [text("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }])] },
    ]))).toContain('attr "href"');
    // Browsers strip control characters before scheme detection; so do we.
    expect(findRichTextProblem(doc([
      { type: "paragraph", content: [text("x", [{ type: "link", attrs: { href: " java\nscript:alert(1)" } }])] },
    ]))).toContain('attr "href"');
    expect(findRichTextProblem(doc([
      { type: "image", attrs: { src: "data:text/html,<script>alert(1)</script>" } },
    ]))).toContain('attr "src"');
    expect(findRichTextProblem(doc([
      { type: "youtube", attrs: { src: "https://evil.example.com/embed/x" } },
    ]))).toContain('attr "src"');
    expect(findRichTextProblem(doc([
      { type: "bilibili", attrs: { src: "javascript:alert(1)" } },
    ]))).toContain('attr "src"');
  });

  it("rejects style values that could escape the style attribute", () => {
    expect(findRichTextProblem(doc([
      { type: "paragraph", content: [text("x", [{ type: "textStyle", attrs: { color: "expression(alert(1))" } }])] },
    ]))).toContain('attr "color"');
    expect(findRichTextProblem(doc([
      { type: "paragraph", content: [text("x", [{ type: "highlight", attrs: { color: 'red" onmouseover="alert(1)' } }])] },
    ]))).toContain('attr "color"');
  });

  it("rejects unknown attrs, misplaced marks, and text with children", () => {
    expect(findRichTextProblem(doc([
      { type: "paragraph", attrs: { onClick: "alert(1)" } },
    ]))).toContain('unknown attr "onClick"');
    expect(findRichTextProblem(doc([
      { type: "paragraph", marks: [{ type: "bold" }] },
    ]))).toContain("marks are not allowed");
    expect(findRichTextProblem(doc([
      { type: "paragraph", content: [{ type: "text", text: "x", content: [] }] },
    ]))).toContain("text node cannot have content");
    expect(findRichTextProblem(doc([
      { type: "image", attrs: { src: "/a.png" }, content: [{ type: "paragraph" }] },
    ]))).toContain("cannot have children");
    expect(findRichTextProblem(doc([
      { type: "paragraph", innerHTML: "<script>" },
    ]))).toContain('unknown key "innerHTML"');
  });

  it("rejects documents nested beyond the depth limit", () => {
    let node: Record<string, unknown> = { type: "paragraph", content: [] };
    for (let i = 0; i < 70; i += 1) {
      node = { type: "blockquote", content: [node] };
    }
    expect(findRichTextProblem(doc([node]))).toContain("deeper than");
  });
});

describe("isSafeCssValue", () => {
  it("accepts colours and rejects attribute breakouts", () => {
    expect(isSafeCssValue("#e03131")).toBe(true);
    expect(isSafeCssValue("rgb(255, 0, 0)")).toBe(true);
    expect(isSafeCssValue("url(https://evil)")).toBe(false);
    expect(isSafeCssValue('red" onload="alert(1)')).toBe(false);
    expect(isSafeCssValue("color: \\75 rl(x)")).toBe(false);
  });
});
