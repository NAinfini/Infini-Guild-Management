import type { AuditLogEntry } from "@guild/shared";
import { Button, Group, Menu, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { ArrowDownIcon, SearchIcon, XIcon } from "@portal/components/icons";
import { ContentFilterToolbar } from "@portal/components/shared/ContentFilterToolbar";
import { NativeDateTimeInput } from "@portal/components/shared/NativeDateTimeInput";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../../stores/auth";
import { formatDateTime, maskIdentifier } from "../../../utils/admin";
import { canManageRoles, canViewStatus } from "../../../utils/permissions";
import { AuditLogViewer } from "./AuditLogViewer";
import { AuditArchiveExplorer } from "./AuditArchiveExplorer";

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
  rolesData: import("@guild/shared").AdminRole[];
  userMap?: Map<string, string>;
  archiveMonths: string[];
  archiveMonthsLoading: boolean;
  archiveMonthsError: boolean;
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
  rolesData,
  userMap,
  archiveMonths,
  archiveMonthsLoading,
  archiveMonthsError,
}: AdminAuditSectionProps) {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const user = useAuthStore((state) => state.user);
  const isAdmin = Boolean(
    user &&
      (canManageRoles(rolesData, user.role) ||
        canViewStatus(rolesData, user.role)),
  );
  const loadErrorMessage = tc("loadError");
  /* 无从得知当前这对日期是哪个预设产生的，所以默认如实显示成「自定义」，
     用户点了预设才切过去。 */
  const [range, setRange] = useState<"1d" | "7d" | "1m" | "custom">("custom");

  const applyPreset = (value: string) => {
    if (value === "custom") {
      setRange("custom");
      return;
    }
    const preset = value as "1d" | "7d" | "1m";
    setRange(preset);
    onSetDatePreset(preset);
  };

  const hasFilters = Boolean(auditSearch || auditDateFrom || auditDateTo);
  const activeFilterCount = [
    auditSearch.trim().length > 0,
    Boolean(auditDateFrom || auditDateTo),
  ].filter(Boolean).length;
  return (
    <Stack gap={12}>
      <ContentFilterToolbar
        className="admin-audit-toolbar"
        search={(
          <TextInput
            size="sm"
            leftSection={<SearchIcon size={14} />}
            placeholder={t("audit.search")}
            aria-label={t("audit.aria.search")}
            value={auditSearch}
            onChange={(event) => onAuditSearchChange(event.currentTarget.value)}
          />
        )}
        controls={(
          <>
            <SegmentedControl
              size="xs"
              value={range}
              onChange={applyPreset}
              data={[
                { value: "1d", label: t("audit.lastDay") },
                { value: "7d", label: t("audit.last7Days") },
                { value: "1m", label: t("audit.lastMonth") },
                { value: "custom", label: t("audit.range.custom") },
              ]}
            />
            {range === "custom" ? (
              <Group gap={6} wrap="nowrap" className="admin-audit-toolbar__dates">
                <NativeDateTimeInput
                  size="sm"
                  value={auditDateFrom}
                  onChange={(event) => onAuditDateFromChange(event.currentTarget.value)}
                  aria-label={t("audit.aria.dateFrom")}
                />
                <NativeDateTimeInput
                  size="sm"
                  value={auditDateTo}
                  onChange={(event) => onAuditDateToChange(event.currentTarget.value)}
                  aria-label={t("audit.aria.dateTo")}
                />
              </Group>
            ) : null}
          </>
        )}
        primary={(
          <Menu withinPortal position="bottom-end" shadow="md" width={180}>
            <Menu.Target>
              <Button
                size="sm"
                variant="default"
                loading={exportAuditLogPending}
                leftSection={<ArrowDownIcon size={14} />}
              >
                {t("audit.export")}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={onDownloadFilteredCsv}>{t("audit.downloadFilteredCsv")}</Menu.Item>
              <Menu.Item onClick={onDownloadFilteredJson}>{t("audit.downloadFilteredJson")}</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
        toggleLabel={t("common:filter.toggle")}
        activeFilterCount={activeFilterCount}
        collapseBelow={1120}
      />

      {hasFilters ? (
        <div className="admin-filter-summary">
          <Text size="xs" c="dimmed">{t("audit.filter.active")}</Text>
          {auditSearch ? (
            <button
              type="button"
              className="admin-filter-chip"
              onClick={() => onAuditSearchChange("")}
            >
              {t("audit.filter.searchChip", { value: auditSearch })}
              <XIcon size={12} />
            </button>
          ) : null}
          {auditDateFrom || auditDateTo ? (
            <button
              type="button"
              className="admin-filter-chip"
              onClick={() => {
                onAuditDateFromChange("");
                onAuditDateToChange("");
                setRange("custom");
              }}
            >
              {t("audit.filter.dateRange", {
                from: auditDateFrom || "…",
                to: auditDateTo || "…",
              })}
              <XIcon size={12} />
            </button>
          ) : null}
          <Text size="xs" c="dimmed">{t("audit.filter.total", { total: auditTotal })}</Text>
        </div>
      ) : null}

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
        formatDateTime={formatDateTime}
        userMap={userMap}
      />

      <AuditArchiveExplorer
        months={archiveMonths}
        monthsLoading={archiveMonthsLoading}
        monthsError={archiveMonthsError}
      />
    </Stack>
  );
}
