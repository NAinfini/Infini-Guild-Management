import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconCalendarOff } from "@tabler/icons-react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { MotionButton } from "@infini-dev-kit/frontend/components";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { EmptyState } from "../../shared/EmptyState";

type HistoryViewMode = "table" | "chart";
type AnalyticsMetricKey =
  | "kills"
  | "deaths"
  | "assists"
  | "damage"
  | "healing"
  | "building_damage"
  | "credits"
  | "damage_taken"
  | "kda";
type EditableMetricKey = Exclude<AnalyticsMetricKey, "kda">;

export type HistorySummaryRow = {
  id: string;
  war_name: string;
  enemy_name: string | null;
  result: string | null;
  created_at: string;
  own_kills: number | null;
  enemy_kills: number | null;
};

type HistoryMemberStat = {
  id: string;
  user_id: string;
  role_tag: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  damage: number | null;
  healing: number | null;
  building_damage: number | null;
  credits: number | null;
  damage_taken: number | null;
};

type HistoryDetailTeam = {
  id: string;
  team_name: string;
  notes: string | null;
  members: Array<{
    user_id: string;
    role_tag: string | null;
  }>;
};

type HistoryDetailData = {
  id: string;
  war_name: string;
  enemy_name: string | null;
  result: string | null;
  own_kills: number | null;
  enemy_kills: number | null;
  own_towers: number | null;
  enemy_towers: number | null;
  own_base_hp: number | null;
  enemy_base_hp: number | null;
  own_distance: number | null;
  enemy_distance: number | null;
  own_credits: number | null;
  enemy_credits: number | null;
  notes: string | null;
  member_stats: HistoryMemberStat[];
  teams: HistoryDetailTeam[];
};

type HistoryMvpSummary = {
  damage: string;
  healing: string;
  building: string;
};

export type HistoryColumn<T> = {
  title: ReactNode;
  key: string;
  dataIndex?: keyof T | string;
  render?: (value: unknown, row: T) => ReactNode;
};

type WarHistoryTabProps = {
  heading: ReactNode;
  historyViewMode: HistoryViewMode;
  onHistoryViewModeChange: (value: HistoryViewMode) => void;
  historyChartMetric: AnalyticsMetricKey;
  onHistoryChartMetricChange: (value: AnalyticsMetricKey) => void;
  historyDateFrom: string;
  historyDateTo: string;
  onHistoryDateFromChange: (value: string) => void;
  onHistoryDateToChange: (value: string) => void;
  onClearDates: () => void;
  onExport: (format: "csv" | "json") => void;
  exportPending: boolean;
  exportCsvLabel: string;
  exportJsonLabel: string;
  canManage: boolean;
  historyLoading: boolean;
  historyError: boolean;
  historyRows: HistorySummaryRow[];
  historyColumns: HistoryColumn<HistorySummaryRow>[];
  onSelectHistoryId: (historyId: string) => void;
  historyDetailLoading: boolean;
  historyDetailError: boolean;
  historyDetail: HistoryDetailData | null;
  historyMvp: HistoryMvpSummary | null;
  historyMissingSlotsByUserId: Map<string, number>;
  onPostResults: (platform: "discord" | "wechat") => void;
  postResultsPending: boolean;
  onCommitMemberMetric: (userId: string, key: EditableMetricKey, value: number) => void;
  renderCounter: (value: number | null | undefined) => ReactNode;
  historyDetailTitle: string;
  historyResultLabel: string;
  loadErrorMessage: string;
  chartThemeName: string;
  chartPalette: string[];
  hashToPaletteColor: (value: string, palette: string[]) => string;
  getMetricLabel: (metric: AnalyticsMetricKey) => string;
  metricValueOrNullFromWarMember: (row: HistoryMemberStat, metric: AnalyticsMetricKey) => number | null;
  echarts: unknown;
  initialSearch?: string;
};

const HISTORY_METRIC_OPTIONS: Array<{ value: AnalyticsMetricKey; label: string }> = [
  { value: "damage", label: "Damage" },
  { value: "healing", label: "Healing" },
  { value: "building_damage", label: "Building Damage" },
  { value: "credits", label: "Credits" },
  { value: "kills", label: "Kills" },
  { value: "deaths", label: "Deaths" },
  { value: "assists", label: "Assists" },
  { value: "damage_taken", label: "Damage Taken" },
  { value: "kda", label: "KDA" },
];

function resolveResultTagColor(result: string | null | undefined): string {
  const normalized = (result ?? "").toLowerCase();
  if (normalized.includes("win") || normalized.includes("胜")) return "green";
  if (normalized.includes("loss") || normalized.includes("lose") || normalized.includes("负")) return "red";
  if (normalized.includes("draw") || normalized.includes("平")) return "blue";
  return "gray";
}

function renderCellValue<T extends Record<string, unknown>>(row: T, column: HistoryColumn<T>): ReactNode {
  const key = (column.dataIndex ?? column.key) as string;
  const raw = row[key];
  if (column.render) {
    return column.render(raw, row);
  }
  if (raw === null || raw === undefined || raw === "") {
    return "-";
  }
  return String(raw);
}

export function WarHistoryTab({
  heading,
  historyViewMode,
  onHistoryViewModeChange,
  historyChartMetric,
  onHistoryChartMetricChange,
  historyDateFrom,
  historyDateTo,
  onHistoryDateFromChange,
  onHistoryDateToChange,
  onClearDates,
  onExport,
  exportPending,
  exportCsvLabel,
  exportJsonLabel,
  canManage,
  historyLoading,
  historyError,
  historyRows,
  historyColumns,
  onSelectHistoryId,
  historyDetailLoading,
  historyDetailError,
  historyDetail,
  historyMvp,
  historyMissingSlotsByUserId,
  onPostResults,
  postResultsPending,
  onCommitMemberMetric,
  renderCounter,
  historyDetailTitle,
  historyResultLabel,
  loadErrorMessage,
  chartThemeName,
  chartPalette,
  hashToPaletteColor,
  getMetricLabel,
  metricValueOrNullFromWarMember,
  echarts,
  initialSearch,
}: WarHistoryTabProps) {
  const [historySearch, setHistorySearch] = useState(initialSearch ?? "");
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [highlightRowId, setHighlightRowId] = useState<string | null>(null);

  // Clear localStorage and highlight after initial render
  useEffect(() => {
    if (initialSearch) {
      localStorage.removeItem("guildWar.searchWarName");
      // Find matching row and set highlight
      const matchingRow = historyRows.find((row) => row.war_name === initialSearch);
      if (matchingRow) {
        setHighlightRowId(matchingRow.id);
        setTimeout(() => setHighlightRowId(null), 1200);
      }
    }
  }, [initialSearch, historyRows]);

  const filteredHistoryRows = useMemo(() => {
    const keyword = historySearch.trim().toLowerCase();
    if (!keyword) return historyRows;
    return historyRows.filter((row) => (
      row.war_name.toLowerCase().includes(keyword)
      || (row.enemy_name ?? "").toLowerCase().includes(keyword)
      || (row.result ?? "").toLowerCase().includes(keyword)
      || row.created_at.toLowerCase().includes(keyword)
      || String(row.own_kills ?? "").includes(keyword)
      || String(row.enemy_kills ?? "").includes(keyword)
    ));
  }, [historyRows, historySearch]);

  const handleSelectHistoryId = (historyId: string) => {
    onSelectHistoryId(historyId);
    setDetailModalOpen(true);
  };

  return (
    <Stack gap={12} style={{ width: "100%", alignItems: "stretch" }}>
      {heading}

      <div className="war-history-filters">
        <div className="war-history-filters__group">
          <TextInput
            value={historySearch}
            onChange={(event) => setHistorySearch(String(event.currentTarget.value ?? ""))}
            placeholder="Search war name / result / date"
            aria-label="Search guild war histories"
            style={{ width: 240 }}
          />
          <TextInput
            type="date"
            value={historyDateFrom}
            onChange={(event) => onHistoryDateFromChange(event.currentTarget.value)}
            aria-label="Guild war history date from"
            style={{ width: 170 }}
          />
          <TextInput
            type="date"
            value={historyDateTo}
            onChange={(event) => onHistoryDateToChange(event.currentTarget.value)}
            aria-label="Guild war history date to"
            style={{ width: 170 }}
          />
          <Tooltip label="Clear Dates">
            <ActionIcon variant="subtle" onClick={onClearDates} disabled={!historyDateFrom && !historyDateTo} aria-label="Clear dates">
              <IconCalendarOff size={18} />
            </ActionIcon>
          </Tooltip>
        </div>

        {canManage && historyDetail ? (
          <>
            <div className="war-history-filters__divider" />
            <div className="war-history-filters__group">
              <MotionButton onClick={() => onPostResults("discord")} loading={postResultsPending}>
                Post to Discord
              </MotionButton>
              <MotionButton onClick={() => onPostResults("wechat")} loading={postResultsPending}>
                Post to WeChat
              </MotionButton>
            </div>
          </>
        ) : null}
      </div>

      {historyLoading ? <Loader size="sm" /> : null}
      {historyError ? <Alert color="yellow">{loadErrorMessage}</Alert> : null}

      {!historyLoading && !historyError ? (
        <InfiniCard className="war-history-list-card">
          <div style={{ padding: "1.2rem" }}>
          <Stack gap={8}>
            <Group justify="space-between">
              <Text fw={600}>War List</Text>
              <Badge color="blue">{filteredHistoryRows.length} / {historyRows.length}</Badge>
            </Group>
            <div className="war-history-list-table-wrap">
              {filteredHistoryRows.length > 0 ? (
                <Table withTableBorder withColumnBorders striped>
                  <Table.Thead>
                    <Table.Tr>
                      {historyColumns.map((column) => (
                        <Table.Th key={column.key}>{column.title}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {filteredHistoryRows.map((record) => (
                      <Table.Tr
                        key={record.id}
                        onClick={() => handleSelectHistoryId(record.id)}
                        style={{ cursor: "pointer" }}
                        className={highlightRowId === record.id ? "war-history-row-highlight" : undefined}
                      >
                        {historyColumns.map((column) => (
                          <Table.Td key={`${record.id}:${column.key}`}>{renderCellValue(record, column)}</Table.Td>
                        ))}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              ) : (
                <div className="war-history-list-empty">
                  <EmptyState title="No war histories found." />
                </div>
              )}
            </div>
          </Stack>
          </div>
        </InfiniCard>
      ) : null}

      <Modal
        opened={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        title={historyDetail ? `${historyDetail.war_name}${historyDetail.enemy_name ? ` vs ${historyDetail.enemy_name}` : ""}` : historyDetailTitle}
        size="xl"
      >
          <Stack gap={16}>
            {historyDetailLoading ? <Loader size="sm" /> : null}
            {historyDetailError ? <Alert color="yellow">{loadErrorMessage}</Alert> : null}
            {!historyDetailLoading && !historyDetailError && historyDetail ? (
              <Stack gap={16}>
              <div className="war-history-detail-header">
                <div>
                  <Text fw={700} className="war-history-detail-title">{historyDetail.war_name}</Text>
                  {historyDetail.enemy_name ? (
                    <Text size="sm" c="dimmed" style={{ marginTop: 2 }}>vs {historyDetail.enemy_name}</Text>
                  ) : null}
                  <Text style={{ display: "block", marginTop: 4 }}>
                    {historyResultLabel}: <strong>{historyDetail.result ?? "-"}</strong>
                  </Text>
                </div>
                <Badge color={resolveResultTagColor(historyDetail.result)}>{historyDetail.result ?? "Unknown"}</Badge>
              </div>

              <div className="war-history-result-row">
                <Text c="dimmed">Members: {historyDetail.member_stats.length}</Text>
                <Text c="dimmed">Teams: {historyDetail.teams.length}</Text>
                <Text c="dimmed">Notes: {historyDetail.notes ?? "-"}</Text>
              </div>

              <div className="war-history-detail-grid">
                <div className="war-history-stat-card">
                  <div className="war-history-stat-label">Kills</div>
                  <div className="war-history-stat-value war-history-stat-value--vs">
                    <span className="war-history-stat-value--own">{renderCounter(historyDetail.own_kills)}</span>
                    <span className="war-history-stat-separator">/</span>
                    <span className="war-history-stat-value--enemy">{renderCounter(historyDetail.enemy_kills)}</span>
                  </div>
                </div>
                <div className="war-history-stat-card">
                  <div className="war-history-stat-label">Towers</div>
                  <div className="war-history-stat-value war-history-stat-value--vs">
                    <span className="war-history-stat-value--own">{renderCounter(historyDetail.own_towers)}</span>
                    <span className="war-history-stat-separator">/</span>
                    <span className="war-history-stat-value--enemy">{renderCounter(historyDetail.enemy_towers)}</span>
                  </div>
                </div>
                <div className="war-history-stat-card">
                  <div className="war-history-stat-label">Base HP</div>
                  <div className="war-history-stat-value war-history-stat-value--vs">
                    <span className="war-history-stat-value--own">{renderCounter(historyDetail.own_base_hp)}</span>
                    <span className="war-history-stat-separator">/</span>
                    <span className="war-history-stat-value--enemy">{renderCounter(historyDetail.enemy_base_hp)}</span>
                  </div>
                </div>
                <div className="war-history-stat-card">
                  <div className="war-history-stat-label">Distance</div>
                  <div className="war-history-stat-value war-history-stat-value--vs">
                    <span className="war-history-stat-value--own">{renderCounter(historyDetail.own_distance)}</span>
                    <span className="war-history-stat-separator">/</span>
                    <span className="war-history-stat-value--enemy">{renderCounter(historyDetail.enemy_distance)}</span>
                  </div>
                </div>
                <div className="war-history-stat-card">
                  <div className="war-history-stat-label">Credits</div>
                  <div className="war-history-stat-value war-history-stat-value--vs">
                    <span className="war-history-stat-value--own">{renderCounter(historyDetail.own_credits)}</span>
                    <span className="war-history-stat-separator">/</span>
                    <span className="war-history-stat-value--enemy">{renderCounter(historyDetail.enemy_credits)}</span>
                  </div>
                </div>
              </div>

              {historyMvp ? (
                <InfiniCard className="war-history-mvp-card">
                  <div style={{ padding: "1.2rem" }}>
                  <Stack gap={4}>
                    <Text fw={600}>MVP Highlights</Text>
                    <Text>Damage: {historyMvp.damage}</Text>
                    <Text>Healing: {historyMvp.healing}</Text>
                    <Text>Building: {historyMvp.building}</Text>
                  </Stack>
                  </div>
                </InfiniCard>
              ) : null}

              {historyDetail.teams.length > 0 ? (
                <InfiniCard className="war-history-teams-card">
                  <div style={{ padding: "1.2rem" }}>
                  <Stack gap={8} className="war-history-team-stack">
                    <Text fw={600}>Team Snapshot</Text>
                    {historyDetail.teams.map((team) => (
                      <InfiniCard key={team.id} className="war-history-team-card">
                        <div style={{ padding: "1.2rem" }}>
                        <Stack gap={4}>
                          <Text fw={600}>{team.team_name}</Text>
                          <Text c="dimmed" size="sm">{team.notes ?? "No team notes"}</Text>
                          <Text>
                            {team.members
                              .map((member) => `${member.user_id}${member.role_tag ? ` [${member.role_tag}]` : ""}`)
                              .join(", ") || "-"}
                          </Text>
                        </Stack>
                        </div>
                      </InfiniCard>
                    ))}
                  </Stack>
                  </div>
                </InfiniCard>
              ) : null}

              {historyViewMode === "table" ? (
                <Table withTableBorder withColumnBorders striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>User</Table.Th>
                      <Table.Th>Role</Table.Th>
                      <Table.Th>Kills</Table.Th>
                      <Table.Th>Deaths</Table.Th>
                      <Table.Th>Assists</Table.Th>
                      <Table.Th>Damage</Table.Th>
                      <Table.Th>Healing</Table.Th>
                      <Table.Th>Building</Table.Th>
                      <Table.Th>Credits</Table.Th>
                      <Table.Th>Missing</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {historyDetail.member_stats.map((row) => (
                      <Table.Tr key={row.id}>
                        <Table.Td>{row.user_id}</Table.Td>
                        <Table.Td>{row.role_tag ?? "-"}</Table.Td>
                        <Table.Td>
                          {canManage ? (
                            <NumberInput min={0} size="xs" value={row.kills ?? 0} onChange={(value) => onCommitMemberMetric(row.user_id, "kills", Number(value ?? 0))} />
                          ) : row.kills ?? "-"}
                        </Table.Td>
                        <Table.Td>
                          {canManage ? (
                            <NumberInput min={0} size="xs" value={row.deaths ?? 0} onChange={(value) => onCommitMemberMetric(row.user_id, "deaths", Number(value ?? 0))} />
                          ) : row.deaths ?? "-"}
                        </Table.Td>
                        <Table.Td>
                          {canManage ? (
                            <NumberInput min={0} size="xs" value={row.assists ?? 0} onChange={(value) => onCommitMemberMetric(row.user_id, "assists", Number(value ?? 0))} />
                          ) : row.assists ?? "-"}
                        </Table.Td>
                        <Table.Td>
                          {canManage ? (
                            <NumberInput min={0} size="xs" value={row.damage ?? 0} onChange={(value) => onCommitMemberMetric(row.user_id, "damage", Number(value ?? 0))} />
                          ) : row.damage ?? "-"}
                        </Table.Td>
                        <Table.Td>
                          {canManage ? (
                            <NumberInput min={0} size="xs" value={row.healing ?? 0} onChange={(value) => onCommitMemberMetric(row.user_id, "healing", Number(value ?? 0))} />
                          ) : row.healing ?? "-"}
                        </Table.Td>
                        <Table.Td>
                          {canManage ? (
                            <NumberInput min={0} size="xs" value={row.building_damage ?? 0} onChange={(value) => onCommitMemberMetric(row.user_id, "building_damage", Number(value ?? 0))} />
                          ) : row.building_damage ?? "-"}
                        </Table.Td>
                        <Table.Td>
                          {canManage ? (
                            <NumberInput min={0} size="xs" value={row.credits ?? 0} onChange={(value) => onCommitMemberMetric(row.user_id, "credits", Number(value ?? 0))} />
                          ) : row.credits ?? "-"}
                        </Table.Td>
                        <Table.Td>
                          {(() => {
                            const missingCount = historyMissingSlotsByUserId.get(row.user_id) ?? 0;
                            return missingCount > 0 ? (
                              <Badge color="yellow">Missing: {missingCount}</Badge>
                            ) : (
                              <Badge color="green">Complete</Badge>
                            );
                          })()}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              ) : (
                <InfiniCard className="war-history-chart-card">
                  <div style={{ padding: "1.2rem" }}>
                  <Stack gap={8}>
                    <Text fw={600}>{`${getMetricLabel(historyChartMetric)} Chart`}</Text>
                    <ReactEChartsCore
                      echarts={echarts}
                      theme={chartThemeName}
                      style={{ width: "100%", height: 420 }}
                      option={{
                        tooltip: { trigger: "axis" },
                        xAxis: { type: "value" },
                        yAxis: {
                          type: "category",
                          data: historyDetail.member_stats.map((item) => item.user_id),
                        },
                        series: [
                          {
                            type: "bar",
                            name: getMetricLabel(historyChartMetric),
                            data: historyDetail.member_stats.map((item) => ({
                              value: metricValueOrNullFromWarMember(item, historyChartMetric),
                              itemStyle: { color: hashToPaletteColor(item.user_id, chartPalette) },
                            })),
                          },
                        ],
                      }}
                    />
                  </Stack>
                  </div>
                </InfiniCard>
              )}

              <Group justify="flex-end" gap={8}>
                <MotionButton onClick={() => onExport("csv")} loading={exportPending}>
                  {exportCsvLabel}
                </MotionButton>
                <Button onClick={() => onExport("json")} loading={exportPending}>
                  {exportJsonLabel}
                </Button>
              </Group>
              </Stack>
            ) : null}
          </Stack>
      </Modal>
    </Stack>
  );
}
