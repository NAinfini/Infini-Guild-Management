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

function renderConsole(logs: DebugLogEntry[]) {
  render(
    <MantineProvider>
      <AdminApiDebugConsole logs={logs} onClear={vi.fn()} />
    </MantineProvider>,
  );
}

describe("AdminApiDebugConsole", () => {
  it("keeps filters, rows, and the run-all action at 44px minimum targets", () => {
    const css = readFileSync(
      resolve(
        process.cwd(),
        "apps/portal/components/feature/admin/AdminApiTest.css",
      ),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const filterRule = css.match(/\.api-debug__filter-btn\s*\{([^}]+)\}/)?.[1];
    const rowRule = css.match(/\.api-debug__row-main\s*\{([^}]+)\}/)?.[1];
    const runAllRule = css.match(
      /\.api-console__header\s+\.api-console__run-all\s*\{([^}]+)\}/,
    )?.[1];

    expect(filterRule).toMatch(/min-width:\s*44px/);
    expect(filterRule).toMatch(/min-height:\s*44px/);
    expect(rowRule).toMatch(/min-height:\s*44px/);
    expect(runAllRule).toMatch(/min-height:\s*44px/);
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
