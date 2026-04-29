function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

const DIRECT_VIDEO_EXTENSIONS = [".mp4", ".webm", ".ogg", ".ogv", ".mov", ".m4v"];

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
  if (host.includes("douyin.com")) {
    return false;
  }
  return (
    host.includes("youtube.com") ||
    host.includes("youtu.be") ||
    host.includes("bilibili.com") ||
    host.includes("vimeo.com") ||
    host.includes("tiktok.com")
  );
}

/**
 * Validates that a URL is an allowed gallery video URL.
 * Only URLs from known embeddable hosts are accepted; arbitrary URLs are rejected
 * to prevent SSRF / iframe injection via the gallery lightbox.
 */
export function isAllowedGalleryVideoUrl(url: string): boolean {
  return isEmbeddableVideoUrl(url);
}

export function toEmbedVideoUrl(url: string): string {
  const parsed = safeUrl(url);
  if (!parsed) {
    return url;
  }

  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname;

  if (host.includes("youtu.be")) {
    const id = pathname.slice(1).split("/")[0] ?? "";
    if (!id) return url;
    return `https://www.youtube.com/embed/${id}`;
  }

  if (host.includes("youtube.com")) {
    const id = parsed.searchParams.get("v") ?? "";
    if (!id) return url;
    return `https://www.youtube.com/embed/${id}`;
  }

  if (host.includes("bilibili.com")) {
    const segments = pathname.split("/").filter(Boolean);
    const bvid = segments.find((segment) => /^BV/i.test(segment)) ?? "";
    if (!bvid) return url;
    return `https://player.bilibili.com/player.html?bvid=${bvid}`;
  }

  if (host.includes("vimeo.com")) {
    const id = pathname.split("/").filter(Boolean).at(-1) ?? "";
    if (!id) return url;
    return `https://player.vimeo.com/video/${id}`;
  }

  if (host.includes("tiktok.com")) {
    const segments = pathname.split("/").filter(Boolean);
    const videoIndex = segments.indexOf("video");
    const videoId = videoIndex >= 0 ? segments[videoIndex + 1] ?? "" : "";
    if (!videoId) return url;
    return `https://www.tiktok.com/embed/v2/${videoId}`;
  }

  return url;
}
