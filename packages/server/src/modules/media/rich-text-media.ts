import {
  canonicalizeRichTextLinkAttributes,
  findRichTextProblem,
  mediaIdSchema,
} from "@guild/shared";
import { AppError } from "@guild/kernel";

const MEDIA_VIEW_PATH = /^\/api\/media\/([A-Za-z0-9_-]{21})\/view$/;

type RichTextNode = {
  type?: unknown;
  attrs?: Record<string, unknown>;
  marks?: unknown;
  content?: unknown;
};

/**
 * Validates persisted TipTap JSON, stores deployment-neutral media paths, and
 * normalizes link navigation attributes before readers can render the body.
 */
export function canonicalizeRichTextMedia(bodyJson: string, requestOrigin: string): string {
  let document: unknown;
  try {
    document = JSON.parse(bodyJson) as unknown;
  } catch {
    throw new AppError({
      code: "VALIDATION_ERROR",
      status: 400,
      message: "Rich text must be valid JSON",
    });
  }

  assertSupportedRichTextDocument(document);
  const origin = new URL(requestOrigin).origin;
  visitNodes(document, (node) => {
    if (Array.isArray(node.marks)) {
      node.marks = node.marks.map((mark) => {
        if (!isLinkMark(mark)) return mark;
        const attrs = canonicalizeRichTextLinkAttributes(mark.attrs ?? {}, origin);
        if (!attrs) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            status: 400,
            message: "Unsupported rich-text content: invalid link href",
          });
        }
        return {
          ...mark,
          attrs,
        };
      });
    }

    const src = node.type === "image" ? node.attrs?.src : undefined;
    if (typeof src !== "string") return;

    let parsed: URL;
    try {
      parsed = new URL(src, origin);
    } catch {
      throw unmanagedRichTextImage();
    }
    const match = MEDIA_VIEW_PATH.exec(parsed.pathname);
    if (
      parsed.origin !== origin
      || !match
      || !mediaIdSchema.safeParse(match[1]).success
      || parsed.search
      || parsed.hash
    ) throw unmanagedRichTextImage();
    node.attrs = { ...node.attrs, src: parsed.pathname };
  });

  assertSupportedRichTextDocument(document);
  return JSON.stringify(document);
}

function assertSupportedRichTextDocument(document: unknown): void {
  const problem = findRichTextProblem(document);
  if (!problem) return;
  throw new AppError({
    code: "VALIDATION_ERROR",
    status: 400,
    message: `Unsupported rich-text content: ${problem}`,
  });
}

function isLinkMark(value: unknown): value is Readonly<{ type: "link"; attrs?: Record<string, unknown> }> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as { type?: unknown }).type === "link";
}

function unmanagedRichTextImage(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    status: 400,
    message: "Rich-text images must use uploaded site media",
  });
}

export function extractRichTextMediaIds(bodyJson: string): readonly string[] {
  let document: unknown;
  try {
    document = JSON.parse(bodyJson) as unknown;
  } catch {
    return [];
  }

  const ids = new Set<string>();
  visitNodes(document, (node) => {
    const src = node.type === "image" ? node.attrs?.src : undefined;
    if (typeof src !== "string") return;
    const match = MEDIA_VIEW_PATH.exec(src);
    if (match && mediaIdSchema.safeParse(match[1]).success) ids.add(match[1]!);
  });
  return [...ids];
}

function visitNodes(value: unknown, visitor: (node: RichTextNode) => void): void {
  if (!value || typeof value !== "object") return;
  const node = value as RichTextNode;
  visitor(node);
  if (Array.isArray(node.content)) {
    for (const child of node.content) visitNodes(child, visitor);
  }
}
