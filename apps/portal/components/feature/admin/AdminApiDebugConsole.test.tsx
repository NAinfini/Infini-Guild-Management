// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DebugLogEntry } from "./AdminApiTestEngine";
import { AdminApiDebugConsole } from "./AdminApiDebugConsole";

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

function renderConsole(logs: DebugLogEntry[], open = true) {
  const onToggle = vi.fn();
  render(
    <MantineProvider>
      <AdminApiDebugConsole logs={logs} onClear={vi.fn()} open={open} onToggle={onToggle} />
    </MantineProvider>,
  );
  return { onToggle };
}

describe("AdminApiDebugConsole", () => {
  it("keeps filters, rows, and both console actions at 44px minimum targets", () => {
    const css = readFileSync(
      resolve(
        process.cwd(),
        "apps/portal/components/feature/admin/AdminApiTest.css",
      ),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const filterRule = css.match(/\.api-debug__filter-btn\s*\{([^}]+)\}/)?.[1];
    const rowRule = css.match(/\.api-debug__row-main\s*\{([^}]+)\}/)?.[1];
    /* 运行和停止两个按钮共用同一条规则；停止按钮的 44px 此前是 TSX 里的 h={44}。 */
    const consoleActionRule = css.match(
      /\.api-console__header\s+\.api-console__run-all,\s*\.api-console__header\s+\.api-console__stop\s*\{([^}]+)\}/,
    )?.[1];

    expect(filterRule).toMatch(/min-width:\s*44px/);
    expect(filterRule).toMatch(/min-height:\s*44px/);
    expect(rowRule).toMatch(/min-height:\s*44px/);
    expect(consoleActionRule).toMatch(/min-height:\s*44px/);
  });

  it("hides its body behind a disclosure that reports the collapsed state", async () => {
    const user = userEvent.setup();
    const { onToggle } = renderConsole([successLog], false);

    const disclosure = screen.getByRole("button", { name: /status\.api\.debugTitle/ });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("/api/health"), "折起时内容仍在 DOM 里，只是不可见").not.toBeVisible();

    await user.click(disclosure);
    expect(onToggle).toHaveBeenCalledOnce();
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
      screen.getByRole("button", { name: "status.api.filter.errors" }),
    );

    expect(screen.getByText("status.api.noErrors")).toBeInTheDocument();
    expect(screen.queryByText("No errors found")).not.toBeInTheDocument();
  });
});
