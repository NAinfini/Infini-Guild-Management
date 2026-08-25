import { DEFAULT_GAME_RULES } from "@guild/shared";
import { CalendarOffIcon } from "@portal/components/icons";
import { Alert } from "@portal/components/ui/alert";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Input } from "@portal/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@portal/components/ui/select";
import { Skeleton } from "@portal/components/ui/skeleton";
import { ContentFilterGroup, ContentFilterToolbar } from "@portal/components/shared/ContentFilterToolbar";
import { NativeDateTimeInput } from "@portal/components/shared/NativeDateTimeInput";
import { formatDateTime } from "@portal/utils/datetime";
import { useTranslation } from "react-i18next";
import type { HistorySummaryRow } from "@portal/types/guild-war";
import { EmptyState } from "../../shared/EmptyState";
import { getGuildWarResultLabel } from "@portal/utils/game-rules";

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
  const gameRules = DEFAULT_GAME_RULES;
  const primaryTeamStat = gameRules.guild_war.team_stats.find((definition) => definition.dashboard === "primary")
    ?? gameRules.guild_war.team_stats[0];

  return (
    <>
      <ContentFilterToolbar
        className="war-history-toolbar"
        search={(
          <Input
            value={historySearch}
            onChange={(event) => onHistorySearchChange(String(event.currentTarget.value ?? ""))}
            placeholder={t("history.search.placeholder")}
            aria-label={t("history.aria.search")}
          />
        )}
        filterControls={(
          <ContentFilterGroup label={t("history.clearDates")}>
            <div className="grid gap-2">
              <NativeDateTimeInput
                value={historyDateFrom}
                onChange={(event) => onHistoryDateFromChange(event.currentTarget.value)}
                placeholder={t("history.dateFromPlaceholder")}
                aria-label={t("history.aria.dateFrom")}
              />
              <NativeDateTimeInput
                value={historyDateTo}
                onChange={(event) => onHistoryDateToChange(event.currentTarget.value)}
                placeholder={t("history.dateToPlaceholder")}
                aria-label={t("history.aria.dateTo")}
              />
            </div>
          </ContentFilterGroup>
        )}
        filterActions={(
          <Button
            variant="outline"
            size="sm"
            onClick={onClearDates}
            disabled={!historyDateFrom && !historyDateTo}
          >
            <CalendarOffIcon size={15} data-icon="inline-start" />
            {t("history.clearDates")}
          </Button>
        )}
        filterLabel={t("common:filter.toggle")}
        activeFilterCount={historyDateFrom || historyDateTo ? 1 : 0}
        resetLabel={t("common:filter.reset")}
        onReset={onClearDates}
      />

      {historyLoading ? <div className="grid gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div> : null}
      {historyError ? <Alert variant="destructive">{loadErrorMessage}</Alert> : null}

      {!historyLoading && !historyError ? (
        <Card className="war-history-list-card">
          <div className="war-history-list-card__body">
            <div className="war-history-list-card__header">
              <h3>{t("history.warList")}</h3>
              <Badge variant="secondary">{historyRows.length} / {historyTotal}</Badge>
            </div>

            {filteredHistoryRows.length > 0 ? (
              <ul
                className="war-history-rail"
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
                    <li
                      key={item.id}
                      className={itemClasses}
                    >
                      <button
                        type="button"
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
                            <Badge className="war-history-result-badge" data-result={item.result ?? "unknown"} variant="outline">
                              {item.result
                                ? getGuildWarResultLabel(item.result)
                                : t("history.unknownResult")}
                            </Badge>
                            <span className="war-history-rail-item__score tabular-nums">
                              {primaryTeamStat
                                ? `${item.own_stats?.[primaryTeamStat.key] ?? 0} / ${item.enemy_stats?.[primaryTeamStat.key] ?? 0}`
                                : "—"}
                            </span>
                          </span>
                          <time
                            className="war-history-rail-item__date tabular-nums"
                            dateTime={item.created_at}
                          >
                            {formatDateTime(item.created_at)}
                          </time>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="war-history-list-empty">
                <EmptyState title={t("history.noWarHistories")} />
              </div>
            )}

            {historyTotalPages > 1 ? (
              <div className="war-history-pagination">
                <div className="war-history-pagination__per-page">
                  <span>{t("history.perPage")}</span>
                  <Select
                    items={[
                      { value: "10", label: "10" },
                      { value: "20", label: "20" },
                    ]}
                    value={String(historyPerPage)}
                    onValueChange={(value) => { if (value) onHistoryPerPageChange(Number(value)); }}
                  >
                    <SelectTrigger size="sm" className="war-history-pagination__select" aria-label={t("history.perPage")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="war-history-pagination__pages">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    disabled={historyPage <= 1}
                    onClick={() => onHistoryPageChange(1)}
                    aria-label={t("history.aria.firstPage")}
                  >
                    «
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    disabled={historyPage <= 1}
                    onClick={() => onHistoryPageChange(historyPage - 1)}
                    aria-label={t("history.aria.previousPage")}
                  >
                    ‹
                  </Button>
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
                        return <span key={item} className="war-history-pagination__ellipsis">…</span>;
                      }
                      return (
                        <Button
                          type="button"
                          key={item}
                          size="icon-sm"
                          variant={item === historyPage ? "default" : "outline"}
                          onClick={() => onHistoryPageChange(item)}
                          aria-label={t("history.aria.page", { page: item })}
                          aria-current={item === historyPage ? "page" : undefined}
                        >
                          {item}
                        </Button>
                      );
                    });
                  })()}
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    disabled={historyPage >= historyTotalPages}
                    onClick={() => onHistoryPageChange(historyPage + 1)}
                    aria-label={t("history.aria.nextPage")}
                  >
                    ›
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    disabled={historyPage >= historyTotalPages}
                    onClick={() => onHistoryPageChange(historyTotalPages)}
                    aria-label={t("history.aria.lastPage")}
                  >
                    »
                  </Button>
                  <Input
                    type="number"
                    className="war-history-pagination__input"
                    aria-label={t("history.aria.page", { page: historyPage })}
                    min={1}
                    max={historyTotalPages}
                    value={historyPage}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (value >= 1 && value <= historyTotalPages) {
                        onHistoryPageChange(value);
                      }
                    }}
                  />
                  <span className="war-history-pagination__total">/ {historyTotalPages}</span>
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
    </>
  );
}
