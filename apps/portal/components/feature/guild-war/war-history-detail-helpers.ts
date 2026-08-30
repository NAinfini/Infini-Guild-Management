import type { DataTableInstance } from "@portal/components/shared/data-table-features";
import type { HistoryMemberStat } from "@portal/types/guild-war";

export function getWarHistoryChartMetricOptions(
  detailTable: DataTableInstance<HistoryMemberStat>,
) {
  return detailTable
    .getAllLeafColumns()
    .filter((column) => !["user_id", "role_tag", "missing"].includes(column.id))
    .map((column) => ({
      value: column.id,
      label: String(column.columnDef.header ?? column.id),
    }));
}
