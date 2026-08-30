import { AUDIT_ENTITY_TYPES, type AdminRole, type AuditEntityType, type AuditEvent } from "@guild/shared";
import { ArrowDownIcon, SearchIcon, XIcon } from "@portal/components/icons";
import {
  ContentFilterGroup,
  ContentFilterOption,
  ContentFilterToolbar,
} from "@portal/components/shared/ContentFilterToolbar";
import { NativeDateTimeInput } from "@portal/components/shared/NativeDateTimeInput";
import { Button } from "@portal/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@portal/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@portal/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@portal/components/ui/radio-group";
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
  const matchedRange = matchAuditDatePreset(auditDateFrom, auditDateTo);
  const range = customRange
    ? "custom"
    : matchedRange ?? "custom";

  const applyPreset = (value: string) => {
    if (value === "custom") {
      setCustomRange(true);
      return;
    }
    setCustomRange(false);
    onSetDatePreset(value as AuditDatePreset);
  };

  const hasEntityTimeline = Boolean(auditEntityType && auditEntityId);
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
  const activeFilterCount = (matchedRange === "7d" ? 0 : 1) + (hasEntityTimeline ? 1 : 0);
  return (
    <div className="admin-fill audit-log-fill admin-audit-section">
      <ContentFilterToolbar
        className="admin-audit-toolbar"
        search={(
          <InputGroup className="admin-audit-toolbar__search">
            <InputGroupAddon>
              <SearchIcon size={14} aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder={t("audit.search")}
              aria-label={t("audit.aria.search")}
              value={auditSearch}
              onChange={(event) => onAuditSearchChange(event.currentTarget.value)}
            />
            {auditSearch ? (
              <InputGroupAddon align="inline-end">
                <InputGroupButton aria-label={t("common:action.clear")} onClick={() => onAuditSearchChange("")} size="icon-xs">
                  <XIcon size={14} aria-hidden="true" />
                </InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
        )}
        filterControls={(
          <>
            <ContentFilterGroup label={t("audit.filter.dateRange")}>
              <RadioGroup
                value={range}
                onValueChange={applyPreset}
                aria-label={t("audit.filter.dateRange")}
                className="content-filter-toolbar__option-list content-filter-toolbar__option-list--columns"
              >
                {([
                  { value: "1d", label: t("audit.lastDay") },
                  { value: "7d", label: t("audit.last7Days") },
                  { value: "1m", label: t("audit.lastMonth") },
                  { value: "custom", label: t("audit.range.custom") },
                ]).map((option) => (
                  <ContentFilterOption key={option.value}>
                    <RadioGroupItem value={option.value} />
                    <span>{option.label}</span>
                  </ContentFilterOption>
                ))}
              </RadioGroup>
            {range === "custom" ? (
              <div className="content-filter-toolbar__date-fields">
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
              </div>
            ) : null}
            </ContentFilterGroup>
          </>
        )}
        actions={(
          <DropdownMenu>
            <DropdownMenuTrigger render={(
              <Button
                size="sm"
                variant="outline"
                loading={exportAuditLogPending}
              />
            )}>
              <ArrowDownIcon size={14} data-icon="inline-start" />
              {t("audit.export")}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="admin-audit-export-menu">
              <DropdownMenuItem onClick={onDownloadFilteredCsv}>{t("audit.downloadFilteredCsv")}</DropdownMenuItem>
              <DropdownMenuItem onClick={onDownloadFilteredJson}>{t("audit.downloadFilteredJson")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        filterLabel={t("common:filter.toggle")}
        activeFilterCount={activeFilterCount}
        resetLabel={t("common:filter.reset")}
        onReset={() => {
          applyPreset("7d");
          onClearAuditEntity();
        }}
        filterActions={hasEntityTimeline ? (
          <Button type="button" size="sm" variant="ghost" onClick={onClearAuditEntity}>
            <XIcon size={12} aria-hidden="true" />
            {t("audit.filter.entityTimeline", { entity: timelineLabel })}
          </Button>
        ) : undefined}
      />

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
    </div>
  );
}
