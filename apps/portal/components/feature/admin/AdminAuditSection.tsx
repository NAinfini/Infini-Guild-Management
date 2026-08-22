import { AUDIT_ENTITY_TYPES, type AdminRole, type AuditEvent, type AuditEntityType } from "@guild/shared";
import { Button, Group, Menu, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { ArrowDownIcon, SearchIcon, XIcon } from "@portal/components/icons";
import { ContentFilterToolbar } from "@portal/components/shared/ContentFilterToolbar";
import { NativeDateTimeInput } from "@portal/components/shared/NativeDateTimeInput";
import { matchAuditDatePreset, type AuditDatePreset } from "@portal/hooks/useAdminAuditFilter";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AuditLogViewer } from "./AuditLogViewer";
import { AuditArchiveExplorer } from "./AuditArchiveExplorer";

type AdminAuditSectionProps = {
  auditSearch: string;
  onAuditSearchChange: (value: string) => void;
  auditDateFrom: string;
  auditDateTo: string;
  onAuditDateFromChange: (value: string) => void;
  onAuditDateToChange: (value: string) => void;
  onSetDatePreset: (preset: AuditDatePreset) => void;
  onDownloadFilteredCsv: () => void;
  onDownloadFilteredJson: () => void;
  exportAuditLogPending: boolean;
  auditLoading: boolean;
  auditError: boolean;
  onRetryAudit: () => void;
  auditRows: AuditEvent[];
  auditHasMore: boolean;
  auditLoadingMore: boolean;
  onAuditLoadMore: () => void;
  auditEntityType: string;
  auditEntityId: string;
  onSelectAuditEntity: (entityType: string, entityId: string) => void;
  onClearAuditEntity: () => void;
  rolesData: AdminRole[];
  userMap?: Map<string, string>;
  archiveMonths: string[];
  archiveMonthsLoading: boolean;
  archiveMonthsError: boolean;
  onRetryArchiveMonths: () => void;
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
  onRetryAudit,
  auditRows,
  auditHasMore,
  auditLoadingMore,
  onAuditLoadMore,
  auditEntityType,
  auditEntityId,
  onSelectAuditEntity,
  onClearAuditEntity,
  rolesData,
  userMap,
  archiveMonths,
  archiveMonthsLoading,
  archiveMonthsError,
  onRetryArchiveMonths,
}: AdminAuditSectionProps) {
  const { t } = useTranslation("admin");
  // The dates remain the source of truth so the preset and manual inputs cannot drift apart.
  const [customRange, setCustomRange] = useState(false);
  const range = customRange
    ? "custom"
    : matchAuditDatePreset(auditDateFrom, auditDateTo) ?? "custom";

  const applyPreset = (value: string) => {
    if (value === "custom") {
      setCustomRange(true);
      return;
    }
    setCustomRange(false);
    onSetDatePreset(value as AuditDatePreset);
  };

  const hasEntityTimeline = Boolean(auditEntityType && auditEntityId);
  const hasSearch = auditSearch.trim().length > 0;
  const hasDismissibleFilters = hasSearch || hasEntityTimeline;
  const activeFilterCount = [
    hasSearch,
    hasEntityTimeline,
  ].filter(Boolean).length;
  const isKnownEntityType = (value: string): value is AuditEntityType => (
    AUDIT_ENTITY_TYPES.includes(value as AuditEntityType)
  );
  const timelineEntityType = isKnownEntityType(auditEntityType)
    ? t(`audit.entityType.${auditEntityType}`)
    : t("audit.filter.unknownEntity");
  const timelineEvent = hasEntityTimeline
    ? auditRows.find((row) => row.subject.type === auditEntityType && row.subject.id === auditEntityId)
    : undefined;
  const timelineLabel = timelineEvent?.subject.label && timelineEvent.subject.label !== auditEntityId
    ? timelineEvent.subject.label
    : timelineEntityType;
  return (
    <Stack gap={12} className="admin-fill audit-log-fill">
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

      {hasDismissibleFilters ? (
        <div className="admin-filter-summary">
          <Text size="xs" c="dimmed">{t("audit.filter.active")}</Text>
          {hasSearch ? (
            <button
              type="button"
              className="admin-filter-chip"
              onClick={() => onAuditSearchChange("")}
            >
              {t("audit.filter.searchChip", { value: auditSearch })}
              <XIcon size={12} />
            </button>
          ) : null}
          {hasEntityTimeline ? (
            <button type="button" className="admin-filter-chip" onClick={onClearAuditEntity}>
              <span>{t("audit.filter.entityTimeline", { entity: timelineLabel })}</span>
              <XIcon size={12} />
            </button>
          ) : null}
          <Text size="xs" c="dimmed">{t("audit.filter.loaded", { count: auditRows.length })}</Text>
        </div>
      ) : null}

      <AuditLogViewer
        auditLoading={auditLoading}
        auditError={auditError}
        onRetryAudit={onRetryAudit}
        auditRows={auditRows}
        auditHasMore={auditHasMore}
        auditLoadingMore={auditLoadingMore}
        onAuditLoadMore={onAuditLoadMore}
        onSelectEntityTimeline={onSelectAuditEntity}
        rolesData={rolesData}
        userMap={userMap}
      />

      <AuditArchiveExplorer
        months={archiveMonths}
        monthsLoading={archiveMonthsLoading}
        monthsError={archiveMonthsError}
        onRetryMonths={onRetryArchiveMonths}
      />
    </Stack>
  );
}
