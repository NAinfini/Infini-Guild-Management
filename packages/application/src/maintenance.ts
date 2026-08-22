import { AppError } from "@guild/kernel";
import { applyStaticSecurityHeaders } from "@guild/shared/utils/static-security-headers";

const RETRY_AFTER_SECONDS = 300;

export function isMaintenanceModeEnabled(value: string | undefined): boolean {
  const mode = value?.trim();
  if (!mode || mode === "off") return false;
  return true;
}

export function maintenanceResponse(request: Request): Response {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/health") {
    return jsonResponse(request, 200, { ok: true, maintenance: true });
  }
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    const requestId = crypto.randomUUID();
    const error = new AppError({
      code: "UPSTREAM_ERROR",
      status: 503,
      message: "Maintenance in progress / 系统维护中",
    });
    return jsonResponse(request, 503, error.toResponseBody(requestId), requestId);
  }
  return htmlResponse(request);
}

function jsonResponse(
  request: Request,
  status: 200 | 503,
  body: unknown,
  requestId?: string,
): Response {
  const headers = maintenanceHeaders(request, "application/json; charset=UTF-8");
  if (requestId) headers.set("X-Request-Id", requestId);
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), { status, headers });
}

function htmlResponse(request: Request): Response {
  return new Response(request.method === "HEAD" ? null : MAINTENANCE_HTML, {
    status: 503,
    headers: maintenanceHeaders(request, "text/html; charset=UTF-8"),
  });
}

function maintenanceHeaders(request: Request, contentType: string): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Retry-After": String(RETRY_AFTER_SECONDS),
    "X-Robots-Tag": "noindex, nofollow",
  });
  applyStaticSecurityHeaders(headers, request.url);
  return headers;
}

const STREAKS = [
  [7, -8, 8], [16, -3, 11], [24, -12, 9], [32, -6, 13], [41, -1, 10],
  [50, -10, 12], [58, -4, 8], [66, -14, 11], [75, -7, 9], [84, -2, 13],
  [92, -11, 10], [12, -15, 12], [37, -9, 8], [62, -5, 13], [88, -13, 9],
] as const;

const STREAK_MARKUP = STREAKS.map(([left, delay, duration]) =>
  `<i style="--x:${left}%;--delay:${delay}s;--duration:${duration}s"></i>`
).join("");

const MAINTENANCE_HTML = `<!doctype html>
<html lang="zh-Hans">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="robots" content="noindex,nofollow">
  <title>系统维护中 · Maintenance</title>
  <style>
    :root { color-scheme: dark; font-family: "Noto Sans SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 18rem; min-height: 100dvh; overflow: hidden; background: #0a0a0f; color: #f0ede8; }
    .lightfall { position: fixed; inset: 0; overflow: hidden; background: #0a0a0f; pointer-events: none; }
    .lightfall::after { position: absolute; inset: 0; background: rgba(10, 10, 15, .28); content: ""; }
    .lightfall i { position: absolute; top: -24vh; left: var(--x); width: 2px; height: clamp(5rem, 12vh, 9rem); border-radius: 2px; background: currentColor; color: #2fb49c; opacity: .46; box-shadow: 0 10px 20px currentColor; animation: starfall var(--duration) linear var(--delay) infinite; }
    .lightfall i:nth-child(3n + 2) { color: #6e93f7; opacity: .36; }
    .lightfall i:nth-child(3n) { color: #9c8cf5; opacity: .3; }
    main { position: relative; z-index: 1; display: grid; min-height: 100dvh; place-items: center; padding: clamp(1rem, 5vw, 3rem); }
    article { width: min(100%, 34rem); padding: clamp(1.5rem, 5vw, 2.5rem); border-radius: 14px; background: rgba(20, 20, 24, .94); box-shadow: 0 24px 80px rgba(0, 0, 0, .48); }
    .eyebrow { display: inline-flex; align-items: center; gap: .625rem; margin-bottom: 1.25rem; padding: .5rem .75rem; border: 1px solid rgba(47, 180, 156, .24); border-radius: 999px; background: rgba(47, 180, 156, .1); color: #6fcfbb; font-size: .75rem; font-weight: 750; letter-spacing: .035em; }
    .eyebrow svg { width: 1.125rem; height: 1.125rem; flex: 0 0 auto; }
    h1 { margin: 0; font-size: clamp(2rem, 7vw, 3.25rem); line-height: 1.12; letter-spacing: -.02em; text-wrap: balance; }
    h2 { margin: .5rem 0 0; color: #a39d94; font-size: clamp(1rem, 3vw, 1.25rem); font-weight: 600; line-height: 1.4; }
    .copy { display: grid; gap: .5rem; max-width: 62ch; margin-top: 1.75rem; color: #d6d2c8; font-size: .95rem; line-height: 1.65; }
    .copy p { margin: 0; }
    .status { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-top: 2rem; padding-top: 1.25rem; border-top: 1px solid #3a3833; color: #a39d94; font-size: .8125rem; }
    .state { display: inline-flex; align-items: center; gap: .5rem; color: #6fcfbb; font-weight: 700; }
    .state::before { width: .5rem; height: .5rem; border-radius: 50%; background: #2fb49c; content: ""; }
    ::selection { background: #2fb49c; color: #04342c; }
    @keyframes starfall {
      from { transform: translate3d(18vw, -24vh, 0) rotate(18deg); }
      to { transform: translate3d(-24vw, 148vh, 0) rotate(18deg); }
    }
    @media (max-width: 32rem) {
      article { padding: 1.5rem; }
      .status { align-items: flex-start; flex-direction: column; }
    }
    @media (prefers-reduced-motion: reduce) {
      .lightfall i { top: var(--x); animation: none; transform: rotate(18deg); }
    }
  </style>
</head>
<body>
  <!-- THESIS: A calm operational pause carried by the portal's three-color Lightfall, never a generic outage screen.
  OWN-WORLD: Near-black forged surface, warm text, teal status, and sparse teal/indigo/violet falling light.
  STORY: The guild sees that maintenance is intentional, understands no action is needed, and returns later.
  FIRST VIEWPORT: One compact status plate centered inside a full-viewport starfall field.
  FORM: Established authentication visual language, reduced to a dependency-free maintenance state.
  FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md. -->
  <div class="lightfall" aria-hidden="true">${STREAK_MARKUP}</div>
  <main>
    <article aria-labelledby="maintenance-title">
      <div class="eyebrow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 6V5a2 2 0 0 1 4 0v1"/>
          <path d="M14 6a6 6 0 0 1 6 6v1M4 13v-1a6 6 0 0 1 6-6"/>
          <rect width="20" height="4" x="2" y="13" rx="1"/>
        </svg>
        <span>计划维护 · <span lang="en">Scheduled maintenance</span></span>
      </div>
      <h1 id="maintenance-title">系统维护中</h1>
      <h2 lang="en">Maintenance in progress</h2>
      <div class="copy">
        <p>我们正在安全更新数据与媒体服务。完成后网站会自动恢复，请稍后再来。</p>
        <p lang="en">We are safely updating data and media services. The site will return when the work is complete.</p>
      </div>
      <div class="status">
        <span>芳华朝云 · <span lang="en">Infini Guild</span></span>
        <span class="state"><span>暂时不可用 · <span lang="en">Temporarily unavailable</span></span></span>
      </div>
    </article>
  </main>
</body>
</html>`;
