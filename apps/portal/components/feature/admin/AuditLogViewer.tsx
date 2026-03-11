import type { AuditLogEntry } from "@guild/shared";
import { Alert, Group, Loader, Pagination, ScrollArea, Stack, Text } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { InfiniTable, getCoreRowModel, getSortedRowModel, useReactTable } from "@infini-dev-kit/frontend/components";
import type { ColumnDef, SortingState } from "@infini-dev-kit/frontend/components";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type AuditRow = AuditLogEntry;

type AuditLogViewerProps = {
  auditLoading: boolean;
  auditError: boolean;
  loadErrorMessage: string;
  auditRows: AuditRow[];
  auditPageCurrent: number;
  auditPageSize: number;
  auditTotal: number;
  onAuditPageChange: (nextPage: number) => void;
  isAdmin: boolean;
  maskIdentifier: (value: string, isAdmin: boolean) => string;
  formatAuditDiffHeader: (diffTitle: string | null, detailText: string | null) => string;
  formatDateTime: (iso: string | null) => string;
};

export function AuditLogViewer({
  auditLoading,
  auditError,
  loadErrorMessage,
  auditRows,
  auditPageCurrent,
  auditPageSize,
  auditTotal,
  onAuditPageChange,
  isAdmin,
  maskIdentifier,
  formatAuditDiffHeader,
  formatDateTime,
}: AuditLogViewerProps) {
  const { t } = useTranslation("admin");
  const totalPages = Math.max(1, Math.ceil(auditTotal / Math.max(1, auditPageSize)));
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo<ColumnDef<AuditRow, unknown>[]>(() => [
    {
      header: t("audit.table.entity"),
      id: "entity_type",
      accessorKey: "entity_type",
      size: 100,
    },
    {
      header: t("audit.table.action"),
      id: "action",
      accessorKey: "action",
      size: 100,
    },
    {
      header: t("audit.table.diff"),
      id: "diff",
      enableSorting: false,
      size: 280,
      cell: ({ row }) => (
        <Text size="sm" lineClamp={2} style={{ wordBreak: "break-word" }}>
          {formatAuditDiffHeader(row.original.diff_title, row.original.detail_text)}
        </Text>
      ),
    },
    {
      header: t("audit.table.actor"),
      id: "actor_id",
      accessorFn: (row) => String(row.actor_id ?? ""),
      size: 120,
      cell: ({ row }) => {
        const actorMasked = maskIdentifier(String(row.original.actor_id ?? ""), isAdmin);
        return <Text size="sm" truncate aria-label={`Audit actor ${actorMasked}`}>{actorMasked}</Text>;
      },
    },
    {
      header: t("audit.table.entityId"),
      id: "entity_id",
      accessorFn: (row) => String(row.entity_id ?? ""),
      size: 120,
      cell: ({ row }) => (
        <Text size="sm" truncate>{maskIdentifier(String(row.original.entity_id ?? ""), isAdmin)}</Text>
      ),
    },
    {
      header: t("audit.table.time"),
      id: "created_at",
      accessorKey: "created_at",
      size: 150,
      cell: ({ row }) => (
        <Text size="sm" style={{ whiteSpace: "nowrap" }}>{formatDateTime(row.original.created_at)}</Text>
      ),
    },
  ], [t, formatAuditDiffHeader, maskIdentifier, formatDateTime, isAdmin]);

  const table = useReactTable({
    data: auditRows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  });

  return (
    <Stack gap={12}>
      {auditLoading ? <Loader size="sm" /> : null}
      {auditError ? <Alert color="infini-warning" title={loadErrorMessage} /> : null}

      {!auditLoading && !auditError ? (
        <InfiniCard interactive={false}>
          <div style={{ padding: "1.2rem" }}>
            <ScrollArea type="auto">
              <InfiniTable table={table} highlightOnHover />
            </ScrollArea>
            <Group justify="flex-end" mt="sm">
              <Pagination value={auditPageCurrent} total={totalPages} onChange={onAuditPageChange} withEdges />
            </Group>
          </div>
        </InfiniCard>
      ) : null}
    </Stack>
  );
}
