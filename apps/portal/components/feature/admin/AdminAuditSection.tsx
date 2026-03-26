import type { AuditLogEntry } from "@guild/shared";
import { Button, Group, Stack, TextInput, Title } from "@mantine/core";
import { PortalCard } from "../../shared/PortalCard";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../../stores/auth";
import { formatAuditDiffHeader, formatDateTime, maskIdentifier } from "../../../utils/admin";
import { canManageRoles, canManageBot, canViewStatus } from "../../../utils/permissions";
import { AuditArchiveExplorer } from "./AuditArchiveExplorer";
import { AuditLogViewer } from "./AuditLogViewer";

type AuditRow = AuditLogEntry;

type AdminAuditSectionProps = {
  auditSearch: string;
  onAuditSearchChange: (value: string) => void;
  auditDateFrom: string;
  auditDateTo: string;
  onAuditDateFromChange: (value: string) => void;
  onAuditDateToChange: (value: string) => void;
  onSetDatePreset: (preset: "1d" | "7d" | "1m") => void;
  onDownloadFilteredCsv: () => void;
  onDownloadFilteredJson: () => void;
  exportAuditLogPending: boolean;
  auditLoading: boolean;
  auditError: boolean;
  auditRows: AuditRow[];
  auditPageCurrent: number;
  auditPageSize: number;
  auditTotal: number;
  onAuditPageChange: (nextPage: number) => void;
  showArchiveExplorer: boolean;
  archiveMonths: string[];
  archiveMonthsLoading: boolean;
  archiveMonthsError: boolean;
  selectedArchiveMonth: string | null;
  onArchiveMonthChange: (month: string) => void;
  archiveLoading: boolean;
  archiveError: boolean;
  archiveRows: AuditRow[];
  archivePageCurrent: number;
  archivePageSize: number;
  archiveTotal: number;
  onArchivePageChange: (nextPage: number) => void;
  rolesData: import("@guild/shared").AdminRole[];
};

export function AdminAuditSection({
  auditSearch,
  onAuditSearchChange,
  auditDateFrom,
  auditDateTo,
  onAuditDateFromChange,
  onAuditDateToChange,
  onSetDatePreset,
  onDownloadFilteredCsv,
  onDownloadFilteredJson,
  exportAuditLogPending,
  auditLoading,
  auditError,
  auditRows,
  auditPageCurrent,
  auditPageSize,
  auditTotal,
  onAuditPageChange,
  showArchiveExplorer,
  archiveMonths,
  archiveMonthsLoading,
  archiveMonthsError,
  selectedArchiveMonth,
  onArchiveMonthChange,
  archiveLoading,
  archiveError,
  archiveRows,
  archivePageCurrent,
  archivePageSize,
  archiveTotal,
  onArchivePageChange,
  rolesData,
}: AdminAuditSectionProps) {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const user = useAuthStore((state) => state.user);
  const isAdmin = Boolean(
    user &&
      (canManageRoles(rolesData, user.role) ||
        canManageBot(rolesData, user.role) ||
        canViewStatus(rolesData, user.role)),
  );
  const loadErrorMessage = tc("loadError");
  const heading = <Title order={3} style={{ margin: 0, fontSize: 16 }}>{t("tab.audit")}</Title>;

  return (
    <Stack gap={12}>
      {heading}
      <PortalCard interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Group wrap="wrap" gap={8}>
            <TextInput
              placeholder={t("audit.search")}
              style={{ width: 200 }}
              aria-label={t("audit.aria.search")}
              value={auditSearch}
              onChange={(event) => onAuditSearchChange(event.currentTarget.value)}
            />
            <TextInput
              type="date"
              value={auditDateFrom}
              onChange={(event) => onAuditDateFromChange(event.currentTarget.value)}
              aria-label={t("audit.aria.dateFrom")}
              style={{ width: 170 }}
            />
            <TextInput
              type="date"
              value={auditDateTo}
              onChange={(event) => onAuditDateToChange(event.currentTarget.value)}
              aria-label={t("audit.aria.dateTo")}
              style={{ width: 170 }}
            />
            <Button variant="default" size="compact-sm" onClick={() => onSetDatePreset("1d")}>{t("audit.lastDay")}</Button>
            <Button variant="default" size="compact-sm" onClick={() => onSetDatePreset("7d")}>{t("audit.last7Days")}</Button>
            <Button variant="default" size="compact-sm" onClick={() => onSetDatePreset("1m")}>{t("audit.lastMonth")}</Button>
            <Button
              variant="light"
              onClick={onDownloadFilteredCsv}
              loading={exportAuditLogPending}
            >
              {t("audit.downloadFilteredCsv")}
            </Button>
            <Button
              variant="light"
              onClick={onDownloadFilteredJson}
              loading={exportAuditLogPending}
            >
              {t("audit.downloadFilteredJson")}
            </Button>
          </Group>
        </div>
      </PortalCard>

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

      {showArchiveExplorer ? (
        <AuditArchiveExplorer
          months={archiveMonths}
          monthsLoading={archiveMonthsLoading}
          monthsError={archiveMonthsError}
          selectedMonth={selectedArchiveMonth}
          onSelectMonth={onArchiveMonthChange}
          archiveLoading={archiveLoading}
          archiveError={archiveError}
          archiveRows={archiveRows}
          archivePageCurrent={archivePageCurrent}
          archivePageSize={archivePageSize}
          archiveTotal={archiveTotal}
          onArchivePageChange={onArchivePageChange}
        />
      ) : null}
    </Stack>
  );
}
