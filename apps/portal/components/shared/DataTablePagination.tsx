import { Group, Pagination, Select, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { useReactTable } from "@tanstack/react-table";

type DataTablePaginationProps<T> = {
  table: ReturnType<typeof useReactTable<T>>;
  pageSizeOptions?: number[];
};

export function DataTablePagination<T>({
  table,
  pageSizeOptions = [10, 20, 50],
}: DataTablePaginationProps<T>) {
  const { t } = useTranslation("common");
  const pageCount = table.getPageCount();

  if (pageCount <= 1) return null;

  const currentPage = table.getState().pagination.pageIndex + 1;

  return (
    <Group justify="space-between" align="center" mt="sm" wrap="wrap">
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
      <Pagination
        total={pageCount}
        value={currentPage}
        onChange={(page) => table.setPageIndex(page - 1)}
        withEdges
        siblings={1}
        boundaries={1}
        aria-label={t("pagination.page")}
      />
    </Group>
  );
}
