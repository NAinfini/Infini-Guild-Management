import { AppError } from "@guild/kernel";
import { applyStaticSecurityHeaders } from "@guild/shared/utils/static-security-headers";

const RETRY_AFTER_SECONDS = 300;
export const MAINTENANCE_REASON_MAX_LENGTH = 500;
const STRICT_ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type MaintenanceDetails = Readonly<{
  reason: string | null;
  until: string | null;
}>;

export type MaintenanceEnvironment = Readonly<{
  IG_MAINTENANCE_REASON?: string;
  IG_MAINTENANCE_UNTIL?: string;
}>;

const EMPTY_MAINTENANCE_DETAILS: MaintenanceDetails = Object.freeze({ reason: null, until: null });

export function isMaintenanceModeEnabled(value: string | undefined): boolean {
  const mode = value?.trim();
  if (!mode || mode === "off") return false;
  return true;
}

export function readMaintenanceDetails(
  environment: MaintenanceEnvironment,
): MaintenanceDetails {
  const reason = environment.IG_MAINTENANCE_REASON?.trim() ?? "";
  if (reason.length > MAINTENANCE_REASON_MAX_LENGTH) {
    throw new TypeError(`IG_MAINTENANCE_REASON must be at most ${MAINTENANCE_REASON_MAX_LENGTH} characters`);
  }
  const until = environment.IG_MAINTENANCE_UNTIL?.trim() ?? "";
  if (until && !isStrictIsoDatetime(until)) {
    throw new TypeError("IG_MAINTENANCE_UNTIL must be a canonical ISO datetime in UTC");
  }
  return Object.freeze({
    reason: reason || null,
    until: until || null,
  });
}

export function maintenanceResponse(
  request: Request,
  details: MaintenanceDetails = EMPTY_MAINTENANCE_DETAILS,
): Response {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/health") {
    return jsonResponse(request, 200, {
      ok: true,
      maintenance: true,
      ...(details.reason ? { reason: details.reason } : {}),
      ...(details.until ? { until: details.until } : {}),
    });
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
  return htmlResponse(request, details);
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

function htmlResponse(request: Request, details: MaintenanceDetails): Response {
  return new Response(request.method === "HEAD" ? null : renderMaintenanceHtml(details), {
    status: 503,
    headers: maintenanceHeaders(request, "text/html; charset=UTF-8"),
  });
}

function renderMaintenanceHtml(details: MaintenanceDetails): string {
  const reason = details.reason === null
    ? ""
    : `<p class="maintenance-reason"><strong>原因 · <span lang="en">Reason</span></strong>${escapeHtml(details.reason)}</p>`;
  const until = details.until === null
    ? ""
    : `<p class="maintenance-until"><span>预计结束 · <span lang="en">Estimated completion</span></span> <time datetime="${escapeHtml(details.until)}">${escapeHtml(details.until)}</time></p>`;
  return MAINTENANCE_HTML
    .replace("<!-- MAINTENANCE_REASON -->", reason)
    .replace("<!-- MAINTENANCE_UNTIL -->", until);
}

function isStrictIsoDatetime(value: string): boolean {
  if (!STRICT_ISO_DATETIME.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
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
    body { margin: 0; min-width: 18rem; min-height: 100dvh; overflow: hidden; background: #0b0e10; color: #f0ede8; }
    .maintenance-scene { position: fixed; inset: 0; overflow: hidden; background: #0b0e10; pointer-events: none; }
    .maintenance-scene svg { display: block; width: 100%; height: 100%; }
    main { position: relative; z-index: 1; display: grid; min-height: 100dvh; place-items: center; padding: clamp(1rem, 5vw, 3rem); }
    article { width: min(100%, 34rem); padding: clamp(1.5rem, 5vw, 2.5rem); border: 1px solid #383b38; border-radius: 14px; background: #151819; }
    .eyebrow { display: inline-flex; align-items: center; gap: .625rem; margin-bottom: 1.25rem; color: #6fcfbb; font-size: .75rem; font-weight: 750; letter-spacing: .035em; }
    .eyebrow svg { width: 1.125rem; height: 1.125rem; flex: 0 0 auto; }
    h1 { margin: 0; font-size: clamp(2rem, 7vw, 3.25rem); line-height: 1.12; letter-spacing: -.02em; text-wrap: balance; }
    h2 { margin: .5rem 0 0; color: #a39d94; font-size: clamp(1rem, 3vw, 1.25rem); font-weight: 600; line-height: 1.4; }
    .copy { display: grid; gap: .5rem; max-width: 62ch; margin-top: 1.75rem; color: #d6d2c8; font-size: .95rem; line-height: 1.65; }
    .copy p { margin: 0; }
    .maintenance-reason { display: grid; gap: .25rem; margin-top: .75rem !important; padding: .75rem .875rem; border: 1px solid #3a4a46; border-radius: 10px; background: #111f1d; }
    .maintenance-reason strong { color: #6fcfbb; font-size: .8125rem; }
    .maintenance-until { margin: 1rem 0 0; color: #d6d2c8; font-size: .8125rem; }
    .maintenance-until time { color: #6fcfbb; font-variant-numeric: tabular-nums; }
    .status { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-top: 2rem; padding-top: 1.25rem; border-top: 1px solid #3a3833; color: #a39d94; font-size: .8125rem; }
    .state { display: inline-flex; align-items: center; gap: .5rem; color: #6fcfbb; font-weight: 700; }
    .state::before { width: .5rem; height: .5rem; border-radius: 50%; background: #2fb49c; content: ""; }
    ::selection { background: #2fb49c; color: #04342c; }
    @media (max-width: 32rem) {
      article { padding: 1.5rem; }
      .status { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="maintenance-scene" aria-hidden="true">
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" focusable="false">
      <rect width="1600" height="900" fill="#0b0e10"/>
      <circle cx="1220" cy="190" r="96" fill="#252827"/>
      <path d="M0 390 170 278 296 365 430 218 600 406 756 306 898 392 1060 214 1220 384 1400 238 1600 402V900H0Z" fill="#161a1a"/>
      <path d="M0 522 154 414 326 520 496 356 654 540 824 408 974 510 1140 344 1328 530 1484 398 1600 482V900H0Z" fill="#1d211f"/>
      <path d="M0 626 214 510 410 644 572 492 748 652 930 522 1096 640 1260 468 1450 620 1600 544V900H0Z" fill="#111817"/>
      <path d="M1024 560h186l-22-54-22 28-24-56-25 56-25-28Z" fill="#2a2b25"/>
      <path d="M1082 560h72v150h-72Z" fill="#23251f"/>
      <path d="M1058 710h122l-18-32h-86Z" fill="#2a2b25"/>
      <path d="M0 724 210 660 364 742 560 634 760 746 952 656 1156 752 1364 644 1600 732V900H0Z" fill="#0d1212"/>
    </svg>
  </div>
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
        <!-- MAINTENANCE_REASON -->
      </div>
      <!-- MAINTENANCE_UNTIL -->
      <div class="status">
        <span>芳华朝云 · <span lang="en">Infini Guild</span></span>
        <span class="state"><span>暂时不可用 · <span lang="en">Temporarily unavailable</span></span></span>
      </div>
    </article>
  </main>
</body>
</html>`;
