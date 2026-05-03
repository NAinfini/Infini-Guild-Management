import { EVENT_TYPES } from "@guild/shared";
import { z } from "zod";

const EVENT_WORKBENCH_VIEW_MODES = ["cards", "month", "recurring"] as const;

export type EventWorkbenchViewMode = (typeof EVENT_WORKBENCH_VIEW_MODES)[number];
export type EventTypeFilter = (typeof EVENT_TYPES)[number];

export type EventsRouteSearch = {
  search?: string;
  type?: EventTypeFilter;
  archived?: boolean;
  pinned?: boolean;
  locked?: boolean;
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

export const EVENTS_ROUTE_SEARCH_SCHEMA = z.object({
  search: z.string().optional(),
  type: z.enum(EVENT_TYPES).optional(),
  archived: z.preprocess(parseBooleanSearchValue, z.boolean().optional()),
  pinned: z.preprocess(parseBooleanSearchValue, z.boolean().optional()),
  locked: z.preprocess(parseBooleanSearchValue, z.boolean().optional()),
  view: z.preprocess(
    (val) => (typeof val === "string" && (EVENT_WORKBENCH_VIEW_MODES as readonly string[]).includes(val) ? val : undefined),
    z.enum(EVENT_WORKBENCH_VIEW_MODES).optional(),
  ),
  eventId: z.string().optional(),
});

export function sanitizeEventsRouteSearch(search: EventsRouteSearch): EventsRouteSearch {
  return {
    search: normalizeOptionalString(search.search),
    type: search.type?.trim() ? search.type : undefined,
    archived: search.archived ? true : undefined,
    pinned: search.pinned ? true : undefined,
    locked: search.locked ? true : undefined,
    view: search.view,
    eventId: normalizeOptionalString(search.eventId),
  };
}

export function buildEventWorkbenchSearch(event: { id: string; title?: string | null }): EventsRouteSearch {
  return sanitizeEventsRouteSearch({
    search: event.title ?? undefined,
    eventId: event.id,
    view: "cards",
  });
}
