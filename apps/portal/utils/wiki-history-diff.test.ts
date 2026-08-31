import { describe, expect, it } from "vitest";
import { areWikiHistoryBodiesEqual, compareWikiHistory } from "./wiki-history-diff";

function document(content: unknown[]): string {
  return JSON.stringify({ type: "doc", content });
}

function tableDocument(width: number[], options: { extraRow?: boolean; leadingParagraph?: boolean } = {}): string {
  const row = {
    type: "tableRow",
    content: [{
      type: "tableCell",
      attrs: { colspan: 1, rowspan: 1, colwidth: width },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Cell" }] }],
    }],
  };
  return document([
    ...(options.leadingParagraph ? [{ type: "paragraph", content: [{ type: "text", text: "Intro" }] }] : []),
    { type: "table", content: [row, ...(options.extraRow ? [row] : [])] },
  ]);
}

function spannedTableDocument(targetWidth: number[], colspan = 2): string {
  return document([{
    type: "table",
    content: [{
      type: "tableRow",
      content: [
        {
          type: "tableCell",
          attrs: { colspan, rowspan: 1, colwidth: colspan === 2 ? [80, 80] : [80] },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Wide" }] }],
        },
        {
          type: "tableCell",
          attrs: { colspan: 1, rowspan: 1, colwidth: targetWidth },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Target" }] }],
        },
      ],
    }],
  }]);
}

describe("wiki history semantic diff", () => {
  it("ignores JSON object key order", () => {
    const before = '{"content":[{"content":[{"text":"Same","type":"text"}],"type":"paragraph"}],"type":"doc"}';
    const after = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Same"}]}]}';

    expect(areWikiHistoryBodiesEqual(before, after)).toBe(true);
    expect(compareWikiHistory({ title: "Guide", bodyJson: before }, { title: "Guide", bodyJson: after }))
      .toMatchObject({ titleChanged: false, formatChanged: false, blocks: [], columnWidthChanges: [] });
  });

  it("reports a table column-width change without inventing a text diff", () => {
    const before = tableDocument([96]);
    const after = tableDocument([144]);
    const comparison = compareWikiHistory(
      { title: "Guide", bodyJson: before },
      { title: "Guide", bodyJson: after },
    );

    expect(comparison.oldBody).toBe(before);
    expect(comparison.newBody).toBe(after);
    expect(comparison.blocks).toEqual([]);
    expect(comparison.formatChanged).toBe(true);
    expect(comparison.columnWidthChanges).toEqual([{
      table: 0,
      row: 0,
      column: 0,
      before: [96],
      after: [144],
    }]);
  });

  it("uses logical table columns and suppresses widths after merge changes", () => {
    const comparison = compareWikiHistory(
      { title: "Guide", bodyJson: spannedTableDocument([96]) },
      { title: "Guide", bodyJson: spannedTableDocument([144]) },
    );
    const merged = compareWikiHistory(
      { title: "Guide", bodyJson: spannedTableDocument([96]) },
      { title: "Guide", bodyJson: spannedTableDocument([144], 1) },
    );

    expect(comparison.columnWidthChanges).toEqual([{
      table: 0,
      row: 0,
      column: 2,
      before: [96],
      after: [144],
    }]);
    expect(merged).toMatchObject({ formatChanged: true, columnWidthChanges: [] });
  });

  it("counts marks and document structure as formatting changes while keeping equal text out of blocks", () => {
    const marked = document([{
      type: "paragraph",
      content: [{ type: "text", text: "Same", marks: [{ type: "bold" }] }],
    }]);
    const heading = document([{
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Same" }],
    }]);

    const marks = compareWikiHistory({ title: "Guide", bodyJson: marked }, { title: "Guide", bodyJson: document([{
      type: "paragraph", content: [{ type: "text", text: "Same" }],
    }]) });
    const structure = compareWikiHistory({ title: "Guide", bodyJson: marked }, { title: "Guide", bodyJson: heading });

    expect(marks).toMatchObject({ formatChanged: true, blocks: [], columnWidthChanges: [] });
    expect(structure).toMatchObject({ formatChanged: true, blocks: [], columnWidthChanges: [] });
  });

  it("does not associate widths when table cell paths no longer match", () => {
    const comparison = compareWikiHistory(
      { title: "Guide", bodyJson: tableDocument([96]) },
      { title: "Guide", bodyJson: tableDocument([144], { extraRow: true }) },
    );

    expect(comparison.formatChanged).toBe(true);
    expect(comparison.columnWidthChanges).toEqual([]);
  });

  it("keeps blocks for actual text changes", () => {
    const comparison = compareWikiHistory(
      { title: "Guide", bodyJson: document([{ type: "paragraph", content: [{ type: "text", text: "Before" }] }]) },
      { title: "Guide", bodyJson: document([{ type: "paragraph", content: [{ type: "text", text: "After" }] }]) },
    );

    expect(comparison.blocks.some((block) => block.kind !== "context")).toBe(true);
    expect(comparison.formatChanged).toBe(false);
  });
});
