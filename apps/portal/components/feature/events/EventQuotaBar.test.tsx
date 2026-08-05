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
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/events/EventQuotaBar.tsx"),
      "utf8",
    );

    expect(css).toMatch(
      /grid-template-columns:\s*repeat\(var\(--quota-slot-count\), minmax\(0, 1fr\)\)/,
    );
    expect(css).not.toMatch(/grid-template-columns:[^;]*(auto-fit|auto-fill)/);
    expect(css).not.toContain("var(--status-warning)");
    expect(css).not.toContain(".quota-bar__overall");
    expect(css).not.toContain(".quota-bar__slot-status");
    expect(source).not.toContain('import { Tooltip } from "@mantine/core"');
    expect(source).not.toContain("<Tooltip");
  });

  it("spends hue on role identity and uses a neutral fill for generic capacity", () => {
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/events/EventQuotaBar.css"),
      "utf8",
    );
    const fillColorRules = [...css.matchAll(/--quota-state-color:\s*var\((--[a-z0-9-]+)\)/g)]
      .map((match) => match[1]!);

    /* 条子的色相只编码「这是哪一格」：无岗位容量用中性色，岗位用四位分类色序，
       「其他」再弱一级。状态色不作为常态填充色；超员另由柔和的 color-mix 处理。 */
    expect(new Set(fillColorRules)).toEqual(new Set([
      "--text-secondary",
      "--series-1",
      "--series-2",
      "--series-3",
      "--series-4",
      "--text-muted",
    ]));
    expect(fillColorRules).not.toContain("--status-danger");
    expect(fillColorRules).not.toContain("--status-success");
    expect(fillColorRules).not.toContain("--status-warning");

    /* 分类色必须取自位次（data-quota-series），不许挂在状态上：挂在状态上就又变回
       「色相说状态」了。 */
    expect(css).not.toMatch(/data-quota-state="(ready|filling)"\][^{]*\{[^}]*--quota-state-color/);
    expect(css).toMatch(/data-quota-series="0"\]\s*\{\s*--quota-state-color:\s*var\(--series-1\)/);
    /* 超员规则必须写在分类色之后，且用弱化危险色，不能把整条刷成饱和实红。 */
    expect(css.indexOf('data-quota-state="over"'))
      .toBeGreaterThan(css.indexOf('data-quota-series="3"'));
    expect(css).toMatch(
      /data-quota-state="over"[^}]*--quota-state-color:\s*color-mix\([^)]*var\(--status-danger\)/s,
    );
    expect(css).not.toMatch(
      /data-quota-state="over"[^}]*--quota-state-color:\s*var\(--status-danger\)/s,
    );
    /* 够员仍然由计数变绿点名，不动条子。 */
    expect(css).toMatch(
      /data-quota-state="ready"\]\s+\.quota-bar__role-count\s*\{\s*color:\s*var\(--status-success\)/,
    );
  });

  it("assigns series colours by position and keeps Other out of the series", () => {
    renderQuotaBar({
      slots: [
        { key: "tank", class_ids: ["tank"], required: 1, matched: 0, dedicated: 0, eligible: 1, floor: 0, ceiling: 1, status: "short", member_ids: [] },
        { key: "healer", class_ids: ["healer"], required: 1, matched: 0, dedicated: 0, eligible: 1, floor: 0, ceiling: 1, status: "short", member_ids: [] },
      ],
      benched: [],
      unassigned: [],
      flexible: 0,
      requiredTotal: 2,
      matchedTotal: 0,
      shortfall: 2,
    }, [
      { tag_id: "tank", label: "Tank" },
      { tag_id: "healer", label: "Healer" },
    ], { capacity: 6, participantCount: 0 });

    const slots = [...document.querySelectorAll(".quota-bar__slot")];
    expect(slots.map((slot) => slot.getAttribute("data-quota-series")))
      .toEqual(["0", "1", "other"]);
  });

  it("marks the signup bar as over when participants pass a finite capacity", () => {
    renderQuotaBar(null, [], { capacity: 10, participantCount: 12 });

    expect(document.querySelector(".quota-bar__generic")).toHaveAttribute("data-quota-state", "over");
  });

  it("keeps every progress track the same height, including over-capacity tracks", () => {
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/events/EventQuotaBar.css"),
      "utf8",
    );
    const progressRule = css.match(/\.quota-bar__progress\s*\{[^}]*\}/)?.[0] ?? "";
    const heightContract = css.match(
      /\.quota-bar__slots,\s*\.quota-bar__generic,\s*\.quota-bar__unlimited-state\s*\{[^}]*\}/,
    )?.[0] ?? "";
    const overRules = [...css.matchAll(/[^{}]*data-quota-state="over"[^{}]*\{[^}]*\}/g)]
      .map((match) => match[0]);

    expect(progressRule).toContain("height: 8px");
    expect(heightContract).toContain("min-height: var(--control-icon-size-regular)");
    expect(overRules.length).toBeGreaterThan(0);
    expect(overRules.join("\n")).not.toMatch(/\bheight\s*:/);
  });

  it("keeps the Other column out of the alarm state while it is merely filling up", () => {
    renderQuotaBar({
      slots: [
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
      ],
      benched: [],
      unassigned: [],
      flexible: 0,
      requiredTotal: 2,
      matchedTotal: 2,
      shortfall: 0,
    }, [
      { tag_id: "tank", label: "Tank" },
    ], { capacity: 8, participantCount: 5 });

    const other = screen.getByRole("progressbar", { name: "quota.role.other" });
    expect(other.closest(".quota-bar__slot")).toHaveAttribute("data-quota-state", "filling");
  });

  it("uses mutually exclusive assignments when a swing member cannot fill two seats", () => {
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

    const tank = screen.getByRole("progressbar", { name: "Tank" });
    const healer = screen.getByRole("progressbar", { name: "Healer" });
    expect(tank).toHaveAttribute("aria-valuenow", "1");
    expect(tank.closest(".quota-bar__slot")).toHaveAttribute("data-quota-state", "ready");
    expect(healer).toHaveAttribute("aria-valuenow", "0");
    expect(healer.closest(".quota-bar__slot")).toHaveAttribute("data-quota-state", "filling");
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByText("0 / 1")).toBeInTheDocument();
    expect(screen.queryByText("quota.lineup.short")).not.toBeInTheDocument();
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

    expect(screen.getAllByText("2 / 2")).toHaveLength(3);
    expect(screen.getByRole("progressbar", { name: "Healer" })).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByRole("progressbar", { name: "Tank" })).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByRole("progressbar", { name: "Damage" })).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByRole("list")).toHaveStyle("--quota-slot-count: 3");
    expect(document.querySelectorAll('[data-quota-state="ready"].quota-bar__slot')).toHaveLength(3);
  });

  it("adds one Other column so exclusive counts add up to finite team capacity", () => {
    renderQuotaBar({
      slots: [
        {
          key: "tank",
          class_ids: ["tank"],
          required: 2,
          matched: 2,
          dedicated: 1,
          eligible: 5,
          floor: 1,
          ceiling: 2,
          status: "flex",
          member_ids: ["tank-1", "swing"],
        },
        {
          key: "healer",
          class_ids: ["healer"],
          required: 2,
          matched: 2,
          dedicated: 1,
          eligible: 7,
          floor: 1,
          ceiling: 2,
          status: "flex",
          member_ids: ["healer-1", "swing-2"],
        },
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

    expect(screen.getAllByText("2 / 2")).toHaveLength(2);
    expect(screen.getByText("5 / 6")).toBeInTheDocument();
    expect(screen.queryByText("5 / 2")).not.toBeInTheDocument();
    expect(screen.queryByText("7 / 2")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "quota.role.other" })).toHaveAttribute(
      "aria-valuenow",
      "5",
    );
    expect(screen.getByRole("list")).toHaveStyle("--quota-slot-count: 3");

    const counts = [...document.querySelectorAll(".quota-bar__role-count")].map((node) => {
      const [current = "0", required = "0"] = node.textContent?.split("/") ?? [];
      return { current: Number(current.trim()), required: Number(required.trim()) };
    });
    expect(counts.reduce((total, count) => total + count.current, 0)).toBe(9);
    expect(counts.reduce((total, count) => total + count.required, 0)).toBe(10);
  });

  it("does not create a negative Other column when role requirements exceed capacity", () => {
    renderQuotaBar({
      slots: [
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
          key: "healer",
          class_ids: ["healer"],
          required: 2,
          matched: 1,
          dedicated: 1,
          eligible: 1,
          floor: 1,
          ceiling: 1,
          status: "short",
          member_ids: ["healer-1"],
        },
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

    expect(screen.queryByText("quota.role.other")).not.toBeInTheDocument();
    expect(screen.getByRole("list")).toHaveStyle("--quota-slot-count: 2");
    expect(screen.getByRole("region", { name: /quota\.capacityConflict/ })).toHaveAttribute(
      "title",
      "quota.capacityConflict",
    );
  });

  it("shows one neutral signup bar without repeating the header capacity count", () => {
    renderQuotaBar(null, [], { capacity: 12, participantCount: 8 });

    const progress = screen.getByRole("progressbar", { name: "quota.generic.label" });
    expect(progress).toHaveAttribute("aria-valuemax", "12");
    expect(progress).toHaveAttribute("aria-valuenow", "8");
    expect(screen.getByText("quota.generic.label")).toBeInTheDocument();
    expect(screen.queryByText("quota.generic.count")).not.toBeInTheDocument();
    expect(document.querySelector(".quota-bar__role-count")).toBeNull();
  });

  it("describes unlimited capacity as text without any fake track or progressbar", () => {
    renderQuotaBar(null, [], { capacity: null, participantCount: 3 });

    expect(screen.getByText("quota.generic.unlimited")).toBeInTheDocument();
    expect(screen.queryByText("quota.generic.unlimitedCount")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(document.querySelector(".quota-bar__progress")).toBeNull();
    expect(document.querySelector(".quota-bar__slots")).toBeNull();
    expect(document.querySelector(".quota-bar__unlimited-state")).not.toBeNull();
  });
});
