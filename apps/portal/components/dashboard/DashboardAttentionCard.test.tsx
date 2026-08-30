import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DashboardUpcomingEventRow } from "./shared";
import { DashboardAttentionCard } from "./DashboardAttentionCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, options?: { count?: number }) =>
      key === "attention.eventCount" ? `${options?.count ?? 0} events` : key,
  }),
}));

function eventRow(overrides: Partial<DashboardUpcomingEventRow> = {}): DashboardUpcomingEventRow {
  return {
    item: {
      id: "night-raid",
      title: "Night Raid",
      description: null,
      type: "guild_war",
      start_at: "2026-08-28T20:00:00.000Z",
      end_at: null,
      capacity: 4,
      pinned: false,
      class_quotas: [] as DashboardUpcomingEventRow["item"]["class_quotas"],
    } as DashboardUpcomingEventRow["item"],
    startsSoon: true,
    hasConflict: false,
    members: [],
    participantCount: 4,
    joined: false,
    capacityLabel: "4/4",
    isFull: true,
    quotaSummary: {
      slots: [],
      matchedTotal: 2,
      requiredTotal: 4,
    },
    ...overrides,
  };
}

describe("DashboardAttentionCard", () => {
  it("names each affected event and shows its schedule and concrete attention signals", () => {
    render(<DashboardAttentionCard rows={[eventRow()]} loading={false} />);

    expect(screen.getByRole("heading", { name: "Night Raid" })).toBeInTheDocument();
    expect(screen.getByText("1 events")).toBeInTheDocument();
    expect(screen.getByText("attention.startsSoon.title")).toBeInTheDocument();
    expect(screen.getByText("attention.full.title")).toBeInTheDocument();
    expect(screen.getByText("attention.quotaShortfalls.title")).toBeInTheDocument();
    expect(screen.getByText("4/4")).toBeInTheDocument();
    expect(screen.getByText("2/4")).toBeInTheDocument();
    expect(document.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-08-28T20:00:00.000Z",
    );
  });

  it("does not list events without an attention condition", () => {
    render(
      <DashboardAttentionCard
        rows={[
          eventRow({
            startsSoon: false,
            isFull: false,
            quotaSummary: null,
          }),
        ]}
        loading={false}
      />,
    );

    expect(screen.queryByRole("heading", { name: "Night Raid" })).not.toBeInTheDocument();
    expect(screen.getByText("attention.ready.title")).toBeInTheDocument();
  });
});
