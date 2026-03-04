import { Alert, Button, Group, Loader, Select, Stack, Table, Text } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { InfiniMotionPagination } from "@infini-dev-kit/frontend/components";
import type { fetchAdminAuditLog } from "../../../api/queries/admin";

type AuditRow = Awaited<ReturnType<typeof fetchAdminAuditLog>>["data"][number];

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
  archiveTitle: string;
  auditMonthsLoading: boolean;
  auditMonths: string[];
  selectedArchiveMonth: string | undefined;
  onSelectedArchiveMonthChange: (value: string | undefined) => void;
  archiveCountLabel: string;
  archiveCsvTooLarge: boolean;
  archiveTooLargeMessage: string;
  onDownloadCsv: () => void;
  canExportArchive: boolean;
  exportCooldownSeconds: number;
  downloadCsvLabel: string;
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
  archiveTitle,
  auditMonthsLoading,
  auditMonths,
  selectedArchiveMonth,
  onSelectedArchiveMonthChange,
  archiveCountLabel,
  archiveCsvTooLarge,
  archiveTooLargeMessage,
  onDownloadCsv,
  canExportArchive,
  exportCooldownSeconds,
  downloadCsvLabel,
}: AuditLogViewerProps) {
  const totalPages = Math.max(1, Math.ceil(auditTotal / Math.max(1, auditPageSize)));

  return (
    <Stack gap={12}>
      {auditLoading ? <Loader size="sm" /> : null}
      {auditError ? <Alert color="yellow" title={loadErrorMessage} /> : null}

      {!auditLoading && !auditError ? (
        <InfiniCard>
          <div style={{ padding: "1.2rem" }}>
            <Table withTableBorder withColumnBorders striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Entity</Table.Th>
                  <Table.Th>Action</Table.Th>
                  <Table.Th>Diff</Table.Th>
                  <Table.Th>Actor</Table.Th>
                  <Table.Th>Entity ID</Table.Th>
                  <Table.Th>Time</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {auditRows.map((row) => {
                  const actorMasked = maskIdentifier(String(row.actor_id ?? ""), isAdmin);
                  return (
                    <Table.Tr key={row.id}>
                      <Table.Td>{row.entity_type}</Table.Td>
                      <Table.Td>{row.action}</Table.Td>
                      <Table.Td>
                        <Text size="sm">{formatAuditDiffHeader(row.diff_title, row.detail_text)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" aria-label={`Audit actor ${actorMasked}`}>{actorMasked}</Text>
                      </Table.Td>
                      <Table.Td>{maskIdentifier(String(row.entity_id ?? ""), isAdmin)}</Table.Td>
                      <Table.Td>{formatDateTime(row.created_at)}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
            <Group justify="flex-end" mt="sm">
              <InfiniMotionPagination page={auditPageCurrent} total={totalPages} onChange={onAuditPageChange} />
            </Group>
          </div>
        </InfiniCard>
      ) : null}

      {isAdmin ? (
        <InfiniCard>
          <div style={{ padding: "1.2rem" }}>
            <Text fw={600} size="sm" mb={8}>{archiveTitle}</Text>
            {auditMonthsLoading ? <Loader size="sm" /> : null}
            {auditMonths.length > 0 ? (
              <Stack gap={8}>
                <Select
                  style={{ width: 220 }}
                  value={selectedArchiveMonth ?? null}
                  aria-label="Select archive month"
                  data={auditMonths.map((month) => ({
                    value: month,
                    label: month,
                  }))}
                  onChange={(value) => onSelectedArchiveMonthChange(value ?? undefined)}
                />
                <Text c="dimmed" size="sm">{archiveCountLabel}</Text>
                {archiveCsvTooLarge ? <Text c="yellow" size="sm">{archiveTooLargeMessage}</Text> : null}
                <Button onClick={onDownloadCsv} disabled={!canExportArchive}>
                  {exportCooldownSeconds > 0 ? `${downloadCsvLabel} (${exportCooldownSeconds}s)` : downloadCsvLabel}
                </Button>
              </Stack>
            ) : null}
          </div>
        </InfiniCard>
      ) : null}
    </Stack>
  );
}

