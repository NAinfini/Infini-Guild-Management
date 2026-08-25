import { Input } from "@portal/components/ui/input";
import type { ComponentProps, KeyboardEvent } from "react";
import "./MetricGridInput.css";

export type MetricGridInputProps = Omit<
  ComponentProps<"input">,
  "type" | "size" | "value" | "defaultValue" | "onChange"
> & {
  gridId: string;
  rowIndex: number;
  columnIndex: number;
  rowCount: number;
  columnCount: number;
  value?: number | string;
  defaultValue?: number | string;
  onValueChange?: (value: number | null) => void;
};

function focusMetricCell(
  source: HTMLInputElement,
  gridId: string,
  rowIndex: number,
  columnIndex: number,
) {
  const target = Array.from(
    source.ownerDocument.querySelectorAll<HTMLInputElement>("input[data-metric-grid]"),
  ).find(
    (input) =>
      input.dataset.metricGrid === gridId
      && Number(input.dataset.gridRow) === rowIndex
      && Number(input.dataset.gridColumn) === columnIndex,
  );

  target?.focus();
  target?.select();
}

export function MetricGridInput({
  gridId,
  rowIndex,
  columnIndex,
  rowCount,
  columnCount,
  onKeyDown,
  onValueChange,
  className,
  ...props
}: MetricGridInputProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const nextColumn = (columnIndex + 1) % columnCount;
      const nextRow = nextColumn === 0 ? rowIndex + 1 : rowIndex;
      if (nextRow < rowCount) {
        focusMetricCell(event.currentTarget, gridId, nextRow, nextColumn);
      }
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const nextRow = rowIndex + (event.key === "ArrowDown" ? 1 : -1);
      if (nextRow >= 0 && nextRow < rowCount) {
        focusMetricCell(event.currentTarget, gridId, nextRow, columnIndex);
      }
    }
  };

  return (
    <Input
      {...props}
      type="number"
      className={["metric-grid-input", className].filter(Boolean).join(" ")}
      data-metric-grid={gridId}
      data-grid-row={rowIndex}
      data-grid-column={columnIndex}
      aria-keyshortcuts="Enter ArrowUp ArrowDown"
      onKeyDown={handleKeyDown}
      onChange={(event) => {
        const rawValue = event.currentTarget.value;
        onValueChange?.(rawValue === "" ? null : Number(rawValue));
      }}
    />
  );
}
