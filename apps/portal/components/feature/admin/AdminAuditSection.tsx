import { Button, Group, Stack, TextInput } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import type { ReactNode } from "react";
import type { fetchAdminAuditLog } from "../../../api/queries/admin";
import { AuditLogViewer } from "./AuditLogViewer";

type AuditRow = Awaited<ReturnType<typeof fetchAdminAuditLog>>["data"][number];

type AdminAuditSectionProps = {
  heading: ReactNode;
  auditSearch: string;
  onAuditSearchChange: (value: string) => void;
  auditDateFrom: string;
  auditDateTo: string;
  onAuditDateFromChange: (value: string) => void;
  onAuditDateToChange: (value: string) => void;
  onResetDateRange: () => void;
  onApplyFilters: () => void;
  onDownloadFilteredCsv: () => void;
  onDownloadFilteredJson: () => void;
  searchPlaceholder: string;
  last90DaysLabel: string;
  applyLabel: string;
  downloadFilteredCsvLabel: string;
  downloadFilteredJsonLabel: string;
  exportAuditLogPending: boolean;
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

export function AdminAuditSection({
  heading,
  auditSearch,
  onAuditSearchChange,
  auditDateFrom,
  auditDateTo,
  onAuditDateFromChange,
  onAuditDateToChange,
  onResetDateRange,
  onApplyFilters,
  onDownloadFilteredCsv,
  onDownloadFilteredJson,
  searchPlaceholder,
  last90DaysLabel,
  applyLabel,
  downloadFilteredCsvLabel,
  downloadFilteredJsonLabel,
  exportAuditLogPending,
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
}: AdminAuditSectionProps) {
  return (
    <Stack gap={12}>
      {heading}
      <InfiniCard>
        <Group wrap="wrap" gap={8}>
          <TextInput
            placeholder={searchPlaceholder}
            style={{ width: 320 }}
            aria-label="Search audit logs"
            value={auditSearch}
            onChange={(event) => onAuditSearchChange(event.currentTarget.value)}
          />
          <TextInput
            type="date"
            value={auditDateFrom}
            onChange={(event) => onAuditDateFromChange(event.currentTarget.value)}
            aria-label="Audit date from"
            style={{ width: 170 }}
          />
          <TextInput
            type="date"
            value={auditDateTo}
            onChange={(event) => onAuditDateToChange(event.currentTarget.value)}
            aria-label="Audit date to"
            style={{ width: 170 }}
          />
          <Button onClick={onResetDateRange}>{last90DaysLabel}</Button>
          <Button onClick={onApplyFilters}>{applyLabel}</Button>
          <Button
            variant="light"
            onClick={onDownloadFilteredCsv}
            loading={exportAuditLogPending}
          >
            {downloadFilteredCsvLabel}
          </Button>
          <Button
            variant="light"
            onClick={onDownloadFilteredJson}
            loading={exportAuditLogPending}
          >
            {downloadFilteredJsonLabel}
          </Button>
        </Group>
      </InfiniCard>

      <AuditLogViewer
        auditLoading={auditLoading}
        auditError={auditError}
        loadErrorMessage={loadErrorMessage}
        auditRows={auditRows}
        auditPageCurrent={auditPageCurrent}
        auditPageSize={auditPageSize}
        auditTotal={auditTotal}
        onAuditPageChange={onAuditPageChange}
        isAdmin={isAdmin}
        maskIdentifier={maskIdentifier}
        formatAuditDiffHeader={formatAuditDiffHeader}
        formatDateTime={formatDateTime}
        archiveTitle={archiveTitle}
        auditMonthsLoading={auditMonthsLoading}
        auditMonths={auditMonths}
        selectedArchiveMonth={selectedArchiveMonth}
        onSelectedArchiveMonthChange={onSelectedArchiveMonthChange}
        archiveCountLabel={archiveCountLabel}
        archiveCsvTooLarge={archiveCsvTooLarge}
        archiveTooLargeMessage={archiveTooLargeMessage}
        onDownloadCsv={onDownloadCsv}
        canExportArchive={canExportArchive}
        exportCooldownSeconds={exportCooldownSeconds}
        downloadCsvLabel={downloadCsvLabel}
      />
    </Stack>
  );
}

