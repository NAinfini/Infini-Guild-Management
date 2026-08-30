import { fireEvent, render, screen } from "@testing-library/react";
import {
  createColumnHelper,
  useTable,
} from "@tanstack/react-table";
import { describe, expect, it, vi } from "vitest";
import { DataTableAdapter } from "./DataTableAdapter";
import { dataTableFeatures } from "./data-table-features";

type RowData = { id: string; name: string };
const column = createColumnHelper<typeof dataTableFeatures, RowData>();
const columns = column.columns([
  column.accessor("name", { header: "Name" }),
]);

function TableHarness({
  onRowKeyDown,
}: {
  onRowKeyDown: (id: string, key: string) => void;
}) {
  const table = useTable({
    features: dataTableFeatures,
    data: [{ id: "user-1", name: "Alice" }],
    columns,
    getRowId: (row) => row.id,
  });

  return (
    <DataTableAdapter
      table={table}
      onRowKeyDown={(row, event) => onRowKeyDown(row.id, event.key)}
      rowAriaLabel={(row) => `Member ${row.original.name}`}
      rowAriaSelected={() => true}
    />
  );
}

describe("DataTableAdapter accessibility", () => {
  it("makes interactive rows keyboard focusable and exposes selection", () => {
    const onRowKeyDown = vi.fn();
    render(<TableHarness onRowKeyDown={onRowKeyDown} />);

    const row = screen.getByRole("row", { name: "Member Alice" });
    expect(row).toHaveAttribute("tabindex", "0");
    expect(row).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(row, { key: "Enter" });
    expect(onRowKeyDown).toHaveBeenCalledWith("user-1", "Enter");
  });
});

/* 表头粘住时必须被样式表刷成不透明，否则滚过去的行会从它底下透出来。
   样式表靠这个标记选中表头，所以标记本身要钉住。 */
describe("DataTableAdapter sticky header", () => {
  function StickyHarness({ virtualize }: { virtualize: boolean }) {
    const table = useTable({
      features: dataTableFeatures,
      data: [{ id: "user-1", name: "Alice" }],
      columns,
      getRowId: (row) => row.id,
    });
    return <DataTableAdapter table={table} virtualize={virtualize} />;
  }

  it("marks the header only when the body scrolls under it", () => {
    const { container, rerender } = render(
      <StickyHarness virtualize />,
    );
    expect(container.querySelector("thead")).toHaveAttribute("data-sticky-header");

    rerender(
      <StickyHarness virtualize={false} />,
    );
    expect(container.querySelector("thead")).not.toHaveAttribute("data-sticky-header");
  });
});
