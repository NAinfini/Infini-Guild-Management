import { Button, Group, Select, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { useReactTable } from "@tanstack/react-table";

type TablePaginationProps<T> = {
  table: ReturnType<typeof useReactTable<T>>;
  pageSizeOptions?: number[];
};

export function TablePagination<T>({ table, pageSizeOptions = [10, 20, 50] }: TablePaginationProps<T>) {
  const { t } = useTranslation("common");
  const pageCount = table.getPageCount();

  if (pageCount <= 1) return null;

  const currentPage = table.getState().pagination.pageIndex + 1;

  return (
    <Group justify="space-between" align="center" mt={8}>
      <Group gap={8} align="center">
        <Text size="sm">{t("pagination.perPage")}</Text>
        <Select
          size="xs"
          data={pageSizeOptions.map((n) => ({ value: String(n), label: String(n) }))}
          value={String(table.getState().pagination.pageSize)}
          onChange={(val) => { if (val) table.setPageSize(Number(val)); }}
          style={{ width: 72 }}
          allowDeselect={false}
        />
      </Group>
      <Group gap={4} align="center">
        <Button size="xs" variant="default" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
          &lt;
        </Button>
        <Text size="sm">
          {t("pagination.page")} {currentPage} / {pageCount}
        </Text>
        <Button size="xs" variant="default" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
          &gt;
        </Button>
      </Group>
    </Group>
  );
}
