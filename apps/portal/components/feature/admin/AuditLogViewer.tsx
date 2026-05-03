import type { AuditLogEntry } from "@guild/shared";
import { Alert, Group, Pagination, ScrollArea, Skeleton, Stack, Text } from "@mantine/core";
import { PortalCard } from "../../shared/PortalCard";
import { InfiniTable, getCoreRowModel, getSortedRowModel, useReactTable } from "@portal/components/shared/InfiniTable";
import type { ColumnDef, SortingState } from "@portal/components/shared/InfiniTable";
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
  userMap?: Map<string, string>;
};

function formatEntityId(
  entityId: string,
  entityType: string,
  userMap?: Map<string, string>,
): string {
  if (entityType === "event_participant") {
    const [eventId, userId] = entityId.split(":");
    const userName = userId ? userMap?.get(userId) : undefined;
    if (userName) return userName;
    if (eventId && userId) {
      return `${eventId.slice(0, 6)}…:${userId.slice(0, 6)}…`;
    }
  }
  if (userMap?.has(entityId)) {
    return userMap.get(entityId)!;
  }
  if (entityId.length > 12) {
    return `${entityId.slice(0, 8)}…`;
  }
  return entityId;
}

function formatDiffText(
  diffTitle: string | null,
  detailText: string | null,
  formatAuditDiffHeader: (d: string | null, t: string | null) => string,
  userMap?: Map<string, string>,
): string {
  const raw = formatAuditDiffHeader(diffTitle, detailText);
  if (!userMap || raw === "-") return raw;
  return raw.replace(
    /(?:user_id|actor_id):\s*([0-9a-f]{8}-[0-9a-f-]{27,})/gi,
    (_match, id: string) => {
      const name = userMap.get(id);
      return name ? `用户: ${name}` : `用户: ${id.slice(0, 8)}…`;
    },
  ).replace(
    /(?:event_id):\s*([A-Za-z0-9_-]{16,})/g,
    (_match, id: string) => `活动: ${id.slice(0, 8)}…`,
  );
}

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
  userMap,
}: AuditLogViewerProps) {
  const { t } = useTranslation("admin");
  const totalPages = Math.max(1, Math.ceil(auditTotal / Math.max(1, auditPageSize)));
  const [sorting, setSorting] = useState<SortingState>([]);

  const resolveEntityType = (raw: string) =>
    t(`audit.entityType.${raw}`, { defaultValue: raw });

  const resolveAction = (raw: string) =>
    t(`audit.action.${raw}`, { defaultValue: raw });

  const resolveActor = (actorId: string) => {
    if (userMap?.has(actorId)) return userMap.get(actorId)!;
    return maskIdentifier(actorId, isAdmin);
  };

  const columns = useMemo<ColumnDef<AuditRow, unknown>[]>(() => [
    {
      header: t("audit.table.entity"),
      id: "entity_type",
      accessorKey: "entity_type",
      size: 90,
      cell: ({ row }) => (
        <Text size="sm" fw={500}>{resolveEntityType(row.original.entity_type)}</Text>
      ),
    },
    {
      header: t("audit.table.action"),
      id: "action",
      accessorKey: "action",
      size: 100,
      cell: ({ row }) => (
        <Text size="sm">{resolveAction(row.original.action)}</Text>
      ),
    },
    {
      header: t("audit.table.diff"),
      id: "diff",
      enableSorting: false,
      size: 280,
      cell: ({ row }) => (
        <Text size="sm" lineClamp={2} style={{ wordBreak: "break-word" }}>
          {formatDiffText(row.original.diff_title, row.original.detail_text, formatAuditDiffHeader, userMap)}
        </Text>
      ),
    },
    {
      header: t("audit.table.actor"),
      id: "actor_id",
      accessorFn: (row) => String(row.actor_id ?? ""),
      size: 120,
      cell: ({ row }) => {
        const display = resolveActor(String(row.original.actor_id ?? ""));
        return <Text size="sm" truncate>{display}</Text>;
      },
    },
    {
      header: t("audit.table.entityId"),
      id: "entity_id",
      accessorFn: (row) => String(row.entity_id ?? ""),
      size: 120,
      cell: ({ row }) => (
        <Text size="sm" truncate>
          {formatEntityId(String(row.original.entity_id ?? ""), row.original.entity_type, userMap)}
        </Text>
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
  ], [t, formatAuditDiffHeader, maskIdentifier, formatDateTime, isAdmin, userMap]);

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
      {auditLoading ? <Stack gap={8}>{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={18} />)}</Stack> : null}
      {auditError ? <Alert color="yellow" title={loadErrorMessage} /> : null}

      {!auditLoading && !auditError ? (
        <PortalCard interactive={false}>
          <div style={{ padding: "1.2rem" }}>
            <ScrollArea type="auto">
              <InfiniTable table={table} highlightOnHover />
            </ScrollArea>
            <Group justify="flex-end" mt="sm">
              <Pagination value={auditPageCurrent} total={totalPages} onChange={onAuditPageChange} withEdges />
            </Group>
          </div>
        </PortalCard>
      ) : null}
    </Stack>
  );
}
