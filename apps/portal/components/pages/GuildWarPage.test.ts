// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildGuildWarTabSearch,
  resolveGuildWarTab,
} from "./GuildWarPage";

describe("GuildWarPage tab routing", () => {
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
});
