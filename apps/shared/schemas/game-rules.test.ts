import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_RULES, evaluateKda } from "./game-rules";

describe("fixed source game rules", () => {
  it("uses one source-owned name for every guild-war stat", () => {
    expect(DEFAULT_GAME_RULES.guild_war.team_stats[0]).toEqual({
      key: "kills",
      name: "Kills",
      dashboard: "primary",
    });
    expect(DEFAULT_GAME_RULES.guild_war.team_stats[0]).not.toHaveProperty("labels");
    expect(DEFAULT_GAME_RULES.guild_war.team_stats[0]).not.toHaveProperty("precision");
    expect(DEFAULT_GAME_RULES.guild_war.member_stats[0]).not.toHaveProperty("labels");
    expect(DEFAULT_GAME_RULES.guild_war.member_stats[0]).not.toHaveProperty("precision");
  });

  it("does not expose configurable results or a configurable KDA definition", () => {
    expect(DEFAULT_GAME_RULES.guild_war).not.toHaveProperty("results");
    expect(DEFAULT_GAME_RULES.guild_war).not.toHaveProperty("kda");
  });

  it("evaluates the fixed KDA formula without rounding", () => {
    expect(evaluateKda({ kills: 5, assists: 2, deaths: 2 })).toBe(3.5);
    expect(evaluateKda({ kills: 1, assists: 0, deaths: 3 })).toBeCloseTo(1 / 3);
    expect(evaluateKda({ kills: 3, assists: 2, deaths: 0 })).toBe(5);
  });
});
