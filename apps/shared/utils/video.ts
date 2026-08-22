function safeUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed : null;
  } catch {
    return null;
  }
}

const DIRECT_VIDEO_EXTENSIONS = [".mp4", ".webm", ".ogg", ".ogv", ".mov", ".m4v"];

export const EMBEDDABLE_VIDEO_HOSTS = [
  "youtube.com",
  "youtu.be",
  "bilibili.com",
  "vimeo.com",
  "tiktok.com",
] as const;

export const ALLOWED_VIDEO_HOSTS = [
  ...EMBEDDABLE_VIDEO_HOSTS,
  "douyin.com",
] as const;

export const EMBED_FRAME_SOURCES = [
  "https://www.youtube-nocookie.com",
  "https://player.bilibili.com",
  "https://player.vimeo.com",
  "https://www.tiktok.com",
] as const;

function hostMatches(host: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

export function isDirectPlayableVideoUrl(url: string): boolean {
  const parsed = safeUrl(url);
  if (!parsed) {
    return false;
  }

  const pathname = parsed.pathname.toLowerCase();
  return DIRECT_VIDEO_EXTENSIONS.some((ext) => pathname.endsWith(ext));
}

export function isEmbeddableVideoUrl(url: string): boolean {
  const parsed = safeUrl(url);
  if (!parsed) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (hostMatches(host, ["douyin.com"])) {
    return false;
  }
  return hostMatches(host, EMBEDDABLE_VIDEO_HOSTS);
}

export function isAllowedVideoUrl(url: string): boolean {
  const parsed = safeUrl(url);
  if (!parsed) return false;
  return hostMatches(parsed.hostname.toLowerCase(), ALLOWED_VIDEO_HOSTS);
}

export function isAllowedGalleryVideoUrl(url: string): boolean {
  return isEmbeddableVideoUrl(url);
}

/** The allow-list entry a gallery video resolves to. Audit records may keep the host but never the URL,
    which can carry identifiers that do not belong in a log. */
export function galleryVideoHost(url: string): string | null {
  const host = safeUrl(url)?.hostname.toLowerCase();
  if (!host) return null;
  return EMBEDDABLE_VIDEO_HOSTS.find((candidate) => hostMatches(host, [candidate])) ?? null;
}

export function toEmbedVideoUrl(url: string): string {
  const parsed = safeUrl(url);
  if (!parsed) {
    return url;
  }

  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname;

  if (hostMatches(host, ["youtu.be"])) {
    const id = pathname.slice(1).split("/")[0] ?? "";
    if (!id) return url;
    return `https://www.youtube-nocookie.com/embed/${id}`;
  }

  if (hostMatches(host, ["youtube.com"])) {
    const id = parsed.searchParams.get("v") ?? "";
    if (!id) return url;
    return `https://www.youtube-nocookie.com/embed/${id}`;
  }

  if (hostMatches(host, ["bilibili.com"])) {
    const segments = pathname.split("/").filter(Boolean);
    const bvid = segments.find((segment) => /^BV/i.test(segment)) ?? "";
    if (!bvid) return url;
    return `https://player.bilibili.com/player.html?bvid=${bvid}`;
  }

  if (hostMatches(host, ["vimeo.com"])) {
    const id = pathname.split("/").filter(Boolean).at(-1) ?? "";
    if (!id) return url;
    return `https://player.vimeo.com/video/${id}`;
  }

  if (hostMatches(host, ["tiktok.com"])) {
    const segments = pathname.split("/").filter(Boolean);
    const videoIndex = segments.indexOf("video");
    const videoId = videoIndex >= 0 ? segments[videoIndex + 1] ?? "" : "";
    if (!videoId) return url;
    return `https://www.tiktok.com/embed/v2/${videoId}`;
  }

  return url;
}

export function getVideoThumbnailUrl(url: string): string | null {
  const parsed = safeUrl(url);
  if (!parsed) return null;

  const host = parsed.hostname.toLowerCase();

  if (hostMatches(host, ["youtu.be"])) {
    const id = parsed.pathname.slice(1).split("/")[0] ?? "";
    return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null;
  }

  if (hostMatches(host, ["youtube.com"])) {
    const id = parsed.searchParams.get("v") ?? "";
    return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null;
  }

  if (hostMatches(host, ["bilibili.com"])) {
    return null;
  }

  return null;
}
