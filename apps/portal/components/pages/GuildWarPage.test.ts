import { describe, expect, it } from "vitest";
import {
  buildGuildWarTabSearch,
  resolveGuildWarTab,
} from "./GuildWarPage";

describe("GuildWarPage tab routing", () => {
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

  it("keeps the active tab available for a normal signed-in viewer", () => {
    expect(
      resolveGuildWarTab({ tab: "active" }, false),
    ).toEqual({
      activeTab: "active",
      replacementTab: null,
    });
  });
});
