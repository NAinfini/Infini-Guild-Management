import { render, screen } from "@testing-library/react";
import {
  useTable,
} from "@tanstack/react-table";
import { describe, expect, it, vi } from "vitest";
import { DataTablePagination } from "./DataTablePagination";
import { dataTableFeatures } from "./data-table-features";

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

function PaginationHarness({ rowCount = 30, pageSize = 10 }: {
  rowCount?: number;
  pageSize?: number;
}) {
  const table = useTable({
    features: dataTableFeatures,
    data: Array.from({ length: rowCount }, (_, id) => ({ id })),
    columns: [],
    initialState: { pagination: { pageIndex: 0, pageSize } },
  });

  return <DataTablePagination table={table} />;
}

describe("DataTablePagination accessibility", () => {
  it("localizes the page-size and pagination control names", () => {
    render(
      <PaginationHarness />,
    );

    expect(screen.getByRole("combobox", { name: "Per page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to page 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Last page" })).toBeInTheDocument();
  });

  it("keeps the page-size control available when the selected size leaves one page", () => {
    render(<PaginationHarness rowCount={30} pageSize={50} />);

    expect(screen.getByRole("combobox", { name: "Per page" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
  });
});
