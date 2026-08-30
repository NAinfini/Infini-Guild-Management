import { beforeEach, describe, expect, it } from "vitest";
import { useGuildWarStore } from "./guildWar";

describe("guild-war analytics session state", () => {
  beforeEach(() => {
    useGuildWarStore.getState().resetSessionState();
  });

  it("opens the war overview without selecting a player", () => {
    const state = useGuildWarStore.getState();

    expect(state.analyticsMode).toBe("wars");
    expect(state.analyticsSelectedUsers).toEqual([]);
  });
});
