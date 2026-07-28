import { NumberInput } from "@mantine/core";
import type { NumberInputProps } from "@mantine/core";
import type { KeyboardEvent } from "react";

export type MetricGridInputProps = Omit<NumberInputProps, "withKeyboardEvents"> & {
  gridId: string;
  rowIndex: number;
  columnIndex: number;
  rowCount: number;
  columnCount: number;
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
    <NumberInput
      {...props}
      data-metric-grid={gridId}
      data-grid-row={rowIndex}
      data-grid-column={columnIndex}
      aria-keyshortcuts="Enter ArrowUp ArrowDown"
      withKeyboardEvents={false}
      onKeyDown={handleKeyDown}
    />
  );
}
