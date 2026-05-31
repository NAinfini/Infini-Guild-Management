import { describe, expect, it } from "vitest";
import {
  buildEventWorkbenchSearch,
  sanitizeEventsRouteSearch,
} from "./event-navigation";

describe("event navigation", () => {
  it("builds dashboard and search navigation for the events workbench", () => {
    expect(
      buildEventWorkbenchSearch({
        id: "event-42",
        title: "Guild Raid",
      }),
    ).toEqual({
      search: "Guild Raid",
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
});
