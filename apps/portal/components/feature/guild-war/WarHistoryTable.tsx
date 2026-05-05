import { ActionIcon, Badge, Button, Group, HoverCard, Select, Skeleton, Stack, Text, TextInput, ThemeIcon, Alert } from "@mantine/core";
import { IconCalendarOff } from "@tabler/icons-react";
import { InfiniTable, useReactTable } from "@portal/components/shared/InfiniTable";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";
import { PortalCard } from "../../shared/PortalCard";
import type { HistorySummaryRow } from "./WarHistoryTab";

type WarHistoryTableProps = {
  historyDateFrom: string;
  historyDateTo: string;
  onHistoryDateFromChange: (value: string) => void;
  onHistoryDateToChange: (value: string) => void;
  onClearDates: () => void;
  historySearch: string;
  onHistorySearchChange: (value: string) => void;
  historyLoading: boolean;
  historyError: boolean;
  loadErrorMessage: string;
  filteredHistoryRows: HistorySummaryRow[];
  historyRows: HistorySummaryRow[];
  canManage: boolean;
  selectedHistoryIds: Set<string>;
  summaryTable: ReturnType<typeof useReactTable<HistorySummaryRow>>;
  highlightRowId: string | null;
  onRowClick: (id: string) => void;
  historyTotalPages: number;
  historyPage: number;
  historyPerPage: number;
  onHistoryPageChange: (page: number) => void;
  onHistoryPerPageChange: (perPage: number) => void;
  bulkDeleteHistoryPending: boolean;
  onBulkDelete: () => void;
};

function resolveResultTagColor(result: string | null | undefined): string {
  const normalized = (result ?? "").toLowerCase();
  if (normalized.includes("win") || normalized.includes("胜")) return "green";
  if (normalized.includes("loss") || normalized.includes("lose") || normalized.includes("负")) return "red";
  if (normalized.includes("draw") || normalized.includes("平")) return "blue";
  return "gray";
}

export function WarHistoryTable({
  historyDateFrom,
  historyDateTo,
  onHistoryDateFromChange,
  onHistoryDateToChange,
  onClearDates,
  historySearch,
  onHistorySearchChange,
  historyLoading,
  historyError,
  loadErrorMessage,
  filteredHistoryRows,
  historyRows,
  canManage,
  selectedHistoryIds,
  summaryTable,
  highlightRowId,
  onRowClick,
  historyTotalPages,
  historyPage,
  historyPerPage,
  onHistoryPageChange,
  onHistoryPerPageChange,
  bulkDeleteHistoryPending,
  onBulkDelete,
}: WarHistoryTableProps) {
  const { t } = useTranslation("guild-war");

  return (
    <>
      <div className="war-history-filters">
        <div className="war-history-filters__group">
          <TextInput
            value={historySearch}
            onChange={(event) => onHistorySearchChange(String(event.currentTarget.value ?? ""))}
            placeholder={t("history.search.placeholder")}
            aria-label={t("history.aria.search")}
            style={{ width: 240 }}
          />
          <TextInput
            type="date"
            value={historyDateFrom}
            onChange={(event) => onHistoryDateFromChange(event.currentTarget.value)}
            placeholder={t("history.datePlaceholder")}
            aria-label={t("history.aria.dateFrom")}
            style={{ width: 170 }}
          />
          <TextInput
            type="date"
            value={historyDateTo}
            onChange={(event) => onHistoryDateToChange(event.currentTarget.value)}
            placeholder={t("history.datePlaceholder")}
            aria-label={t("history.aria.dateTo")}
            style={{ width: 170 }}
          />
          <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
            <HoverCard.Target>
              <ActionIcon variant="subtle" onClick={onClearDates} disabled={!historyDateFrom && !historyDateTo} aria-label={t("history.aria.clearDates")}>
                <IconCalendarOff size={18} />
              </ActionIcon>
            </HoverCard.Target>
            <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
              <Group gap={10} wrap="nowrap" align="flex-start">
                <ThemeIcon variant="light" color="orange" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                  <IconCalendarOff size={16} />
                </ThemeIcon>
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" fw={700} lh={1.3}>{t("hovercard.clearDates.title")}</Text>
                  <Text size="xs" c="dimmed" lh={1.5}>{t("hovercard.clearDates.desc")}</Text>
                </div>
              </Group>
            </HoverCard.Dropdown>
          </HoverCard>
        </div>
      </div>

      {historyLoading ? <Stack gap={8}>{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={18} />)}</Stack> : null}
      {historyError ? <Alert color="yellow">{loadErrorMessage}</Alert> : null}

      {!historyLoading && !historyError ? (
        <PortalCard interactive={false} className="war-history-list-card">
          <div style={{ padding: "1.2rem" }}>
            <Stack gap={8}>
              <Group justify="space-between">
                <Group gap={8}>
                  <Text fw={600}>{t("history.warList")}</Text>
                  {canManage && selectedHistoryIds.size > 0 ? (
                    <Button
                      size="xs"
                      color="red"
                      variant="default"
                      onClick={onBulkDelete}
                      loading={bulkDeleteHistoryPending}
                    >
                      {t("history.deleteSelected", { count: selectedHistoryIds.size })}
                    </Button>
                  ) : null}
                </Group>
                <Group gap={8}>
                  <Badge color="blue">{filteredHistoryRows.length} / {historyRows.length}</Badge>
                </Group>
              </Group>
              <div className="war-history-list-table-wrap">
                {filteredHistoryRows.length > 0 ? (
                  <InfiniTable
                    table={summaryTable}
                    onRowClick={(row) => onRowClick(row.original.id)}
                    rowClassName={(row) => {
                      const classes: string[] = [];
                      if (highlightRowId === row.original.id) classes.push("war-history-row-highlight");
                      if (selectedHistoryIds.has(row.original.id)) classes.push("war-history-row-selected");
                      return classes.length > 0 ? classes.join(" ") : undefined;
                    }}
                    rowStyle={(row) => {
                      const result = row.original.result;
                      const color = resolveResultTagColor(result);
                      if (color === "green") return { backgroundColor: "color-mix(in srgb, var(--mantine-color-green-light, #dcfce7) 35%, transparent)" };
                      if (color === "red") return { backgroundColor: "color-mix(in srgb, var(--mantine-color-red-light, #fee2e2) 35%, transparent)" };
                      if (color === "blue") return { backgroundColor: "color-mix(in srgb, var(--mantine-color-blue-light, #dbeafe) 35%, transparent)" };
                      return undefined;
                    }}
                  />
                ) : (
                  <div className="war-history-list-empty">
                    <EmptyState title={t("history.noWarHistories")} />
                  </div>
                )}
              </div>
              {historyTotalPages > 1 ? (
                <Group justify="space-between" align="center">
                  <Group gap={8} align="center">
                    <Text size="sm">{t("history.perPage")}</Text>
                    <Select
                      size="xs"
                      data={[
                        { value: "10", label: "10" },
                        { value: "20", label: "20" },
                        { value: "50", label: "50" },
                      ]}
                      value={String(historyPerPage)}
                      onChange={(val) => { if (val) onHistoryPerPageChange(Number(val)); }}
                      style={{ width: 72 }}
                      allowDeselect={false}
                    />
                  </Group>
                  <Group gap={4} align="center">
                    <Button
                      size="xs"
                      variant="default"
                      disabled={historyPage <= 1}
                      onClick={() => onHistoryPageChange(historyPage - 1)}
                    >
                      &lt;
                    </Button>
                    <Text size="sm">
                      {t("history.page")} {historyPage} / {historyTotalPages}
                    </Text>
                    <Button
                      size="xs"
                      variant="default"
                      disabled={historyPage >= historyTotalPages}
                      onClick={() => onHistoryPageChange(historyPage + 1)}
                    >
                      &gt;
                    </Button>
                  </Group>
                </Group>
              ) : null}
            </Stack>
          </div>
        </PortalCard>
      ) : null}
    </>
  );
}
