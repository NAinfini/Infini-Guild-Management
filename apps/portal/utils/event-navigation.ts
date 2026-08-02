import { EVENT_TYPES } from "@guild/shared";
import { z } from "zod";

const EVENT_WORKBENCH_VIEW_MODES = ["cards", "month"] as const;
const EVENTS_TABS = ["events", "recurring"] as const;
const EVENT_STATUS_FILTERS = ["active", "archived", "all"] as const;

export type EventWorkbenchViewMode = (typeof EVENT_WORKBENCH_VIEW_MODES)[number];
export type EventsTab = (typeof EVENTS_TABS)[number];
export type EventTypeFilter = (typeof EVENT_TYPES)[number];
export type EventStatusFilter = (typeof EVENT_STATUS_FILTERS)[number];

export type EventsRouteSearch = {
  search?: string;
  type?: EventTypeFilter;
  status?: EventStatusFilter;
  pinned?: boolean;
  locked?: boolean;
  tab?: EventsTab;
  view?: EventWorkbenchViewMode;
  eventId?: string;
};

function parseBooleanSearchValue(value: unknown): boolean | undefined {
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  return undefined;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/*
 * TanStack Router 是用 JSON 解析查询串的：?search=20260731 到这里已经是 number，
 * ?search=true 已经是 boolean。用 z.string() 直接校验会抛错，而 validateSearch 抛错
 * 等于整页错误边界——用户搜一串纯数字，刷新或把链接发给别人就是白屏。
 * 标量一律按文本还原，其余类型（对象、数组）当成没填。
 */
function parseTextSearchValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return undefined;
}

export const EVENTS_ROUTE_SEARCH_SCHEMA = z.object({
  search: z.preprocess(parseTextSearchValue, z.string().optional()),
  // 其余枚举字段都用 preprocess 把不认识的值当成没填；type 也必须一致，
  // 否则手改成 ?type=1 就是一次整页崩溃，而不是一个被忽略的筛选条件。
  type: z.preprocess(
    (val) => (typeof val === "string" && (EVENT_TYPES as readonly string[]).includes(val) ? val : undefined),
    z.enum(EVENT_TYPES).optional(),
  ),
  status: z.preprocess(
    (val) => (typeof val === "string" && (EVENT_STATUS_FILTERS as readonly string[]).includes(val) ? val : undefined),
    z.enum(EVENT_STATUS_FILTERS).optional(),
  ),
  pinned: z.preprocess(parseBooleanSearchValue, z.boolean().optional()),
  locked: z.preprocess(parseBooleanSearchValue, z.boolean().optional()),
  tab: z.preprocess(
    (val) => (typeof val === "string" && (EVENTS_TABS as readonly string[]).includes(val) ? val : undefined),
    z.enum(EVENTS_TABS).optional(),
  ),
  view: z.preprocess(
    (val) => (typeof val === "string" && (EVENT_WORKBENCH_VIEW_MODES as readonly string[]).includes(val) ? val : undefined),
    z.enum(EVENT_WORKBENCH_VIEW_MODES).optional(),
  ),
  eventId: z.preprocess(parseTextSearchValue, z.string().optional()),
});

export function sanitizeEventsRouteSearch(search: EventsRouteSearch): EventsRouteSearch {
  const sanitized: EventsRouteSearch = {};
  const normalizedSearch = normalizeOptionalString(search.search);
  const normalizedEventId = normalizeOptionalString(search.eventId);

  if (normalizedSearch) sanitized.search = normalizedSearch;
  if (search.type?.trim()) sanitized.type = search.type;
  if (search.status && search.status !== "active") sanitized.status = search.status;
  if (search.pinned) sanitized.pinned = true;
  if (search.locked) sanitized.locked = true;
  if (search.tab && search.tab !== "events") sanitized.tab = search.tab;
  if (search.view) sanitized.view = search.view;
  if (normalizedEventId) sanitized.eventId = normalizedEventId;
  return sanitized;
}

export function buildEventWorkbenchSearch(event: { id: string; title?: string | null }): EventsRouteSearch {
  return sanitizeEventsRouteSearch({
    eventId: event.id,
    view: "cards",
  });
}

export function clearEventWorkbenchFocus(search: EventsRouteSearch): EventsRouteSearch {
  return sanitizeEventsRouteSearch({
    ...search,
    eventId: undefined,
  });
}
