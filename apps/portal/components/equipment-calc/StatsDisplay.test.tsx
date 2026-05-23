// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { describe, expect, it, vi } from "vitest";
import { gameDataSchema } from "@guild/shared/schemas/equipment-calc";
import seedGameData from "@guild/shared/calculator/seed-data.json";
import type { CappedStats, StatSheet } from "@guild/shared/calculator/types";
import { StatsDisplay } from "./StatsDisplay";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.defaultValue) return String(options.defaultValue);
      if (options?.element) return `${key}:${options.element}`;
      return key;
    },
  }),
}));

const gameData = gameDataSchema.parse(seedGameData);

const capped: CappedStats = {
  actualPrecision: 85.5,
  actualCrit: 19,
  actualIntent: 13.4,
  precisionOverflow: 0,
  critOverflow: 0,
  intentOverflow: 0,
};

describe("StatsDisplay", () => {
  it("does not repeat stats already represented in the compact panel table", () => {
    const stats: StatSheet = {
      "最小外功攻击": 1001.04,
      "最大外功攻击": 2123.15,
      "最小鸣金攻击": 427.667,
      "最大鸣金攻击": 856.333,
      "最小无相攻击": 52.8,
      "最大无相攻击": 52.8,
      "直接会心率": 4.6,
      "直接会意率": 2.3,
      "会心伤害加成": 50,
      "会意伤害加成": 40.2,
      "外功穿透": 0,
      "属攻穿透": 33.6,
      "鸣金伤害加成": 13.8,
      "全武学增效": 8.4,
    };

    render(
      <MantineProvider>
        <StatsDisplay stats={stats} gameData={gameData} capped={capped} />
      </MantineProvider>,
    );

    expect(screen.queryByText("最小外功攻击")).not.toBeInTheDocument();
    expect(screen.queryByText("最大鸣金攻击")).not.toBeInTheDocument();
    expect(screen.queryByText("直接会心率")).not.toBeInTheDocument();
    expect(screen.getByText("全武学增效")).toBeInTheDocument();
  });
});
