import { describe, expect, it } from "vitest";
import {
  concludeWarPayloadSchema,
  createWarHistorySchema,
  updateMemberStatsSchema,
} from "./guild-war";

describe("guild war decimal stats", () => {
  it("accepts decimal metrics in every write contract", () => {
    expect(
      createWarHistorySchema.parse({
        war_name: "Decimal test",
        own_stats: { damage: 1234.56 },
      }).own_stats,
    ).toEqual({ damage: 1234.56 });

    expect(
      updateMemberStatsSchema.parse({
        stats: { damage: 1234.56 },
      }).stats,
    ).toEqual({ damage: 1234.56 });

    expect(
      concludeWarPayloadSchema.parse({
        event_id: "event-1",
        war_info: {
          result: "win",
          own_stats: { damage: 1234.56 },
        },
        member_stats: [
          {
            user_id: "user-1",
            stats: { damage: 1234.56 },
          },
        ],
      }).member_stats?.[0]?.stats,
    ).toEqual({ damage: 1234.56 });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "still rejects non-finite metric %s",
    (metric) => {
      expect(
        updateMemberStatsSchema.safeParse({
          stats: { damage: metric },
        }).success,
      ).toBe(false);
    },
  );
});
