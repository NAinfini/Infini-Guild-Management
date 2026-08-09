// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useGuildWarHistory } from "./useGuildWarHistory";

type MemberStat = {
  user_id: string;
  username?: string;
  stats: Record<string, number | null> | null;
};

function detail(memberStats: MemberStat[]) {
  return {
    id: "history-1",
    teams: [],
    member_stats: memberStats,
  };
}

describe("useGuildWarHistory", () => {
  it("ignores missing, null, and non-finite values for lower-is-better MVPs", () => {
    const invalidStats: MemberStat[] = [
      { user_id: "missing", username: "Missing", stats: {} },
      { user_id: "null", username: "Null", stats: { damage_taken: null } },
      { user_id: "nan", username: "NaN", stats: { damage_taken: Number.NaN } },
      { user_id: "infinity", username: "Infinity", stats: { damage_taken: Number.POSITIVE_INFINITY } },
    ];
    const { result, rerender } = renderHook(
      ({ memberStats }: { memberStats: MemberStat[] }) => useGuildWarHistory({
        historyDetailData: detail(memberStats),
      }),
      {
        initialProps: {
          memberStats: [
            ...invalidStats,
            { user_id: "eligible-12", username: "Eligible 12", stats: { damage_taken: 12 } },
            { user_id: "eligible-4", username: "Eligible 4", stats: { damage_taken: 4 } },
          ],
        },
      },
    );

    expect(result.current.historyMvp?.find((entry) => entry.key === "damage_taken")?.value)
      .toBe("Eligible 4 (4)");

    rerender({ memberStats: invalidStats });

    expect(result.current.historyMvp?.find((entry) => entry.key === "damage_taken")?.value)
      .toBe("-");
  });
});
