// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildAnalyticsCsv } from "./useGuildWarAnalytics";

describe("guild-war analytics CSV", () => {
  it("neutralizes formula values copied from analytics rows", () => {
    const csv = buildAnalyticsCsv(
      [
        { dataKey: "war_name", title: "War" },
        { dataKey: "team_name", title: "Team" },
        { dataKey: "notes", title: "Notes" },
      ],
      [{
        war_name: '=HYPERLINK("https://attacker.invalid","open")',
        team_name: "  +cmd",
        notes: "line one\nline two",
      }],
    );

    expect(csv).toContain('"\'=HYPERLINK(""https://attacker.invalid"",""open"")"');
    expect(csv).toContain('"\'  +cmd"');
    expect(csv).toContain('"line one\nline two"');
    expect(csv.split("\n", 1)[0]).toBe('"War","Team","Notes"');
  });
});
