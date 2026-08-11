import { mediaIdSchema } from "@guild/shared";
import { AppError } from "@guild/kernel";

const MEDIA_VIEW_PATH = /^\/api\/media\/([A-Za-z0-9_-]{21})\/view$/;

type RichTextNode = {
  type?: unknown;
  attrs?: Record<string, unknown>;
  content?: unknown;
};

/** Stores deployment-neutral media paths while leaving unrelated external images untouched. */
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

  const origin = new URL(requestOrigin).origin;
  visitNodes(document, (node) => {
    const src = node.type === "image" ? node.attrs?.src : undefined;
    if (typeof src !== "string") return;

    let parsed: URL;
    try {
      parsed = new URL(src, origin);
    } catch {
      return;
    }
    if (parsed.origin === origin && MEDIA_VIEW_PATH.test(parsed.pathname) && !parsed.search && !parsed.hash) {
      node.attrs = { ...node.attrs, src: parsed.pathname };
    }
  });

  return JSON.stringify(document);
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
