// Plain-text projection of TipTap JSON shared by portal revision diffing and
// the persistence search_text column: text nodes are concatenated and
// block-level nodes become lines, so diffs and substring search both map onto
// the rendered document instead of JSON syntax noise.

type TipTapNode = {
  type?: string;
  text?: string;
  content?: TipTapNode[];
  attrs?: Record<string, unknown>;
};

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "listItem",
  "taskItem",
  "tableRow",
  "horizontalRule",
]);

function walk(node: TipTapNode, lines: string[], buffer: { current: string }): void {
  if (typeof node.text === "string") {
    buffer.current += node.text;
  }
  if (node.type === "image") {
    buffer.current += "[image]";
  }
  if (node.type === "hardBreak") {
    lines.push(buffer.current);
    buffer.current = "";
  }
  for (const child of node.content ?? []) {
    walk(child, lines, buffer);
  }
  if (node.type && BLOCK_TYPES.has(node.type)) {
    lines.push(buffer.current);
    buffer.current = "";
  }
}

export function extractTipTapText(bodyJson: string): string {
  let root: TipTapNode;
  try {
    root = JSON.parse(bodyJson) as TipTapNode;
  } catch {
    return bodyJson;
  }
  if (root === null || typeof root !== "object") return bodyJson;
  const lines: string[] = [];
  const buffer = { current: "" };
  walk(root, lines, buffer);
  if (buffer.current.length > 0) lines.push(buffer.current);
  return lines.join("\n");
}
