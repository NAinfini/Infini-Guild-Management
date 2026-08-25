// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  EVENTS_ROUTE_SEARCH_SCHEMA,
  sanitizeEventsRouteSearch,
} from "./event-navigation";

describe("event navigation", () => {
  it("keeps the list workbench focused on filters and its two presentation modes", () => {
    expect(
      sanitizeEventsRouteSearch({
        search: "   ",
        type: undefined,
        pinned: false,
        locked: false,
        view: "cards",
      }),
    ).toEqual({
      view: "cards",
    });
  });

  it("preserves active filters that should stay shareable in the URL", () => {
    expect(
      sanitizeEventsRouteSearch({
        search: "Guild Raid",
        type: "guild_war",
      status: "archived",
      pinned: true,
        locked: true,
        view: "month",
        date: "2026-07-31",
      }),
    ).toEqual({
      search: "Guild Raid",
      type: "guild_war",
      status: "archived",
      pinned: true,
      locked: true,
      view: "month",
      date: "2026-07-31",
    });
  });

  it("keeps the selected calendar day as a safe URL value", () => {
    expect(sanitizeEventsRouteSearch({ date: "2026-07-31" })).toEqual({ date: "2026-07-31" });
    expect(sanitizeEventsRouteSearch({ date: "31-07-2026" })).toEqual({});
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ date: "2026-07-31" })).toEqual({ date: "2026-07-31" });
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ date: 20260731 })).toEqual({});
  });

  it("keeps all status explicit because it changes server filtering", () => {
    expect(sanitizeEventsRouteSearch({ status: "all" })).toEqual({ status: "all" });
  });

  it("survives the router's JSON-parsed search params instead of blowing up the route", () => {
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ search: 20260731 })).toEqual({ search: "20260731" });
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ search: true })).toEqual({ search: "true" });
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ eventId: 42 })).toEqual({});
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ type: 1 })).toEqual({});
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ type: "not_a_type" })).toEqual({});
  });

  it("does not encode detail or recurring workspace state in the list URL", () => {
    expect(sanitizeEventsRouteSearch({ view: "recurring" as never, eventId: "event-42" } as never)).toEqual({});
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ view: "recurring", eventId: "event-42" })).toEqual({});
  });
});
