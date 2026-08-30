import type { Event } from "@guild/shared";
import type { ClassQuotaSummary } from "@guild/shared/utils/class-quota";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EventQuotaBar } from "./EventQuotaBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderQuotaBar(
  summary: ClassQuotaSummary | null,
  labels: Array<{ tag_id: string; label: string }>,
  { capacity = null, participantCount = 0 }: { capacity?: number | null; participantCount?: number } = {},
) {
  render(
    <EventQuotaBar
      summary={summary}
      event={{ class_quotas: labels, capacity } as Pick<Event, "class_quotas" | "capacity">}
      participantCount={participantCount}
    />,
  );
}

describe("EventQuotaBar", () => {
  it("communicates finite capacity with a progressbar and accessible values", () => {
    renderQuotaBar(null, [], { capacity: 12, participantCount: 8 });

    const progress = screen.getByRole("progressbar", { name: "quota.generic.label" });
    expect(progress).toHaveAttribute("aria-valuemax", "12");
    expect(progress).toHaveAttribute("aria-valuenow", "8");
    expect(screen.getByText("8 / 12")).toBeInTheDocument();
  });

  it("describes unlimited capacity without inventing a bounded progress value", () => {
    renderQuotaBar(null, [], { capacity: null, participantCount: 3 });

    expect(screen.getByText("quota.generic.unlimited")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("clamps an over-capacity signup count to a valid progress value", () => {
    renderQuotaBar(null, [], { capacity: 2, participantCount: 4 });

    const progress = screen.getByRole("progressbar", { name: "quota.generic.label" });
    expect(progress).toHaveAttribute("aria-valuemax", "2");
    expect(progress).toHaveAttribute("aria-valuenow", "2");
    expect(progress.parentElement).toHaveAttribute("data-quota-state", "over");
  });

  it("shows a configuration conflict instead of a negative unassigned capacity", () => {
    renderQuotaBar({
      slots: [
        { key: "tank", class_ids: ["tank"], required: 2, matched: 2, dedicated: 2, eligible: 2, floor: 2, ceiling: 2, status: "filled", member_ids: ["tank-1", "tank-2"] },
        { key: "healer", class_ids: ["healer"], required: 2, matched: 1, dedicated: 1, eligible: 1, floor: 1, ceiling: 1, status: "short", member_ids: ["healer-1"] },
      ],
      benched: [],
      unassigned: [],
      flexible: 0,
      requiredTotal: 4,
      matchedTotal: 3,
      shortfall: 1,
    }, [
      { tag_id: "tank", label: "Tank" },
      { tag_id: "healer", label: "Healer" },
    ], { capacity: 3, participantCount: 3 });

    expect(screen.getByText("quota.capacityConflict")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "quota.role.other" })).not.toBeInTheDocument();
  });

  it("does not count one flexible member as filling two required roles", () => {
    renderQuotaBar({
      slots: [
        { key: "tank", class_ids: ["tank"], required: 1, matched: 1, dedicated: 0, eligible: 1, floor: 0, ceiling: 1, status: "short", member_ids: ["swing"] },
        { key: "healer", class_ids: ["healer"], required: 1, matched: 0, dedicated: 0, eligible: 1, floor: 0, ceiling: 1, status: "short", member_ids: [] },
      ],
      benched: [],
      unassigned: [],
      flexible: 1,
      requiredTotal: 2,
      matchedTotal: 1,
      shortfall: 1,
    }, [
      { tag_id: "tank", label: "Tank" },
      { tag_id: "healer", label: "Healer" },
    ]);

    expect(screen.getByRole("progressbar", { name: "Tank" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByRole("progressbar", { name: "Healer" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByText("0 / 1")).toBeInTheDocument();
  });

  it("keeps the unassigned column in the finite team total", () => {
    renderQuotaBar({
      slots: [
        { key: "tank", class_ids: ["tank"], required: 2, matched: 2, dedicated: 1, eligible: 5, floor: 1, ceiling: 2, status: "flex", member_ids: ["tank-1", "swing"] },
        { key: "healer", class_ids: ["healer"], required: 2, matched: 2, dedicated: 1, eligible: 7, floor: 1, ceiling: 2, status: "flex", member_ids: ["healer-1", "swing-2"] },
      ],
      benched: [],
      unassigned: [],
      flexible: 2,
      requiredTotal: 4,
      matchedTotal: 4,
      shortfall: 0,
    }, [
      { tag_id: "tank", label: "Tank" },
      { tag_id: "healer", label: "Healer" },
    ], { capacity: 10, participantCount: 9 });

    expect(screen.getByText("5 / 6")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "quota.role.other" })).toHaveAttribute("aria-valuenow", "5");
  });
});
