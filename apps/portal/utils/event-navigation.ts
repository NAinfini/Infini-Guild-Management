import { DEFAULT_GAME_RULES, findEventTypeDefinition } from "@guild/shared";
import { z } from "zod";

const EVENT_LIST_VIEW_MODES = ["cards", "month"] as const;
const EVENT_STATUS_FILTERS = ["active", "archived", "all"] as const;

export type EventListViewMode = (typeof EVENT_LIST_VIEW_MODES)[number];
export type EventTypeFilter = string;
export type EventStatusFilter = (typeof EVENT_STATUS_FILTERS)[number];

export type EventsRouteSearch = {
  search?: string;
  type?: EventTypeFilter;
  status?: EventStatusFilter;
  pinned?: boolean;
  locked?: boolean;
  view?: EventListViewMode;
  date?: string;
};

const EVENT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

// TanStack Router JSON-parses search params before validation. Preserve scalar
// search text while rejecting structured values so malformed URLs cannot trip
// the route error boundary.
function parseTextSearchValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return undefined;
}

export const EVENTS_ROUTE_SEARCH_SCHEMA = z.object({
  search: z.preprocess(parseTextSearchValue, z.string().optional()),
  type: z.preprocess(
    (val) => (
      typeof val === "string" && findEventTypeDefinition(DEFAULT_GAME_RULES, val)?.enabled
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
  view: z.preprocess(
    (val) => (typeof val === "string" && (EVENT_LIST_VIEW_MODES as readonly string[]).includes(val) ? val : undefined),
    z.enum(EVENT_LIST_VIEW_MODES).optional(),
  ),
  date: z.preprocess(
    (val) => (typeof val === "string" && EVENT_DATE_PATTERN.test(val) ? val : undefined),
    z.string().optional(),
  ),
});

export function sanitizeEventsRouteSearch(search: EventsRouteSearch): EventsRouteSearch {
  const sanitized: EventsRouteSearch = {};
  const normalizedSearch = normalizeOptionalString(search.search);

  if (normalizedSearch) sanitized.search = normalizedSearch;
  if (search.type?.trim()) sanitized.type = search.type;
  if (search.status && search.status !== "active") sanitized.status = search.status;
  if (search.pinned) sanitized.pinned = true;
  if (search.locked) sanitized.locked = true;
  if (
    search.view
    && (EVENT_LIST_VIEW_MODES as readonly string[]).includes(search.view)
  ) {
    sanitized.view = search.view;
  }
  if (search.date && EVENT_DATE_PATTERN.test(search.date)) sanitized.date = search.date;
  return sanitized;
}
