// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import {
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { describe, expect, it, vi } from "vitest";
import { DataTablePagination } from "./DataTablePagination";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { page?: number }) => ({
      "pagination.perPage": "Per page",
      "pagination.page": "Pagination",
      "pagination.first": "First page",
      "pagination.last": "Last page",
      "pagination.prev": "Previous page",
      "pagination.next": "Next page",
      "pagination.goToPage": `Go to page ${options?.page}`,
    })[key] ?? key,
  }),
}));

function PaginationHarness() {
  const table = useReactTable({
    data: Array.from({ length: 30 }, (_, id) => ({ id })),
    columns: [],
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return <DataTablePagination table={table} />;
}

describe("DataTablePagination accessibility", () => {
  it("localizes the page-size and pagination control names", () => {
    render(
      <MantineProvider>
        <PaginationHarness />
      </MantineProvider>,
    );

    expect(screen.getByRole("combobox", { name: "Per page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to page 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Last page" })).toBeInTheDocument();
  });
});
