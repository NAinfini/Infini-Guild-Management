// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildGuildWarTabSearch,
  isMissingGuildWarHistoryDetail,
  resolveGuildWarManagementPermissions,
  resolveGuildWarHistorySelection,
  resolveGuildWarTab,
} from "./GuildWarPage";
import { ApiRequestError } from "../../api/client";

describe("GuildWarPage tab routing", () => {
  it("keeps team, history, and participant-removal permissions independent", () => {
    expect(resolveGuildWarManagementPermissions({
      teamsEdit: true,
      historyEdit: false,
      eventsEdit: false,
    }, false)).toEqual({
      canManageActive: true,
      canManageHistory: false,
      canRemoveParticipants: false,
    });
    expect(resolveGuildWarManagementPermissions({
      teamsEdit: false,
      historyEdit: true,
      eventsEdit: true,
    }, false)).toEqual({
      canManageActive: false,
      canManageHistory: true,
      canRemoveParticipants: false,
    });
    expect(resolveGuildWarManagementPermissions({
      teamsEdit: true,
      historyEdit: true,
      eventsEdit: true,
    }, true)).toEqual({
      canManageActive: false,
      canManageHistory: false,
      canRemoveParticipants: false,
    });
  });

  it("defaults an internal viewer without an active war to history after eligibility loads", () => {
    expect(
      resolveGuildWarTab({}, false, "empty"),
    ).toEqual({
      activeTab: "history",
      replacementTab: "history",
    });

    expect(
      resolveGuildWarTab({}, false, "loading"),
    ).toEqual({
      activeTab: "active",
      replacementTab: null,
    });
  });

  it("normalizes an external-view active deep link to the first visible tab", () => {
    expect(
      resolveGuildWarTab({ tab: "active" }, true),
    ).toEqual({
      activeTab: "history",
      replacementTab: "history",
    });

    expect(
      buildGuildWarTabSearch(
        { tab: "active", view: "external" },
        "history",
      ),
    ).toEqual({
      tab: "history",
      view: "external",
    });
  });

  it("keeps an explicitly requested active tab available even when no war exists", () => {
    expect(
      resolveGuildWarTab({ tab: "active" }, false, "empty"),
    ).toEqual({
      activeTab: "active",
      replacementTab: null,
    });

    expect(
      buildGuildWarTabSearch(
        { tab: "history", warName: "Iron Siege" },
        "active",
      ),
    ).toEqual({
      tab: "active",
      warName: undefined,
    });
  });

  it("drops a history detail that another client deleted and selects the next available record", () => {
    const rows = [{ id: "deleted" }, { id: "remaining" }];
    expect(resolveGuildWarHistorySelection(rows, "deleted", "deleted")).toBe("remaining");
    expect(resolveGuildWarHistorySelection(rows.slice(0, 1), null, "deleted")).toBeNull();
    expect(resolveGuildWarHistorySelection(rows, "remaining", "deleted")).toBe("remaining");

    expect(isMissingGuildWarHistoryDetail(new ApiRequestError("missing", { status: 404 }))).toBe(true);
    expect(isMissingGuildWarHistoryDetail(new ApiRequestError("failed", { status: 500 }))).toBe(false);
  });

});
