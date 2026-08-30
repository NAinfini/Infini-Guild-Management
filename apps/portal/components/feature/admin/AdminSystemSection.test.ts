import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminSystemSection } from "./AdminSystemSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderSection() {
  render(createElement(AdminSystemSection, {
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
    }));
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
});
