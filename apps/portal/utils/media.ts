function isAlreadyResolved(key: string): boolean {
  return /^(?:https?:)?\/\//i.test(key) || key.startsWith("data:") || key.startsWith("blob:") || key.startsWith("/mock/");
}

export type MediaVariant = "view" | "full";

export function resolveMediaUrl(mediaId: string, variant: MediaVariant = "view"): string {
  if (isAlreadyResolved(mediaId)) return mediaId;
  const path = `/api/media/${encodeURIComponent(mediaId)}/${variant}`;
  return typeof window === "undefined" ? path : new URL(path, window.location.origin).toString();
}

export function withMediaVariant(source: string, variant: MediaVariant): string {
  return source.replace(
    /(\/api\/media\/[A-Za-z0-9_-]{21})\/(?:view|full)(?=[?#]|$)/,
    `$1/${variant}`,
  );
}
