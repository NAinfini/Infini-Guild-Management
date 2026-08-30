import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CategoryDef, EndpointResult } from "./AdminApiTestEngine";
import { ApiTestCategory } from "./AdminApiTestCategory";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const category: CategoryDef = {
  key: "system",
  label: "System",
  endpoints: [
    {
      label: "Health Check",
      method: "GET",
      path: "/api/health",
    },
  ],
};

function renderCategory(onRunCategory = vi.fn().mockResolvedValue(undefined)) {
  render(
    <ApiTestCategory
      category={category}
      onRunCategory={onRunCategory}
      runningSet={new Set()}
      resultMap={new Map()}
    />,
  );
  return onRunCategory;
}

describe("ApiTestCategory", () => {
  it("exposes a keyboard-operable disclosure separate from the run action", async () => {
    const user = userEvent.setup();
    renderCategory();

    const disclosure = screen.getByRole("button", { name: "System: 0/1" });
    const runButton = screen.getByRole("button", { name: "System" });

    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(runButton).toHaveClass("api-cat__run-button");
    expect(screen.queryByText("Health Check")).not.toBeInTheDocument();

    disclosure.focus();
    await user.keyboard("{Enter}");

    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Health Check")).toBeInTheDocument();

    await user.keyboard(" ");

    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Health Check")).not.toBeInTheDocument();
  });

  it("runs the category without toggling the disclosure", async () => {
    const onRunCategory = renderCategory();

    fireEvent.click(screen.getByRole("button", { name: "System" }));

    expect(onRunCategory).toHaveBeenCalledWith(category);
    expect(screen.getByRole("button", { name: "System: 0/1" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("shows only failed endpoints while preserving optional skips", async () => {
    const user = userEvent.setup();
    const mixedCategory: CategoryDef = {
      key: "system",
      label: "System",
      endpoints: [
        { label: "Healthy", method: "GET", path: "/api/health" },
        { label: "Failed", method: "GET", path: "/api/failure" },
        { label: "Not applicable", method: "GET", path: "/api/optional" },
      ],
    };
    const result = (status: number | null, skipped = false): EndpointResult => ({
      status,
      latencyMs: 1,
      body: "",
      error: skipped ? null : status === null ? "Request failed" : null,
      ranAt: "2026-08-10T00:00:00.000Z",
      parsedJson: null,
      skipped,
    });
    const resultMap = new Map<string, EndpointResult>([
      ["system:GET-/api/health", result(200)],
      ["system:GET-/api/failure", result(500)],
      ["system:GET-/api/optional", result(null, true)],
    ]);

    render(
      <ApiTestCategory
        category={mixedCategory}
        onRunCategory={vi.fn().mockResolvedValue(undefined)}
        runningSet={new Set()}
        resultMap={resultMap}
        showOnlyErrors
      />,
    );

    await user.click(screen.getByRole("button", { name: "System: 3/3" }));

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
    expect(screen.queryByText("Not applicable")).not.toBeInTheDocument();
  });
});
