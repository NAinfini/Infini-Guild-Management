import { Table, UnstyledButton } from "@mantine/core";
import {
  type ColumnDef,
  type PaginationState,
  type Row,
  type SortingState,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { forwardRef, useRef, type CSSProperties, type MutableRefObject, type MouseEvent as ReactMouseEvent, type ReactNode, type Ref } from "react";
import clsx from "clsx";

export type { ColumnDef, PaginationState, Row, SortingState, RowSelectionState };
export { flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable };

type InfiniTableProps<T> = {
  table: ReturnType<typeof useReactTable<T>>;
  striped?: boolean;
  highlightOnHover?: boolean;
  withTableBorder?: boolean;
  withColumnBorders?: boolean;
  onRowClick?: (row: Row<T>, event: ReactMouseEvent<HTMLTableRowElement>) => void;
  onRowDoubleClick?: (row: Row<T>, event: ReactMouseEvent<HTMLTableRowElement>) => void;
  onRowContextMenu?: (row: Row<T>, event: ReactMouseEvent<HTMLTableRowElement>) => void;
  rowClassName?: (row: Row<T>) => string | undefined;
  rowStyle?: (row: Row<T>) => CSSProperties | undefined;
  emptyContent?: ReactNode;
  className?: string;
  style?: CSSProperties;
  virtualize?: boolean;
  maxHeight?: number | string;
};

function SortIndicator({ sorted }: { sorted: false | "asc" | "desc" }) {
  return (
    <span style={{ opacity: sorted ? 1 : 0.3, fontSize: 10, marginLeft: 4 }}>
      {sorted === "desc" ? "▼" : "▲"}
    </span>
  );
}

function InfiniTableInner<T>({
  table,
  striped = true,
  highlightOnHover = false,
  withTableBorder = true,
  withColumnBorders = true,
  onRowClick,
  onRowDoubleClick,
  onRowContextMenu,
  rowClassName,
  rowStyle,
  emptyContent,
  className,
  style,
  virtualize = false,
  maxHeight = "70vh",
  ...rest
}: InfiniTableProps<T>, ref: Ref<HTMLDivElement>) {
  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: virtualize ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 42,
    overscan: 5,
  });

  if (emptyContent && rows.length === 0) {
    return <>{emptyContent}</>;
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? (virtualItems[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0)
      : 0;

  const wrapperStyle: CSSProperties = virtualize
    ? { overflow: "auto", maxHeight, ...style }
    : { ...style };

  return (
    <div
      ref={(node) => {
        (scrollRef as MutableRefObject<HTMLDivElement | null>).current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          (ref as MutableRefObject<HTMLDivElement | null>).current = node;
        }
      }}
      className={clsx(className)}
      style={wrapperStyle}
      {...rest}
    >
      <Table
        withTableBorder={withTableBorder}
        withColumnBorders={withColumnBorders}
        striped={striped}
        highlightOnHover={highlightOnHover}
      >
        <Table.Thead
          style={
            virtualize
              ? { position: "sticky", top: 0, zIndex: 1, background: "inherit" }
              : undefined
          }
        >
          {table.getHeaderGroups().map((headerGroup) => (
            <Table.Tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                const content = header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext());

                return (
                  <Table.Th
                    key={header.id}
                    colSpan={header.colSpan}
                    style={header.column.columnDef.size ? { width: header.column.columnDef.size } : undefined}
                  >
                    {canSort ? (
                      <UnstyledButton
                        onClick={header.column.getToggleSortingHandler()}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          fontWeight: 600,
                          fontSize: "inherit",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {content}
                        <SortIndicator sorted={sorted} />
                      </UnstyledButton>
                    ) : (
                      content
                    )}
                  </Table.Th>
                );
              })}
            </Table.Tr>
          ))}
        </Table.Thead>
        <Table.Tbody>
          {virtualize ? (
            <>
              {paddingTop > 0 && (
                <tr>
                  <td style={{ height: paddingTop }} colSpan={99} />
                </tr>
              )}
              {virtualItems.map((virtualRow) => {
                const row = rows[virtualRow.index]!;
                return (
                  <Table.Tr
                    key={row.id}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    onClick={onRowClick ? (event) => onRowClick(row, event) : undefined}
                    onDoubleClick={onRowDoubleClick ? (event) => onRowDoubleClick(row, event) : undefined}
                    onContextMenu={onRowContextMenu ? (event) => onRowContextMenu(row, event) : undefined}
                    style={{
                      ...(onRowClick || onRowContextMenu ? { cursor: "pointer" } : {}),
                      ...rowStyle?.(row),
                    }}
                    className={rowClassName?.(row)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <Table.Td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                );
              })}
              {paddingBottom > 0 && (
                <tr>
                  <td style={{ height: paddingBottom }} colSpan={99} />
                </tr>
              )}
            </>
          ) : (
            rows.map((row) => (
              <Table.Tr
                key={row.id}
                onClick={onRowClick ? (event) => onRowClick(row, event) : undefined}
                onDoubleClick={onRowDoubleClick ? (event) => onRowDoubleClick(row, event) : undefined}
                onContextMenu={onRowContextMenu ? (event) => onRowContextMenu(row, event) : undefined}
                style={{
                  ...(onRowClick || onRowContextMenu ? { cursor: "pointer" } : {}),
                  ...rowStyle?.(row),
                }}
                className={rowClassName?.(row)}
              >
                {row.getVisibleCells().map((cell) => (
                  <Table.Td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </Table.Td>
                ))}
              </Table.Tr>
            ))
          )}
        </Table.Tbody>
      </Table>
    </div>
  );
}

export const InfiniTable = forwardRef(InfiniTableInner) as <T>(
  props: InfiniTableProps<T> & { ref?: Ref<HTMLDivElement> }
) => ReturnType<typeof InfiniTableInner>;
