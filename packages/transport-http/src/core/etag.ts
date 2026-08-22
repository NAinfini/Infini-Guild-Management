export function formatHttpEtag(value: string): string {
  const normalized = value.trim();
  if (normalized.startsWith("W/\"") || (normalized.startsWith("\"") && normalized.endsWith("\""))) {
    return normalized;
  }
  return `"${normalized.replaceAll("\"", "")}"`;
}

export function ifNoneMatch(header: string | undefined, currentEtag: string): boolean {
  if (!header) return false;
  const current = weakEtag(currentEtag);
  return header.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || weakEtag(normalized) === current;
  });
}

/*
 * 每个 JSON GET 都必须带 ETag：哈希是原生线性开销，而 304 省下的传输
 * 随响应体积增长——越大的响应越需要重验证，不设体积上限。
 */
export async function jsonWithEtag(request: Request, value: unknown, knownEtag?: string): Promise<Response> {
  const body = new TextEncoder().encode(JSON.stringify(value));
  const headers = new Headers({
    "Cache-Control": "private, no-cache, must-revalidate",
    "Content-Type": "application/json; charset=UTF-8",
  });
  const etag = formatHttpEtag(knownEtag ?? await sha256(body));
  headers.set("ETag", etag);
  if (ifNoneMatch(request.headers.get("If-None-Match") ?? undefined, etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, headers });
}

function weakEtag(value: string): string {
  return value.trim().replace(/^W\//, "");
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
