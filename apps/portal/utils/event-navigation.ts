import { findEventTypeDefinition } from "@guild/shared";
import { z } from "zod";
import { getCurrentGameRules } from "./game-rules";

const EVENT_WORKBENCH_VIEW_MODES = ["cards", "month", "recurring"] as const;
/*
 * 周期模板原先是页面顶层的第二个标签页（?tab=recurring），现在并入 view 这一档，
 * 跟卡片、月视图共用同一个切换器。tab 只保留读取能力，用来把已经发出去的旧链接
 * （包括 e2e 里的 /events?tab=recurring）翻译成新的 view 值——它不再被写回 URL，
 * 见 sanitizeEventsRouteSearch。
 */
const EVENTS_TABS = ["events", "recurring"] as const;
const EVENT_STATUS_FILTERS = ["active", "archived", "all"] as const;

export type EventWorkbenchViewMode = (typeof EVENT_WORKBENCH_VIEW_MODES)[number];
export type EventsTab = (typeof EVENTS_TABS)[number];
export type EventTypeFilter = string;
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
    (val) => (
      typeof val === "string" && findEventTypeDefinition(getCurrentGameRules(), val)?.enabled
        ? val
        : undefined
    ),
    z.string().optional(),
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

/*
 * 把 URL 状态折算成当前视图。读路径（EventsPage 决定渲染哪一档）和写路径
 * （sanitizeEventsRouteSearch 决定往 URL 里放什么）必须共用这一个函数：只在写
 * 路径翻译 tab，页面读的仍是没翻译过的 view，旧链接会静默退回卡片视图——页面
 * 看上去完全正常，只有到不了目的地这一点是错的。
 *
 * 显式的 view 优先于 tab，因为它是这套 UI 唯一会写出来的参数。
 */
export function resolveEventsViewMode(search: EventsRouteSearch): EventWorkbenchViewMode | undefined {
  if (search.view) return search.view;
  return search.tab === "recurring" ? "recurring" : undefined;
}

export function sanitizeEventsRouteSearch(search: EventsRouteSearch): EventsRouteSearch {
  const sanitized: EventsRouteSearch = {};
  const normalizedSearch = normalizeOptionalString(search.search);
  const normalizedEventId = normalizeOptionalString(search.eventId);

  if (normalizedSearch) sanitized.search = normalizedSearch;
  if (search.type?.trim()) sanitized.type = search.type;
  if (search.status && search.status !== "active") sanitized.status = search.status;
  if (search.pinned) sanitized.pinned = true;
  if (search.locked) sanitized.locked = true;
  const view = resolveEventsViewMode(search);
  if (view) sanitized.view = view;
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
