// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MetricGridInput } from "./MetricGridInput";

function renderGrid() {
  render(
    <MantineProvider>
      {[0, 1].flatMap((rowIndex) =>
        [0, 1].map((columnIndex) => (
          <MetricGridInput
            key={`${rowIndex}-${columnIndex}`}
            aria-label={`cell-${rowIndex}-${columnIndex}`}
            gridId="test-grid"
            rowIndex={rowIndex}
            columnIndex={columnIndex}
            rowCount={2}
            columnCount={2}
            defaultValue={rowIndex * 2 + columnIndex}
          />
        )),
      )}
    </MantineProvider>,
  );
}

describe("MetricGridInput", () => {
  it("moves forward in row order with Enter and Tab", async () => {
    const user = userEvent.setup();
    renderGrid();

    const first = screen.getByLabelText("cell-0-0");
    const second = screen.getByLabelText("cell-0-1");
    const third = screen.getByLabelText("cell-1-0");

    first.focus();
    await user.keyboard("{Enter}");
    expect(second).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(third).toHaveFocus();

    first.focus();
    await user.tab();
    expect(second).toHaveFocus();
  });

  it("moves vertically without changing numeric values", async () => {
    const user = userEvent.setup();
    renderGrid();

    const first = screen.getByLabelText("cell-0-0");
    const third = screen.getByLabelText("cell-1-0");

    first.focus();
    await user.keyboard("{ArrowDown}");
    expect(third).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(first).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(first).toHaveFocus();
    expect(first).toHaveValue("0");
  });
});
