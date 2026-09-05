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

type MaintenanceLanguage = "zh" | "en";

const MAINTENANCE_COPY = {
  zh: {
    htmlLanguage: "zh-Hans",
    contentLanguage: "zh-CN",
    pageTitle: "系统维护中",
    title: "系统维护中",
    description: "服务正在更新。完成后即可继续使用，请稍后重试。",
    reasonLabel: "维护说明",
    untilLabel: "预计恢复",
    retry: "重试",
  },
  en: {
    htmlLanguage: "en",
    contentLanguage: "en",
    pageTitle: "Site under maintenance",
    title: "Site under maintenance",
    description: "The service is being updated. Try again shortly.",
    reasonLabel: "Maintenance details",
    untilLabel: "Expected completion",
    retry: "Try again",
  },
} as const satisfies Record<MaintenanceLanguage, Readonly<{
  htmlLanguage: string;
  contentLanguage: string;
  pageTitle: string;
  title: string;
  description: string;
  reasonLabel: string;
  untilLabel: string;
  retry: string;
}>>;

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
  const language = selectMaintenanceLanguage(request.headers.get("Accept-Language"));
  return new Response(request.method === "HEAD" ? null : renderMaintenanceHtml(details, language), {
    status: 503,
    headers: maintenanceHeaders(request, "text/html; charset=UTF-8", language),
  });
}

function selectMaintenanceLanguage(acceptLanguage: string | null): MaintenanceLanguage {
  if (!acceptLanguage) return "zh";

  let selected: MaintenanceLanguage | null = null;
  let selectedQuality = -1;
  for (const entry of acceptLanguage.split(",")) {
    const [rawRange = "", ...parameters] = entry.split(";");
    const range = rawRange.trim().toLowerCase();
    const qualityParameter = parameters.find((parameter) => /^\s*q\s*=/i.test(parameter));
    const qualityMatch = qualityParameter?.match(/^\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)\s*$/i);
    const quality = qualityParameter === undefined ? 1 : qualityMatch ? Number(qualityMatch[1]) : 0;
    if (quality <= 0) continue;

    const primaryLanguage = range.split("-", 1)[0];
    const language = range === "*" ? "zh" : primaryLanguage === "zh" || primaryLanguage === "en"
      ? primaryLanguage
      : null;
    if (language && quality > selectedQuality) {
      selected = language;
      selectedQuality = quality;
    }
  }
  return selected ?? "zh";
}

function renderMaintenanceHtml(details: MaintenanceDetails, language: MaintenanceLanguage): string {
  const copy = MAINTENANCE_COPY[language];
  const reason = details.reason === null
    ? ""
    : `<div class="maintenance-detail"><dt>${copy.reasonLabel}</dt><dd>${escapeHtml(details.reason)}</dd></div>`;
  const until = details.until === null
    ? ""
    : `<div class="maintenance-detail"><dt>${copy.untilLabel}</dt><dd><time datetime="${escapeHtml(details.until)}">${formatUtcDatetime(details.until, language)}</time></dd></div>`;
  const detailsMarkup = reason || until ? `<dl class="maintenance-details">${reason}${until}</dl>` : "";

  return `<!doctype html>
<html lang="${copy.htmlLanguage}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="robots" content="noindex,nofollow">
  <title>${copy.pageTitle}</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: "Noto Sans SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif;
      --surface-base: #faf9f5;
      --surface-raised: #ffffff;
      --text-primary: #1a1815;
      --text-secondary: #3a3833;
      --text-muted: #6b665e;
      --border-subtle: #e3e1d9;
      --brand-fill: #2fb49c;
      --brand-fill-hover: #23907d;
      --brand-on-fill: #04342c;
      --focus: #0f6e56;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --surface-base: #141418;
        --surface-raised: #1c1c22;
        --text-primary: #f0ede8;
        --text-secondary: #d6d2c8;
        --text-muted: #a39d94;
        --border-subtle: #3a3833;
        --focus: #2fb49c;
      }
    }
    * { box-sizing: border-box; }
    html { min-height: 100%; }
    body {
      min-height: 100vh;
      min-height: 100dvh;
      margin: 0;
      background: var(--surface-base);
      color: var(--text-primary);
    }
    main {
      display: grid;
      min-height: 100vh;
      min-height: 100dvh;
      place-items: center;
      padding: clamp(1rem, 5vw, 3rem);
    }
    article {
      width: min(100%, 30rem);
      padding: 2rem;
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      background: var(--surface-raised);
    }
    .maintenance-heading {
      display: flex;
      align-items: center;
      gap: .75rem;
    }
    .maintenance-icon {
      flex: 0 0 2rem;
      width: 2rem;
      height: 2rem;
      color: var(--focus);
    }
    h1 {
      margin: 0;
      font-size: 1.75rem;
      line-height: 1.2;
      text-wrap: balance;
    }
    .maintenance-description {
      max-width: 36ch;
      margin: 1rem 0 0;
      color: var(--text-secondary);
      font-size: .875rem;
      line-height: 1.6;
    }
    .maintenance-details {
      display: grid;
      gap: 1rem;
      margin: 1.5rem 0 0;
      padding: 1rem 0 0;
      border-top: 1px solid var(--border-subtle);
    }
    .maintenance-detail {
      display: grid;
      gap: .25rem;
    }
    .maintenance-detail dt {
      color: var(--text-muted);
      font-size: .8125rem;
      font-weight: 600;
      line-height: 1.5;
    }
    .maintenance-detail dd {
      margin: 0;
      color: var(--text-secondary);
      font-size: .875rem;
      line-height: 1.6;
      overflow-wrap: anywhere;
    }
    .maintenance-detail time { font-variant-numeric: tabular-nums; }
    .maintenance-action {
      display: inline-flex;
      min-height: 2.75rem;
      align-items: center;
      justify-content: center;
      margin-top: 1.5rem;
      padding: 0 1rem;
      border: 1px solid transparent;
      border-radius: 6px;
      background: var(--brand-fill);
      color: var(--brand-on-fill);
      font-size: .875rem;
      font-weight: 600;
      line-height: 1.4;
      text-decoration: none;
    }
    .maintenance-action:hover { background: var(--brand-fill-hover); }
    .maintenance-action:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }
    ::selection { background: var(--brand-fill); color: var(--brand-on-fill); }
    @media (max-width: 32rem) {
      article { padding: 1.5rem; }
      .maintenance-heading { align-items: flex-start; }
      .maintenance-action { width: 100%; }
    }
  </style>
</head>
<body>
  <main>
    <article aria-labelledby="maintenance-title">
      <div class="maintenance-heading">
        <svg class="maintenance-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <path d="M14.7 6.3a4 4 0 0 0-5-5L12 3.6 9.6 6 7.3 3.7a4 4 0 0 0 5 5L5 16a2.1 2.1 0 1 0 3 3l7.3-7.3a4 4 0 0 0 5-5L18 9l-2.4-2.4Z"/>
        </svg>
        <h1 id="maintenance-title">${copy.title}</h1>
      </div>
      <p class="maintenance-description">${copy.description}</p>
      ${detailsMarkup}
      <a class="maintenance-action" href="">${copy.retry}</a>
    </article>
  </main>
</body>
</html>`;
}

function formatUtcDatetime(value: string, language: MaintenanceLanguage): string {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  if (language === "zh") return `${year}年${month + 1}月${day}日 ${hours}:${minutes} UTC`;
  const monthName = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][month];
  return `${monthName} ${day}, ${year} at ${hours}:${minutes} UTC`;
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

function maintenanceHeaders(
  request: Request,
  contentType: string,
  language?: MaintenanceLanguage,
): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Retry-After": String(RETRY_AFTER_SECONDS),
    "X-Robots-Tag": "noindex, nofollow",
  });
  if (language) {
    headers.set("Content-Language", MAINTENANCE_COPY[language].contentLanguage);
    headers.set("Vary", "Accept-Language");
  }
  applyStaticSecurityHeaders(headers, request.url);
  return headers;
}
