import { extractTipTapText } from "@guild/shared/utils/tiptap-text";
import { diffChars, diffLines, type Change } from "diff";

export type WikiHistoryDiffBlock =
  | { kind: "context" | "added" | "removed"; text: string }
  | { kind: "modified"; parts: Change[] };

export type WikiHistoryColumnWidthChange = Readonly<{
  table: number;
  row: number;
  column: number;
  before: readonly number[] | null;
  after: readonly number[] | null;
}>;

export type WikiHistoryComparison = Readonly<{
  oldTitle: string;
  newTitle: string;
  titleChanged: boolean;
  oldBody: string;
  newBody: string;
  blocks: readonly WikiHistoryDiffBlock[];
  formatChanged: boolean;
  columnWidthChanges: readonly WikiHistoryColumnWidthChange[];
}>;

export type WikiHistoryRevisionContent = Readonly<{ title: string; bodyJson: string }>;

type JsonValue = null | boolean | number | string | JsonValue[] | { readonly [key: string]: JsonValue };
type ParsedJson = Readonly<{ valid: boolean; value: JsonValue | undefined }>;
type JsonObject = Readonly<Record<string, JsonValue>>;
type TableAtPath = Readonly<{ path: string; node: JsonObject }>;

const MAX_CHAR_DIFF_SOURCE = 2000;

export function compareWikiHistory(
  before: WikiHistoryRevisionContent,
  after: WikiHistoryRevisionContent,
): WikiHistoryComparison {
  const oldText = extractTipTapText(before.bodyJson);
  const newText = extractTipTapText(after.bodyJson);
  const oldDocument = parseJson(before.bodyJson);
  const newDocument = parseJson(after.bodyJson);
  const bodyChanged = !equalParsedJson(oldDocument, newDocument, before.bodyJson, after.bodyJson);
  const textChanged = oldText !== newText;

  return {
    oldTitle: before.title,
    newTitle: after.title,
    titleChanged: before.title !== after.title,
    oldBody: before.bodyJson,
    newBody: after.bodyJson,
    blocks: textChanged ? buildDiffBlocks(oldText, newText) : [],
    formatChanged: bodyChanged && !equalJsonWithoutText(oldDocument, newDocument),
    columnWidthChanges: columnWidthChanges(oldDocument, newDocument),
  };
}

export function areWikiHistoryBodiesEqual(before: string, after: string): boolean {
  return equalParsedJson(parseJson(before), parseJson(after), before, after);
}

function buildDiffBlocks(oldText: string, newText: string): WikiHistoryDiffBlock[] {
  const changes = diffLines(oldText, newText);
  const blocks: WikiHistoryDiffBlock[] = [];
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index]!;
    const paired = change.removed ? changes[index + 1] : undefined;
    if (paired?.added) {
      if (change.value.length <= MAX_CHAR_DIFF_SOURCE && paired.value.length <= MAX_CHAR_DIFF_SOURCE) {
        blocks.push({ kind: "modified", parts: diffChars(change.value, paired.value) });
      } else {
        blocks.push({ kind: "removed", text: change.value });
        blocks.push({ kind: "added", text: paired.value });
      }
      index += 1;
      continue;
    }
    if (change.added) blocks.push({ kind: "added", text: change.value });
    else if (change.removed) blocks.push({ kind: "removed", text: change.value });
    else blocks.push({ kind: "context", text: change.value });
  }
  return blocks;
}

function parseJson(source: string): ParsedJson {
  try {
    return { valid: true, value: JSON.parse(source) as JsonValue };
  } catch {
    return { valid: false, value: undefined };
  }
}

function equalParsedJson(before: ParsedJson, after: ParsedJson, beforeSource: string, afterSource: string): boolean {
  if (!before.valid || !after.valid) return beforeSource === afterSource;
  return canonicalJson(before.value) === canonicalJson(after.value);
}

function equalJsonWithoutText(before: ParsedJson, after: ParsedJson): boolean {
  if (!before.valid || !after.valid) return false;
  return canonicalJson(withoutText(before.value)) === canonicalJson(withoutText(after.value));
}

function canonicalJson(value: JsonValue | undefined): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function withoutText(value: JsonValue | undefined): JsonValue | undefined {
  if (Array.isArray(value)) return value.map(withoutText) as JsonValue[];
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "text" || value.type !== "text")
    .map(([key, child]) => [key, withoutText(child)])) as JsonObject;
}

function columnWidthChanges(before: ParsedJson, after: ParsedJson): WikiHistoryColumnWidthChange[] {
  if (!before.valid || !after.valid) return [];
  const afterByPath = new Map(collectTables(after.value).map((table) => [table.path, table]));
  const changes: WikiHistoryColumnWidthChange[] = [];
  for (const [tableIndex, beforeTable] of collectTables(before.value).entries()) {
    const afterTable = afterByPath.get(beforeTable.path);
    if (!afterTable || !matchingTableStructure(beforeTable.node, afterTable.node)) continue;
    const beforeRows = tableRows(beforeTable.node)!;
    const afterRows = tableRows(afterTable.node)!;
    const beforeColumns = logicalColumns(beforeRows);
    for (let row = 0; row < beforeRows.length; row += 1) {
      const beforeCells = rowCells(beforeRows[row]!)!;
      const afterCells = rowCells(afterRows[row]!)!;
      for (let cell = 0; cell < beforeCells.length; cell += 1) {
        const beforeWidth = columnWidth(beforeCells[cell]!);
        const afterWidth = columnWidth(afterCells[cell]!);
        if (sameNumberArray(beforeWidth, afterWidth)) continue;
        changes.push({ table: tableIndex, row, column: beforeColumns[row]![cell]!, before: beforeWidth, after: afterWidth });
      }
    }
  }
  return changes;
}

function collectTables(value: JsonValue | undefined, path: readonly number[] = [], tables: TableAtPath[] = []): TableAtPath[] {
  if (!isObject(value)) return tables;
  if (value.type === "table") tables.push({ path: path.join("."), node: value });
  const content = value.content;
  if (!Array.isArray(content)) return tables;
  for (const [index, child] of content.entries()) collectTables(child, [...path, index], tables);
  return tables;
}

function matchingTableStructure(before: JsonObject, after: JsonObject): boolean {
  const beforeRows = tableRows(before);
  const afterRows = tableRows(after);
  if (!beforeRows || !afterRows || beforeRows.length !== afterRows.length) return false;
  return beforeRows.every((beforeRow, row) => {
    const afterRow = afterRows[row];
    if (!afterRow) return false;
    const beforeCells = rowCells(beforeRow);
    const afterCells = rowCells(afterRow);
    return beforeCells !== null
      && afterCells !== null
      && beforeCells.length === afterCells.length
      && beforeCells.every((beforeCell, column) => {
        const afterCell = afterCells[column];
        return afterCell !== undefined
          && beforeCell.type === afterCell.type
          && cellSpan(beforeCell, "colspan") === cellSpan(afterCell, "colspan")
          && cellSpan(beforeCell, "rowspan") === cellSpan(afterCell, "rowspan");
      });
  });
}

function tableRows(table: JsonObject): JsonObject[] | null {
  if (!Array.isArray(table.content) || !table.content.every((row) => isObject(row) && row.type === "tableRow")) return null;
  return table.content as JsonObject[];
}

function rowCells(row: JsonObject): JsonObject[] | null {
  if (!Array.isArray(row.content) || !row.content.every((cell) =>
    isObject(cell) && (cell.type === "tableCell" || cell.type === "tableHeader"),
  )) return null;
  return row.content as JsonObject[];
}

function columnWidth(cell: JsonObject): readonly number[] | null {
  const attrs = cell.attrs;
  if (!isObject(attrs) || !Array.isArray(attrs.colwidth) || !attrs.colwidth.every((width) => typeof width === "number" && Number.isFinite(width))) {
    return null;
  }
  return attrs.colwidth as number[];
}

function logicalColumns(rows: readonly JsonObject[]): number[][] {
  const occupied = new Map<number, number>();
  return rows.map((row) => {
    let column = 0;
    const columns: number[] = [];
    for (const cell of rowCells(row)!) {
      while ((occupied.get(column) ?? 0) > 0) column += 1;
      columns.push(column);
      const colspan = cellSpan(cell, "colspan");
      const rowspan = cellSpan(cell, "rowspan");
      if (rowspan > 1) {
        for (let offset = 0; offset < colspan; offset += 1) {
          occupied.set(column + offset, Math.max(occupied.get(column + offset) ?? 0, rowspan));
        }
      }
      column += colspan;
    }
    for (const [occupiedColumn, remaining] of occupied) {
      if (remaining <= 1) occupied.delete(occupiedColumn);
      else occupied.set(occupiedColumn, remaining - 1);
    }
    return columns;
  });
}

function cellSpan(cell: JsonObject, name: "colspan" | "rowspan"): number {
  const attrs = cell.attrs;
  const value = isObject(attrs) ? attrs[name] : undefined;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
}

function sameNumberArray(before: readonly number[] | null, after: readonly number[] | null): boolean {
  return before === after || (before !== null && after !== null && before.length === after.length
    && before.every((value, index) => value === after[index]));
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
