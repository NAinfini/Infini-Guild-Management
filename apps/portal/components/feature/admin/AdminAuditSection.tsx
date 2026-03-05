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
  onSetDatePreset: (preset: "1d" | "7d" | "1m") => void;
  onDownloadFilteredCsv: () => void;
  onDownloadFilteredJson: () => void;
  searchPlaceholder: string;
  lastDayLabel: string;
  last7DaysLabel: string;
  lastMonthLabel: string;
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
};

export function AdminAuditSection({
  heading,
  auditSearch,
  onAuditSearchChange,
  auditDateFrom,
  auditDateTo,
  onAuditDateFromChange,
  onAuditDateToChange,
  onSetDatePreset,
  onDownloadFilteredCsv,
  onDownloadFilteredJson,
  searchPlaceholder,
  lastDayLabel,
  last7DaysLabel,
  lastMonthLabel,
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
}: AdminAuditSectionProps) {
  return (
    <Stack gap={12}>
      {heading}
      <InfiniCard interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Group wrap="wrap" gap={8}>
            <TextInput
              placeholder={searchPlaceholder}
              style={{ width: 200 }}
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
            <Button variant="default" size="compact-sm" onClick={() => onSetDatePreset("1d")}>{lastDayLabel}</Button>
            <Button variant="default" size="compact-sm" onClick={() => onSetDatePreset("7d")}>{last7DaysLabel}</Button>
            <Button variant="default" size="compact-sm" onClick={() => onSetDatePreset("1m")}>{lastMonthLabel}</Button>
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
        </div>
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
      />
    </Stack>
  );
}

