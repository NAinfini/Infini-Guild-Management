import { z } from "zod";

/*
 * Server-side allowlist for TipTap/ProseMirror rich-text documents
 * (announcement and wiki bodies).
 *
 * The database only guarantees "valid JSON object", and the read-only renderer
 * rebuilds real DOM from whatever is stored — an iframe src, a link href or a
 * style colour taken from an unvalidated document is a stored-XSS vector, and
 * an unknown node type crashes the renderer for every visitor. This validator
 * accepts exactly the node types, marks and attribute shapes the portal editor
 * can produce, so a hand-crafted API payload cannot store anything the editor
 * itself could not have written.
 */

/*
 * Style values are re-embedded into `style="…"` attributes by the renderer and
 * by the worker's inline-HTML sanitizer. The pattern leaves no way to close
 * the attribute (no quotes) or end the declaration (no semicolons); the
 * denylist blocks URL loads, CSS expressions and escape sequences.
 */
export const SAFE_CSS_VALUE_PATTERN = /^[\w\s#,.%()/-]{1,64}$/;
export const CSS_VALUE_DENYLIST = /url\s*\(|image\s*\(|expression\s*\(|\\/i;

export function isSafeCssValue(value: string): boolean {
  return SAFE_CSS_VALUE_PATTERN.test(value) && !CSS_VALUE_DENYLIST.test(value);
}

const MAX_DEPTH = 64;
const MAX_TEXT_LENGTH = 100_000;
const MAX_URL_LENGTH = 2048;
const SECURE_NEW_WINDOW_REL = "noopener noreferrer";

type Check = (value: unknown) => boolean;

const isNull: Check = (value) => value === null;
const isBoolean: Check = (value) => typeof value === "boolean";
const anyOf = (...checks: Check[]): Check => (value) => checks.some((check) => check(value));
const boundedString = (max: number): Check => (value) => typeof value === "string" && value.length <= max;
const stringMatching = (pattern: RegExp, max: number): Check => (value) =>
  typeof value === "string" && value.length <= max && pattern.test(value);
const intBetween = (min: number, max: number): Check => (value) =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const cssValue: Check = (value) => typeof value === "string" && isSafeCssValue(value);

function safeLinkRel(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "string" || value.length > 64) return false;

  const tokens = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.length === 0 || (
    new Set(tokens).size === tokens.length
    && tokens.every((token) => token === "noopener" || token === "noreferrer")
  );
}

/*
 * Browsers strip ASCII control characters and spaces when parsing URLs, so
 * " javascript:…" and "java\nscript:…" still execute. Mirror that stripping
 * before deciding whether a value carries an explicit scheme.
 */
function stripUrlControlCharacters(value: string): string {
  let result = "";
  for (const character of value) {
    if (character.charCodeAt(0) > 0x20) result += character;
  }
  return result;
}

function hasExplicitScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

/** Relative paths and media keys are fine; explicit schemes must be http(s). */
const safeHrefOrPath: Check = (value) => {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  const stripped = stripUrlControlCharacters(value);
  if (hasExplicitScheme(stripped) && !/^https?:/i.test(stripped)) return false;
  try {
    new URL(stripped, "https://portal.invalid");
    return true;
  } catch {
    return false;
  }
};

function httpsUrlOnHosts(hosts: readonly string[]): Check {
  return (value) => {
    if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return false;
    let url;
    try {
      url = new URL(stripUrlControlCharacters(value));
    } catch {
      return false;
    }
    return url.protocol === "https:" && hosts.includes(url.hostname);
  };
}

const YOUTUBE_EMBED_HOSTS = [
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "youtu.be",
] as const;

const BILIBILI_EMBED_HOSTS = ["player.bilibili.com"] as const;

const textAlign = anyOf(isNull, (value) =>
  value === "left" || value === "center" || value === "right" || value === "justify");
const tableAlign = anyOf(isNull, (value) =>
  value === "left" || value === "center" || value === "right");
const tableCellAttrs: Record<string, Check> = {
  align: tableAlign,
  colspan: intBetween(1, 64),
  rowspan: intBetween(1, 64),
  // ProseMirror uses zero for an unmeasured column in a merged cell.
  colwidth: anyOf(isNull, (value) =>
    Array.isArray(value) && value.length <= 64 && value.every((item) => intBetween(0, 100_000)(item))),
};

type NodeSpec = {
  attrs?: Record<string, Check>;
  requiredAttrs?: readonly string[];
  /** Atom/leaf nodes must not carry children. */
  leaf?: boolean;
};

const NODE_SPECS: Record<string, NodeSpec> = {
  doc: {},
  paragraph: { attrs: { textAlign } },
  heading: { attrs: { level: intBetween(1, 6), textAlign }, requiredAttrs: ["level"] },
  text: { leaf: true },
  hardBreak: { leaf: true },
  horizontalRule: { leaf: true },
  blockquote: {},
  bulletList: {},
  orderedList: { attrs: { start: anyOf(isNull, intBetween(0, 1_000_000_000)), type: anyOf(isNull, stringMatching(/^[1aAiI]$/, 1)) } },
  listItem: {},
  taskList: {},
  taskItem: { attrs: { checked: isBoolean } },
  codeBlock: { attrs: { language: anyOf(isNull, stringMatching(/^[\w+#.-]{1,40}$/, 40)) } },
  image: {
    leaf: true,
    attrs: {
      src: safeHrefOrPath,
      alt: anyOf(isNull, boundedString(500)),
      title: anyOf(isNull, boundedString(500)),
      width: anyOf(isNull, intBetween(0, 100_000)),
      height: anyOf(isNull, intBetween(0, 100_000)),
    },
    requiredAttrs: ["src"],
  },
  table: {},
  tableRow: {},
  tableHeader: { attrs: tableCellAttrs },
  tableCell: { attrs: tableCellAttrs },
  youtube: {
    leaf: true,
    attrs: {
      src: httpsUrlOnHosts(YOUTUBE_EMBED_HOSTS),
      start: anyOf(isNull, intBetween(0, 1_000_000_000)),
      width: anyOf(isNull, intBetween(0, 100_000)),
      height: anyOf(isNull, intBetween(0, 100_000)),
    },
    requiredAttrs: ["src"],
  },
  bilibili: {
    leaf: true,
    attrs: {
      src: httpsUrlOnHosts(BILIBILI_EMBED_HOSTS),
      width: anyOf(isNull, intBetween(0, 100_000)),
      height: anyOf(isNull, intBetween(0, 100_000)),
    },
    requiredAttrs: ["src"],
  },
  details: { attrs: { open: isBoolean } },
  detailsSummary: {},
  detailsContent: {},
};

type MarkSpec = {
  attrs?: Record<string, Check>;
  requiredAttrs?: readonly string[];
};

const MARK_SPECS: Record<string, MarkSpec> = {
  bold: {},
  italic: {},
  strike: {},
  underline: {},
  code: {},
  link: {
    attrs: {
      href: safeHrefOrPath,
      title: anyOf(isNull, boundedString(500)),
      target: anyOf(isNull, (value) => value === "_blank" || value === "_self"),
      rel: safeLinkRel,
      class: isNull,
    },
    requiredAttrs: ["href"],
  },
  highlight: { attrs: { color: anyOf(isNull, cssValue) } },
  textStyle: { attrs: { color: anyOf(isNull, cssValue) } },
};

/**
 * The server owns navigation attributes rather than trusting serialized editor
 * JSON. External links always open in a separate tab with reverse-tabnabbing
 * protection; internal links keep their explicit target when safe, otherwise
 * use the current tab. User supplied `rel` and `class` never reach a reader.
 * Invalid links return null so a defensive reader can omit only that mark.
 */
export function canonicalizeRichTextLinkAttributes(
  attrs: Readonly<Record<string, unknown>>,
  requestOrigin: string,
): Record<string, unknown> | null {
  const href = typeof attrs.href === "string" ? attrs.href : "";
  if (!safeHrefOrPath(href)) return null;

  let origin: string;
  let destination: URL;
  try {
    origin = new URL(requestOrigin).origin;
    destination = new URL(stripUrlControlCharacters(href), origin);
  } catch {
    return null;
  }
  const target = destination.origin !== origin || attrs.target === "_blank" ? "_blank" : "_self";

  return {
    ...attrs,
    target,
    rel: target === "_blank" ? SECURE_NEW_WINDOW_REL : null,
    class: null,
  };
}

/** Marks only appear on inline content in editor output. */
const MARK_CARRIERS = new Set(["text", "hardBreak"]);

const NODE_KEYS = new Set(["type", "attrs", "content", "marks", "text"]);
const MARK_KEYS = new Set(["type", "attrs"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findAttrsProblem(
  attrs: unknown,
  spec: NodeSpec | MarkSpec,
  label: string,
): string | null {
  const checks = spec.attrs ?? {};
  const provided = isPlainObject(attrs) ? attrs : attrs === undefined ? {} : null;
  if (provided === null) return `${label} attrs must be an object`;
  for (const [key, value] of Object.entries(provided)) {
    const check = checks[key];
    if (!check) return `unknown attr "${key}" on ${label}`;
    if (!check(value)) return `invalid value for attr "${key}" on ${label}`;
  }
  for (const required of spec.requiredAttrs ?? []) {
    if (provided[required] === undefined || provided[required] === null) {
      return `${label} requires attr "${required}"`;
    }
  }
  return null;
}

function findMarksProblem(marks: unknown, nodeType: string): string | null {
  if (marks === undefined) return null;
  if (!Array.isArray(marks)) return `marks on "${nodeType}" must be an array`;
  if (!MARK_CARRIERS.has(nodeType)) return `marks are not allowed on "${nodeType}"`;
  for (const mark of marks) {
    if (!isPlainObject(mark)) return `mark on "${nodeType}" must be an object`;
    for (const key of Object.keys(mark)) {
      if (!MARK_KEYS.has(key)) return `unknown key "${key}" on a mark`;
    }
    const markType = mark.type;
    if (typeof markType !== "string") return "mark type must be a string";
    const spec = MARK_SPECS[markType];
    if (!spec) return `unknown mark type "${markType}"`;
    const attrsProblem = findAttrsProblem(mark.attrs, spec, `mark "${markType}"`);
    if (attrsProblem) return attrsProblem;
  }
  return null;
}

/**
 * Returns a description of the first disallowed construct, or null when the
 * document only contains editor-producible content.
 */
export function findRichTextProblem(document: unknown): string | null {
  if (!isPlainObject(document)) return "document must be an object";
  if (document.type !== "doc") return 'document root must be a "doc" node';

  const stack: Array<{ node: Record<string, unknown>; depth: number }> = [{ node: document, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > MAX_DEPTH) return `nesting deeper than ${MAX_DEPTH} levels`;

    for (const key of Object.keys(node)) {
      if (!NODE_KEYS.has(key)) return `unknown key "${key}" on a node`;
    }
    const type = node.type;
    if (typeof type !== "string") return "node type must be a string";
    if (type === "doc" && depth > 0) return '"doc" is only allowed at the root';
    const spec = NODE_SPECS[type];
    if (!spec) return `unknown node type "${type}"`;

    const attrsProblem = findAttrsProblem(node.attrs, spec, `node "${type}"`);
    if (attrsProblem) return attrsProblem;
    const marksProblem = findMarksProblem(node.marks, type);
    if (marksProblem) return marksProblem;

    if (type === "text") {
      if (typeof node.text !== "string" || node.text.length === 0) return "text node requires text";
      if (node.text.length > MAX_TEXT_LENGTH) return "text node is too long";
      if (node.content !== undefined) return "text node cannot have content";
      continue;
    }
    if (node.text !== undefined) return `"${type}" node cannot carry text`;

    const content = node.content;
    if (content === undefined) continue;
    if (!Array.isArray(content)) return `content of "${type}" must be an array`;
    if (spec.leaf && content.length > 0) return `"${type}" node cannot have children`;
    for (const child of content) {
      if (!isPlainObject(child)) return `child of "${type}" must be an object`;
      stack.push({ node: child, depth: depth + 1 });
    }
  }
  return null;
}

/**
 * A serialized rich-text document: a JSON object whose node/mark/attr shapes
 * all pass the editor allowlist above.
 */
export function richTextDocumentStringSchema(base: z.ZodString) {
  return base.superRefine((value, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "Must be a valid JSON object" });
      return;
    }
    if (!isPlainObject(parsed)) {
      ctx.addIssue({ code: "custom", message: "Must be a valid JSON object" });
      return;
    }
    const problem = findRichTextProblem(parsed);
    if (problem) {
      ctx.addIssue({ code: "custom", message: `Unsupported rich-text content: ${problem}` });
    }
  });
}
