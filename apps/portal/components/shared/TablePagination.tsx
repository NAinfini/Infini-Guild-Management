import { ActionIcon, Group, NumberInput, Select, Text } from "@mantine/core";
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

  const pageButtons: (number | "ellipsis-left" | "ellipsis-right")[] = [];
  const siblings = 1;
  const start = Math.max(2, currentPage - siblings);
  const end = Math.min(pageCount - 1, currentPage + siblings);

  pageButtons.push(1);
  if (start > 2) pageButtons.push("ellipsis-left");
  for (let i = start; i <= end; i++) pageButtons.push(i);
  if (end < pageCount - 1) pageButtons.push("ellipsis-right");
  if (pageCount > 1) pageButtons.push(pageCount);

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
        <ActionIcon
          size="sm"
          variant="default"
          disabled={!table.getCanPreviousPage()}
          onClick={() => table.setPageIndex(0)}
          title={t("pagination.first")}
        >
          «
        </ActionIcon>
        <ActionIcon
          size="sm"
          variant="default"
          disabled={!table.getCanPreviousPage()}
          onClick={() => table.previousPage()}
          title={t("pagination.prev")}
        >
          ‹
        </ActionIcon>

        {pageButtons.map((item) => {
          if (item === "ellipsis-left" || item === "ellipsis-right") {
            return <Text key={item} size="sm" c="dimmed" px={2}>…</Text>;
          }
          return (
            <ActionIcon
              key={item}
              size="sm"
              variant={item === currentPage ? "filled" : "default"}
              onClick={() => table.setPageIndex(item - 1)}
            >
              {item}
            </ActionIcon>
          );
        })}

        <ActionIcon
          size="sm"
          variant="default"
          disabled={!table.getCanNextPage()}
          onClick={() => table.nextPage()}
          title={t("pagination.next")}
        >
          ›
        </ActionIcon>
        <ActionIcon
          size="sm"
          variant="default"
          disabled={!table.getCanNextPage()}
          onClick={() => table.setPageIndex(pageCount - 1)}
          title={t("pagination.last")}
        >
          »
        </ActionIcon>

        <NumberInput
          size="xs"
          min={1}
          max={pageCount}
          value={currentPage}
          onChange={(val) => {
            if (typeof val === "number" && val >= 1 && val <= pageCount) {
              table.setPageIndex(val - 1);
            }
          }}
          hideControls
          style={{ width: 56 }}
          styles={{ input: { textAlign: "center" } }}
        />
        <Text size="sm" c="dimmed">/ {pageCount}</Text>
      </Group>
    </Group>
  );
}
