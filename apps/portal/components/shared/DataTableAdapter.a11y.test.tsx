// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { describe, expect, it, vi } from "vitest";
import { DataTableAdapter } from "./DataTableAdapter";

type RowData = { id: string; name: string };
const column = createColumnHelper<RowData>();

function TableHarness({
  onRowKeyDown,
}: {
  onRowKeyDown: (id: string, key: string) => void;
}) {
  const table = useReactTable({
    data: [{ id: "user-1", name: "Alice" }],
    columns: [column.accessor("name", { header: "Name" })],
    getCoreRowModel: getCoreRowModel(),
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
    render(
      <MantineProvider>
        <TableHarness onRowKeyDown={onRowKeyDown} />
      </MantineProvider>,
    );

    const row = screen.getByRole("row", { name: "Member Alice" });
    expect(row).toHaveAttribute("tabindex", "0");
    expect(row).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(row, { key: "Enter" });
    expect(onRowKeyDown).toHaveBeenCalledWith("user-1", "Enter");
  });
});
