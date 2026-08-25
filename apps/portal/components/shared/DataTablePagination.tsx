import { useTranslation } from "react-i18next";
import type { useReactTable } from "@tanstack/react-table";
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
import "./DataTablePagination.css";

type DataTablePaginationProps<T> = {
  table: ReturnType<typeof useReactTable<T>>;
  pageSizeOptions?: number[];
};

function visiblePages(currentPage: number, pageCount: number): Array<number | "ellipsis"> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);

  const pages = [...new Set([1, currentPage - 1, currentPage, currentPage + 1, pageCount])]
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((left, right) => left - right);
  const result: Array<number | "ellipsis"> = [];
  pages.forEach((page, index) => {
    if (index > 0 && page - pages[index - 1]! > 1) result.push("ellipsis");
    result.push(page);
  });
  return result;
}

export function DataTablePagination<T>({
  table,
  pageSizeOptions = [10, 20, 50],
}: DataTablePaginationProps<T>) {
  const { t } = useTranslation("common");
  const pageCount = table.getPageCount();

  if (pageCount <= 1) return null;

  const currentPage = table.getState().pagination.pageIndex + 1;

  return (
    <div className="data-table-pagination">
      <div className="data-table-pagination__page-size">
        <span>{t("pagination.perPage")}</span>
        <Select
          value={String(table.getState().pagination.pageSize)}
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

        {visiblePages(currentPage, pageCount).map((page, index) => page === "ellipsis" ? (
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
    </div>
  );
}
