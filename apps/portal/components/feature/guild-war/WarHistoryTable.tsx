import { ActionIcon, Alert, Badge, Group, HoverCard, NumberInput, Paper, Select, Skeleton, Stack, Text, TextInput, ThemeIcon, UnstyledButton } from "@mantine/core";
import { CalendarOffIcon } from "@portal/components/icons";
import { NativeDateTimeInput } from "@portal/components/shared/NativeDateTimeInput";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { resolveResultTagColor } from "@portal/utils/guild-war";
import type { HistorySummaryRow } from "@portal/types/guild-war";
import { EmptyState } from "../../shared/EmptyState";

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
  historyTotal: number;
  activeHistoryId: string | null;
  highlightRowId: string | null;
  onRowClick: (id: string) => void;
  historyTotalPages: number;
  historyPage: number;
  historyPerPage: number;
  onHistoryPageChange: (page: number) => void;
  onHistoryPerPageChange: (perPage: number) => void;
};

function formatHistorySummaryDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : format(date, "yyyy-MM-dd HH:mm");
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
  historyTotal,
  activeHistoryId,
  highlightRowId,
  onRowClick,
  historyTotalPages,
  historyPage,
  historyPerPage,
  onHistoryPageChange,
  onHistoryPerPageChange,
}: WarHistoryTableProps) {
  const { t } = useTranslation("guild-war");

  return (
    <>
      <div className="war-history-filters">
        <div className="war-history-filters__group">
          <TextInput
            className="war-history-filter war-history-filter--search"
            value={historySearch}
            onChange={(event) => onHistorySearchChange(String(event.currentTarget.value ?? ""))}
            placeholder={t("history.search.placeholder")}
            aria-label={t("history.aria.search")}
          />
          <NativeDateTimeInput
            className="war-history-filter war-history-filter--date"
            value={historyDateFrom}
            onChange={(event) => onHistoryDateFromChange(event.currentTarget.value)}
            placeholder={t("history.datePlaceholder")}
            aria-label={t("history.aria.dateFrom")}
          />
          <NativeDateTimeInput
            className="war-history-filter war-history-filter--date"
            value={historyDateTo}
            onChange={(event) => onHistoryDateToChange(event.currentTarget.value)}
            placeholder={t("history.datePlaceholder")}
            aria-label={t("history.aria.dateTo")}
          />
          <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
            <HoverCard.Target>
              <ActionIcon className="war-history-filter__clear" variant="subtle" onClick={onClearDates} disabled={!historyDateFrom && !historyDateTo} aria-label={t("history.aria.clearDates")}>
                <CalendarOffIcon size={18} />
              </ActionIcon>
            </HoverCard.Target>
            <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
              <Group gap={10} wrap="nowrap" align="flex-start">
                <ThemeIcon variant="light" color="gray" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                  <CalendarOffIcon size={16} />
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

      {historyLoading ? <Stack gap={8}>{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={56} radius="md" />)}</Stack> : null}
      {historyError ? <Alert color="red">{loadErrorMessage}</Alert> : null}

      {!historyLoading && !historyError ? (
        <Paper withBorder radius="md" p="var(--card-padding)" className="war-history-list-card">
          <Stack gap={8}>
            <Group justify="space-between" className="war-history-list-card__header">
              <Text fw={600}>{t("history.warList")}</Text>
              <Badge color="gray">{historyRows.length} / {historyTotal}</Badge>
            </Group>

            {filteredHistoryRows.length > 0 ? (
              <div
                className="war-history-rail"
                role="list"
                aria-label={t("history.warList")}
              >
                {filteredHistoryRows.map((item) => {
                  const isActive = activeHistoryId === item.id;
                  const itemClasses = [
                    "war-history-rail-item",
                    isActive ? "war-history-rail-item--active" : undefined,
                    highlightRowId === item.id ? "war-history-rail-item--highlight" : undefined,
                  ].filter(Boolean).join(" ");

                  return (
                    <article
                      key={item.id}
                      role="listitem"
                      className={itemClasses}
                      data-result={item.result ?? "unknown"}
                    >
                      <span className="war-history-rail-item__stripe" aria-hidden="true" />
                      <UnstyledButton
                        className="war-history-rail-item__open"
                        onClick={() => onRowClick(item.id)}
                        aria-current={isActive ? "true" : undefined}
                        aria-label={t("history.aria.openRecord", {
                          name: item.war_name,
                        })}
                      >
                        <span className="war-history-rail-item__body">
                          <span className="war-history-rail-item__name">{item.war_name}</span>
                          <span className="war-history-rail-item__enemy">
                            {item.enemy_name
                              ? `${t("history.versus")} ${item.enemy_name}`
                              : t("history.compare.enemy")}
                          </span>
                        </span>
                        <span className="war-history-rail-item__aside">
                          <span className="war-history-rail-item__result">
                            <Badge
                              size="sm"
                              color={resolveResultTagColor(item.result)}
                              variant="light"
                            >
                              {item.result ?? t("history.unknownResult")}
                            </Badge>
                            <span className="war-history-rail-item__score tabular-nums">
                              {item.own_stats?.kills ?? 0} / {item.enemy_stats?.kills ?? 0}
                            </span>
                          </span>
                          <time
                            className="war-history-rail-item__date tabular-nums"
                            dateTime={item.created_at}
                          >
                            {formatHistorySummaryDate(item.created_at)}
                          </time>
                        </span>
                      </UnstyledButton>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="war-history-list-empty">
                <EmptyState title={t("history.noWarHistories")} />
              </div>
            )}

            {historyTotalPages > 1 ? (
              <Group justify="space-between" align="center" className="war-history-pagination">
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
                <Group gap={4} align="center" className="war-history-pagination__pages">
                  <ActionIcon
                    size="sm"
                    variant="default"
                    disabled={historyPage <= 1}
                    onClick={() => onHistoryPageChange(1)}
                    aria-label={t("history.aria.firstPage")}
                  >
                    «
                  </ActionIcon>
                  <ActionIcon
                    size="sm"
                    variant="default"
                    disabled={historyPage <= 1}
                    onClick={() => onHistoryPageChange(historyPage - 1)}
                    aria-label={t("history.aria.previousPage")}
                  >
                    ‹
                  </ActionIcon>
                  {(() => {
                    const pages: (number | "ellipsis-left" | "ellipsis-right")[] = [];
                    const start = Math.max(2, historyPage - 1);
                    const end = Math.min(historyTotalPages - 1, historyPage + 1);
                    pages.push(1);
                    if (start > 2) pages.push("ellipsis-left");
                    for (let i = start; i <= end; i++) pages.push(i);
                    if (end < historyTotalPages - 1) pages.push("ellipsis-right");
                    if (historyTotalPages > 1) pages.push(historyTotalPages);
                    return pages.map((item) => {
                      if (item === "ellipsis-left" || item === "ellipsis-right") {
                        return <Text key={item} size="sm" c="dimmed" px={2}>…</Text>;
                      }
                      return (
                        <ActionIcon
                          key={item}
                          size="sm"
                          variant={item === historyPage ? "filled" : "default"}
                          onClick={() => onHistoryPageChange(item)}
                          aria-label={t("history.aria.page", { page: item })}
                          aria-current={item === historyPage ? "page" : undefined}
                        >
                          {item}
                        </ActionIcon>
                      );
                    });
                  })()}
                  <ActionIcon
                    size="sm"
                    variant="default"
                    disabled={historyPage >= historyTotalPages}
                    onClick={() => onHistoryPageChange(historyPage + 1)}
                    aria-label={t("history.aria.nextPage")}
                  >
                    ›
                  </ActionIcon>
                  <ActionIcon
                    size="sm"
                    variant="default"
                    disabled={historyPage >= historyTotalPages}
                    onClick={() => onHistoryPageChange(historyTotalPages)}
                    aria-label={t("history.aria.lastPage")}
                  >
                    »
                  </ActionIcon>
                  <NumberInput
                    size="xs"
                    min={1}
                    max={historyTotalPages}
                    value={historyPage}
                    onChange={(val) => {
                      if (typeof val === "number" && val >= 1 && val <= historyTotalPages) {
                        onHistoryPageChange(val);
                      }
                    }}
                    hideControls
                    style={{ width: 56 }}
                    styles={{ input: { textAlign: "center" } }}
                  />
                  <Text size="sm" c="dimmed">/ {historyTotalPages}</Text>
                </Group>
              </Group>
            ) : null}
          </Stack>
        </Paper>
      ) : null}
    </>
  );
}
