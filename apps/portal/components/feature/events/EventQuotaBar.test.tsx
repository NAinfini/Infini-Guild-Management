// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import type { Event } from "@guild/shared";
import type { ClassQuotaSummary } from "@guild/shared/utils/class-quota";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EventQuotaBar } from "./EventQuotaBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function renderQuotaBar(
  summary: ClassQuotaSummary | null,
  labels: Array<{ tag_id: string; label: string }>,
  { capacity = null, participantCount = 0 }: { capacity?: number | null; participantCount?: number } = {},
) {
  render(
    <MantineProvider>
      <EventQuotaBar
        summary={summary}
        event={{ class_quotas: labels, capacity } as Pick<Event, "class_quotas" | "capacity">}
        participantCount={participantCount}
      />
    </MantineProvider>,
  );
}

describe("EventQuotaBar", () => {
  it("keeps every role in one explicit grid row", () => {
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/events/EventQuotaBar.css"),
      "utf8",
    );

    expect(css).toMatch(
      /grid-template-columns:\s*repeat\(var\(--quota-slot-count\), minmax\(0, 1fr\)\)/,
    );
    expect(css).not.toMatch(/grid-template-columns:[^;]*(auto-fit|auto-fill)/);
    expect(css).not.toContain("var(--status-warning)");
  });

  it("shows role availability separately from an overall assignment conflict", () => {
    renderQuotaBar({
      slots: [
        {
          key: "tank",
          class_ids: ["tank"],
          required: 1,
          matched: 1,
          dedicated: 0,
          eligible: 1,
          floor: 0,
          ceiling: 1,
          status: "short",
          member_ids: ["swing"],
        },
        {
          key: "healer",
          class_ids: ["healer"],
          required: 1,
          matched: 0,
          dedicated: 0,
          eligible: 1,
          floor: 0,
          ceiling: 1,
          status: "short",
          member_ids: [],
        },
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

    expect(screen.getByText("quota.lineup.short")).toBeInTheDocument();
    for (const role of ["Tank", "Healer"]) {
      const progress = screen.getByRole("progressbar", { name: role });
      expect(progress).toHaveAttribute("aria-valuenow", "1");
      expect(progress.closest(".quota-bar__slot")).toHaveAttribute("data-quota-state", "ready");
    }
    expect(screen.getAllByText("1 / 1")).toHaveLength(2);
  });

  it("uses the same ready state for flexible and dedicated coverage", () => {
    renderQuotaBar({
      slots: [
        {
          key: "healer",
          class_ids: ["healer"],
          required: 2,
          matched: 2,
          dedicated: 1,
          eligible: 2,
          floor: 1,
          ceiling: 2,
          status: "flex",
          member_ids: ["dedicated-healer", "swing"],
        },
        {
          key: "tank",
          class_ids: ["tank"],
          required: 2,
          matched: 2,
          dedicated: 2,
          eligible: 2,
          floor: 2,
          ceiling: 2,
          status: "filled",
          member_ids: ["tank-1", "tank-2"],
        },
        {
          key: "damage",
          class_ids: ["damage"],
          required: 2,
          matched: 2,
          dedicated: 2,
          eligible: 2,
          floor: 2,
          ceiling: 2,
          status: "filled",
          member_ids: ["damage-1", "damage-2"],
        },
      ],
      benched: [],
      unassigned: [],
      flexible: 1,
      requiredTotal: 6,
      matchedTotal: 6,
      shortfall: 0,
    }, [
      { tag_id: "healer", label: "Healer" },
      { tag_id: "tank", label: "Tank" },
      { tag_id: "damage", label: "Damage" },
    ]);

    expect(screen.getByText("quota.lineup.ready")).toBeInTheDocument();
    expect(screen.getAllByText("2 / 2")).toHaveLength(3);
    expect(screen.getAllByText("quota.role.ready")).toHaveLength(3);
    expect(screen.getByRole("progressbar", { name: "Healer" })).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByRole("progressbar", { name: "Tank" })).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByRole("progressbar", { name: "Damage" })).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByRole("list")).toHaveStyle("--quota-slot-count: 3");
    expect(document.querySelectorAll('[data-quota-state="ready"].quota-bar__slot')).toHaveLength(3);
  });

  it("falls back to one signup bar when the event has no class quotas", () => {
    renderQuotaBar(null, [], { capacity: 12, participantCount: 8 });

    const progress = screen.getByRole("progressbar", { name: "quota.generic.label" });
    expect(progress).toHaveAttribute("aria-valuemax", "12");
    expect(progress).toHaveAttribute("aria-valuenow", "8");
    expect(screen.getByText("quota.generic.allMembers")).toBeInTheDocument();
  });

  it("describes unlimited capacity without exposing a fake completed progressbar", () => {
    renderQuotaBar(null, [], { capacity: null, participantCount: 3 });

    expect(screen.getByText("quota.generic.unlimited")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(document.querySelector(".quota-bar__progress--unlimited")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
