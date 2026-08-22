import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DebugLogEntry } from "./AdminApiTestEngine";
import { AdminApiDebugConsole, formatLogEntry } from "./AdminApiDebugConsole";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const successLog: DebugLogEntry = {
  id: "log-1",
  category: "System",
  label: "Health Check",
  method: "GET",
  path: "/api/health",
  status: 200,
  latencyMs: 25,
  error: null,
  body: '{"ok":true}',
  ranAt: "2026-07-28T12:00:00.000Z",
};

function renderConsole(logs: DebugLogEntry[]) {
  render(
    <MantineProvider>
      <AdminApiDebugConsole logs={logs} onClear={vi.fn()} />
    </MantineProvider>,
  );
}

describe("AdminApiDebugConsole", () => {
  it("keeps rows and primary actions touch-sized while the result filter stays compact", () => {
    const css = readFileSync(
      resolve(
        process.cwd(),
        "apps/portal/components/feature/admin/AdminApiTest.css",
      ),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const filterRule = css.match(/\.api-filter \.mantine-SegmentedControl-label\s*\{([^}]+)\}/)?.[1];
    const rowRule = css.match(/\.api-debug__row-main\s*\{([^}]+)\}/)?.[1];

    expect(filterRule).toMatch(/min-height:\s*28px/);
    expect(rowRule).toMatch(/min-height:\s*44px/);

    /* 表头三个按钮是文字控件，高度归 --control-height-regular 管：细指针 36px、
       粗指针 44px，一处切换。在这里钉死 44px 就是把它们比同屏按钮抬高一档，
       而且触控档位的事实来源被复制成两份。 */
    expect(css).not.toMatch(/\.api-console__(run-all|run-critical|stop)[^{}]*\{[^}]*(min-)?height:/);
  });

  it("keeps the console body expanded without a second disclosure layer", () => {
    renderConsole([successLog]);

    expect(screen.getByText("/api/health")).toBeVisible();
    expect(document.querySelector(".admin-status-toggle")).toBeNull();
  });

  it("keeps the result filter in the title row without segmented dividers", () => {
    renderConsole([successLog]);

    const header = document.querySelector(".api-debug .admin-panel__head");
    const filter = screen.getByRole("group", { name: "status.api.filter.results" });

    expect(header).toContainElement(filter);
    expect(document.querySelector(".api-debug__toolbar")).toBeNull();
    expect(document.querySelector(".mantine-SegmentedControl-separator")).toBeNull();
  });

  it("exposes log details through a keyboard-operable disclosure", async () => {
    const user = userEvent.setup();
    renderConsole([successLog]);

    const disclosure = screen.getByRole("button", {
      name: "GET /api/health",
    });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText('{"ok":true}')).not.toBeInTheDocument();

    disclosure.focus();
    await user.keyboard("{Enter}");

    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText('{"ok":true}')).toBeInTheDocument();
  });

  it("uses localized filter and empty-state labels", async () => {
    const user = userEvent.setup();
    renderConsole([successLog]);

    await user.click(
      screen.getByRole("radio", { name: "status.api.filter.errors" }),
    );

    expect(screen.getByText("status.api.noErrors")).toBeInTheDocument();
    expect(screen.queryByText("No errors found")).not.toBeInTheDocument();
  });

  it("copies intentional safety exclusions as N/A instead of errors", () => {
    expect(formatLogEntry({
      ...successLog,
      status: null,
      error: null,
      skipped: true,
      body: "Global mutation intentionally excluded",
    })).toContain("→ N/A");
  });
});
