import { IconChevronDown, IconChevronUp, IconSelector } from "@tabler/icons-react";
import {
  type Row,
  flexRender,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import "./DataTableAdapter.css";

type DataTableAdapterProps<T> = {
  table: ReturnType<typeof useReactTable<T>>;
  appearance?: "grid" | "rows";
  striped?: boolean;
  rowHover?: boolean;
  onRowClick?: (row: Row<T>, event: ReactMouseEvent<HTMLTableRowElement>) => void;
  onRowDoubleClick?: (row: Row<T>, event: ReactMouseEvent<HTMLTableRowElement>) => void;
  onRowContextMenu?: (row: Row<T>, event: ReactMouseEvent<HTMLTableRowElement>) => void;
  onRowKeyDown?: (row: Row<T>, event: ReactKeyboardEvent<HTMLTableRowElement>) => void;
  rowAriaLabel?: (row: Row<T>) => string | undefined;
  rowAriaSelected?: (row: Row<T>) => boolean | undefined;
  rowClassName?: (row: Row<T>) => string | undefined;
  rowStyle?: (row: Row<T>) => CSSProperties | undefined;
  emptyContent?: ReactNode;
  className?: string;
  style?: CSSProperties;
  virtualize?: boolean;
  maxHeight?: number | string;
};

function SortIndicator({ sorted }: { sorted: false | "asc" | "desc" }) {
  const Icon = sorted === "asc"
    ? IconChevronUp
    : sorted === "desc"
      ? IconChevronDown
      : IconSelector;
  return <Icon aria-hidden size={14} opacity={sorted ? 1 : 0.45} />;
}

export function DataTableAdapter<T>({
  table,
  appearance = "grid",
  striped = true,
  rowHover = false,
  onRowClick,
  onRowDoubleClick,
  onRowContextMenu,
  onRowKeyDown,
  rowAriaLabel,
  rowAriaSelected,
  rowClassName,
  rowStyle,
  emptyContent,
  className,
  style,
  virtualize = false,
  maxHeight = "70vh",
}: DataTableAdapterProps<T>) {
  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowsAreInteractive = Boolean(
    onRowClick || onRowDoubleClick || onRowContextMenu || onRowKeyDown,
  );

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

  return (
    <div
      ref={scrollRef}
      className={className}
      style={{ ...style, maxHeight: virtualize ? maxHeight : style?.maxHeight }}
      data-slot="data-table-scroll"
    >
      <table
        className="data-table-adapter"
        data-appearance={appearance}
        data-striped={striped || undefined}
        data-row-hover={rowHover || undefined}
      >
        {/* 虚拟化时表头要粘住，但底色只有样式表知道该取哪块台面，这里只标记状态。 */}
        <thead data-sticky-header={virtualize ? "" : undefined}>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                const content = header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext());

                return (
                  <th
                    key={header.id}
                    colSpan={header.colSpan}
                    /* 让样式表能按列定位（例如把数值列右对齐），不必依赖 nth-child。 */
                    data-column-id={header.column.id}
                    aria-sort={
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : canSort
                            ? "none"
                            : undefined
                    }
                    style={header.column.columnDef.size ? { width: header.column.columnDef.size } : undefined}
                  >
                    {canSort ? (
                      <button
                        type="button"
                        className="data-table-adapter__sort"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <span className="data-table-adapter__sort-content">
                          {content}
                          <SortIndicator sorted={sorted} />
                        </span>
                      </button>
                    ) : (
                      content
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
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
                  <tr
                    key={row.id}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    onClick={onRowClick ? (event) => onRowClick(row, event) : undefined}
                    onDoubleClick={onRowDoubleClick ? (event) => onRowDoubleClick(row, event) : undefined}
                    onContextMenu={onRowContextMenu ? (event) => onRowContextMenu(row, event) : undefined}
                    onKeyDown={onRowKeyDown ? (event) => onRowKeyDown(row, event) : undefined}
                    tabIndex={rowsAreInteractive ? 0 : undefined}
                    aria-label={rowAriaLabel?.(row)}
                    aria-selected={rowAriaSelected?.(row)}
                    style={{
                      ...(onRowClick || onRowContextMenu ? { cursor: "pointer" } : {}),
                      ...rowStyle?.(row),
                    }}
                    className={rowClassName?.(row)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} data-column-id={cell.column.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
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
              <tr
                key={row.id}
                onClick={onRowClick ? (event) => onRowClick(row, event) : undefined}
                onDoubleClick={onRowDoubleClick ? (event) => onRowDoubleClick(row, event) : undefined}
                onContextMenu={onRowContextMenu ? (event) => onRowContextMenu(row, event) : undefined}
                onKeyDown={onRowKeyDown ? (event) => onRowKeyDown(row, event) : undefined}
                tabIndex={rowsAreInteractive ? 0 : undefined}
                aria-label={rowAriaLabel?.(row)}
                aria-selected={rowAriaSelected?.(row)}
                style={{
                  ...(onRowClick || onRowContextMenu ? { cursor: "pointer" } : {}),
                  ...rowStyle?.(row),
                }}
                className={rowClassName?.(row)}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} data-column-id={cell.column.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
