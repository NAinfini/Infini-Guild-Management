import { useTranslation } from "react-i18next";
import type { ReactTable, RowData } from "@tanstack/react-table";
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
} from "@tabler/icons-react";
import { Button } from "@portal/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@portal/components/ui/select";
import { buildVisiblePages } from "@portal/utils/pagination";
import "./DataTablePagination.css";
import type { DataTableFeatures } from "./data-table-features";

type DataTablePaginationProps<TData extends RowData> = {
  table: ReactTable<DataTableFeatures, TData>;
  pageSizeOptions?: number[];
};

export function DataTablePagination<TData extends RowData>({
  table,
  pageSizeOptions = [10, 20, 50],
}: DataTablePaginationProps<TData>) {
  const { t } = useTranslation("common");
  const pageCount = table.getPageCount();
  const currentPage = table.state.pagination.pageIndex + 1;

  return (
    <div className="data-table-pagination">
      <div className="data-table-pagination__page-size">
        <span>{t("pagination.perPage")}</span>
        <Select
          value={String(table.state.pagination.pageSize)}
          items={pageSizeOptions.map((size) => ({ value: String(size), label: String(size) }))}
          onValueChange={(value) => {
            if (value) table.setPageSize(Number(value));
          }}
        >
          <SelectTrigger size="sm" className="data-table-pagination__select" aria-label={t("pagination.perPage")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((size) => (
              <SelectItem key={size} value={String(size)}>{size}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {pageCount > 1 ? (
        <nav className="data-table-pagination__controls" aria-label={t("pagination.page")}>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("pagination.first")}
            disabled={currentPage === 1}
            onClick={() => table.setPageIndex(0)}
          >
            <IconChevronsLeft aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("pagination.prev")}
            disabled={currentPage === 1}
            onClick={() => table.previousPage()}
          >
            <IconChevronLeft aria-hidden />
          </Button>

          {buildVisiblePages(currentPage, pageCount).map((page, index) => page === "ellipsis" ? (
            <span key={`ellipsis-${index}`} className="data-table-pagination__ellipsis" aria-hidden>…</span>
          ) : (
            <Button
              key={page}
              type="button"
              size="icon-sm"
              variant={page === currentPage ? "secondary" : "ghost"}
              aria-label={t("pagination.goToPage", { page })}
              aria-current={page === currentPage ? "page" : undefined}
              onClick={() => table.setPageIndex(page - 1)}
            >
              {page}
            </Button>
          ))}

          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("pagination.next")}
            disabled={currentPage === pageCount}
            onClick={() => table.nextPage()}
          >
            <IconChevronRight aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("pagination.last")}
            disabled={currentPage === pageCount}
            onClick={() => table.setPageIndex(pageCount - 1)}
          >
            <IconChevronsRight aria-hidden />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
