import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminSystemSection } from "./AdminSystemSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderSection() {
  render(createElement(
    MantineProvider,
    null,
    createElement(AdminSystemSection, {
      statusLoading: false,
      statusError: false,
      onRetryStatus: () => {},
      statusData: {
        db: "ok (D1)",
        r2: "ok (R2)",
        ws: "ok (Durable Object)",
        crons: "configured (Cron Triggers)",
      },
      statusLatencyMs: 12,
    }),
  ));
}

describe("AdminSystemSection", () => {
  it("localizes decorated runtime signals without exposing backend details", () => {
    renderSection();

    expect(screen.getByText("D1")).toBeInTheDocument();
    expect(screen.getByText("R2")).toBeInTheDocument();
    expect(screen.getByText("status.signal.ok")).toBeInTheDocument();
    expect(screen.getByText("status.signal.configured")).toBeInTheDocument();
    expect(screen.queryByText(/DURABLE OBJECT/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/CRON TRIGGERS/i)).not.toBeInTheDocument();
  });

  it("uses the normal UI font and a width-safe table", () => {
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/admin/AdminSystemSection.css"),
      "utf8",
    );
    const signalRule = css.match(/\.system-health-ledger__signal\s*\{([^}]*)\}/)?.[1] ?? "";
    const tableRule = css.match(/\.system-health-ledger__table\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(signalRule).toContain("font-family: inherit");
    expect(signalRule).not.toContain("monospace");
    expect(tableRule).toContain("min-width: 0");
  });
});
