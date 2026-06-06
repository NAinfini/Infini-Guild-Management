function isAlreadyResolved(key: string): boolean {
  return /^(?:https?:)?\/\//i.test(key) || key.startsWith("data:") || key.startsWith("blob:") || key.startsWith("/mock/");
}

function buildMediaUrl(endpoint: string, key: string): string {
  if (isAlreadyResolved(key)) return key;
  if (typeof window === "undefined") return `${endpoint}?key=${encodeURIComponent(key)}`;
  const url = new URL(endpoint, window.location.origin);
  url.searchParams.set("key", key);
  return url.toString();
}

export function resolveProfileMediaUrl(key: string): string {
  return buildMediaUrl("/api/users/image", key);
}

export function resolveEventMediaUrl(key: string): string {
  return buildMediaUrl("/api/events/image", key);
}

export function resolveGalleryMediaUrl(key: string): string {
  return buildMediaUrl("/api/gallery/image", key);
}
