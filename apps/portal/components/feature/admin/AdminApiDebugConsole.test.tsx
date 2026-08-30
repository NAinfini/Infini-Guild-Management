import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function renderConsole(logs: DebugLogEntry[], clearDisabled = false) {
  render(<AdminApiDebugConsole logs={logs} onClear={vi.fn()} clearDisabled={clearDisabled} />);
}

describe("AdminApiDebugConsole", () => {
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

  it("keeps clear disabled while the active run still needs its teardown identity", () => {
    renderConsole([successLog], true);

    expect(screen.getByRole("button", { name: "status.api.clearDebug" })).toBeDisabled();
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
