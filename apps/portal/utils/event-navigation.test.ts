// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  EVENTS_ROUTE_SEARCH_SCHEMA,
  buildEventWorkbenchSearch,
  clearEventWorkbenchFocus,
  sanitizeEventsRouteSearch,
} from "./event-navigation";

describe("event navigation", () => {
  it("uses eventId as the sole detail-restoration state", () => {
    expect(
      buildEventWorkbenchSearch({
        id: "event-42",
        title: "Guild Raid",
      }),
    ).toEqual({
      eventId: "event-42",
      view: "cards",
    });
  });

  it("keeps cards view explicit while removing empty filters", () => {
    expect(
      sanitizeEventsRouteSearch({
        search: "   ",
        type: undefined,
        pinned: false,
        locked: false,
        eventId: "   ",
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
        eventId: "event-42",
        view: "month",
      }),
    ).toEqual({
      search: "Guild Raid",
      type: "guild_war",
      status: "archived",
      pinned: true,
      locked: true,
      eventId: "event-42",
      view: "month",
    });
  });

  it("keeps all status explicit because it changes server filtering", () => {
    expect(sanitizeEventsRouteSearch({ status: "all" })).toEqual({ status: "all" });
  });

  it("clears only the modal focus when a deep-linked detail closes", () => {
    expect(
      clearEventWorkbenchFocus({
        search: "Guild Raid",
        eventId: "event-42",
        view: "cards",
        pinned: true,
      }),
    ).toEqual({
      search: "Guild Raid",
      view: "cards",
      pinned: true,
    });
  });

  it("survives the router's JSON-parsed search params instead of blowing up the route", () => {
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ search: 20260731 })).toEqual({ search: "20260731" });
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ search: true })).toEqual({ search: "true" });
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ eventId: 42 })).toEqual({ eventId: "42" });
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ type: 1 })).toEqual({});
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ type: "not_a_type" })).toEqual({});
  });

  it("accepts the current recurring view contract", () => {
    expect(sanitizeEventsRouteSearch({ view: "recurring" })).toEqual({ view: "recurring" });
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ view: "recurring" })).toEqual({ view: "recurring" });
  });
});
