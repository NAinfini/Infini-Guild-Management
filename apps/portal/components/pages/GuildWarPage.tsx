import { hasRoleAtLeast } from "@guild/shared";
import { IconCopy, IconDeviceFloppy, IconSwords, IconTrash, IconX } from "@tabler/icons-react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { buildEChartsTheme } from "@infini-dev-kit/frontend/theme/echarts/echarts-adapter";
import { useThemeSnapshot } from "@infini-dev-kit/frontend/provider";
import { NumberTicker } from "@infini-dev-kit/frontend/components";
import { Alert, Button, Card, Group, Loader, Select, Stack, Switch, TagsInput, Text, TextInput, Tabs } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  applyGuildWarTemplate,
  createGuildWarTemplate,
  deleteGuildWarTemplate,
  moveGuildWarMember,
  postGuildWarTeams,
  saveGuildWarTeams,
  updateGuildWarRoleTag,
  postGuildWarResults,
  updateGuildWarMemberStats,
} from "../../api/mutations/guild-war";
import { queryKeys } from "../../api/query-keys";
import { fetchEventDetail } from "../../api/queries/events";
import {
  downloadGuildWarExport,
  fetchGuildWarAnalytics,
  fetchGuildWarHistoryDetail,
} from "../../api/queries/guild-war";
import { useAppError } from "../../hooks/useAppError";
import { useGuildWarData } from "../../hooks/data/useGuildWarData";
import { useExternalView } from "../../hooks/useExternalView";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { fetchUsersList } from "../../api/queries/users";
import { useAuthStore } from "../../stores/auth";
import { copyPlainText } from "../../utils/copy";
import { PageLayout } from "../layout/PageLayout";
import type { ColumnDef } from "@tanstack/react-table";
import type { HistoryMemberStatsUpdate, HistorySummaryRow } from "../feature/guild-war/WarHistoryTab";
import { useGuildWarActiveController } from "../feature/guild-war/useGuildWarActiveController";
import "./GuildWarPage.css";

const LazyGuildWarAnalyticsTab = lazy(() =>
  import("../feature/guild-war/GuildWarAnalyticsTab").then((mod) => ({ default: mod.GuildWarAnalyticsTab })),
);
const LazyWarHistoryTab = lazy(() =>
  import("../feature/guild-war/WarHistoryTab").then((mod) => ({ default: mod.WarHistoryTab })),
);
const LazyWarMemberDetailModal = lazy(() =>
  import("../feature/guild-war/WarMemberDetailModal").then((mod) => ({ default: mod.WarMemberDetailModal })),
);
const LazyGuildWarActiveTopCard = lazy(() =>
  import("../feature/guild-war/GuildWarActiveTopCard").then((mod) => ({ default: mod.GuildWarActiveTopCard })),
);
const LazyGuildWarDragBoard = lazy(() =>
  import("../feature/guild-war/GuildWarDragBoard").then((mod) => ({ default: mod.GuildWarDragBoard })),
);

type AnalyticsMode = "player" | "compare" | "rankings" | "teams";
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
type AnalyticsAggregation = "total" | "average" | "best" | "median";
type AnalyticsDatePreset = "5" | "10" | "20" | "all";
type AnalyticsTableColumn = {
  title: string;
  key: string;
  dataIndex?: string;
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "yyyy-MM-dd HH:mm");
}

function renderCounter(value: number | null | undefined) {
  return <NumberTicker value={value ?? 0} />;
}

function downloadFileBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

type DragMemberItem = {
  itemId: string;
  userId: string;
  username: string;
  power: number;
  class: string;
  subtitle: string;
};

type DragMemberColumn = {
  containerId: string;
  title: ReactNode;
  locked: boolean;
  members: DragMemberItem[];
};

type MovePayload = {
  event_id: string;
  user_id: string;
  to: string;
  from?: string;
  etag?: string;
  undoing?: boolean;
};

type TeamRoleEditorState = {
  userId: string;
  tags: string[];
};

const ROLE_TAG_PRESETS = ["tank", "dps", "heal", "lead", "support", "flex"] as const;
const ANALYTICS_SELECTION_SOFT_CAP = 10;
const ANALYTICS_SELECTION_HARD_CAP = 20;

const message = {
  success: (content: string) => notifications.show({ color: "infini-success", message: content }),
  warning: (content: string) => notifications.show({ color: "infini-warning", message: content }),
  info: (content: string) => notifications.show({ color: "infini-primary", message: content }),
};

type TabItem = {
  key: string;
  label: ReactNode;
  children: ReactNode;
};

type PageTabsProps = {
  items: TabItem[];
  destroyInactiveTabPane?: boolean;
  initialActiveKey?: string;
};

function Spin() {
  return (
    <Group justify="center" py="sm">
      <Loader size="sm" />
    </Group>
  );
}

function Space({
  direction = "horizontal",
  style,
  size,
  children,
}: {
  direction?: "horizontal" | "vertical";
  style?: CSSProperties;
  size?: number;
  children: ReactNode;
}) {
  if (direction === "vertical") {
    return (
      <Stack gap={size} style={style}>
        {children}
      </Stack>
    );
  }

  return (
    <Group gap={size} style={style}>
      {children}
    </Group>
  );
}

function PageTabs({ items, destroyInactiveTabPane = false, initialActiveKey }: PageTabsProps) {
  const [activeKey, setActiveKey] = useState<string | null>(initialActiveKey ?? items[0]?.key ?? null);

  useEffect(() => {
    if (activeKey && items.some((item) => item.key === activeKey)) {
      return;
    }
    setActiveKey(items[0]?.key ?? null);
  }, [activeKey, items]);

  if (!activeKey) {
    return null;
  }

  return (
    <Tabs value={activeKey} onChange={setActiveKey} keepMounted={!destroyInactiveTabPane}>
      <Tabs.List>
        {items.map((item) => (
          <Tabs.Tab key={item.key} value={item.key}>
            {item.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {items.map((item) => (
        <Tabs.Panel key={item.key} value={item.key} pt="sm">
          {item.children}
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}

function shallowArrayEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function shallowRecordEqual<T extends string | boolean>(left: Record<string, T>, right: Record<string, T>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

function hashToPaletteColor(value: string, palette: string[]): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return palette[Math.abs(hash) % palette.length] ?? "var(--ant-color-primary)";
}

function getMetricLabel(metric: AnalyticsMetricKey): string {
  switch (metric) {
    case "kills":
      return "Kills";
    case "deaths":
      return "Deaths";
    case "assists":
      return "Assists";
    case "damage":
      return "Damage";
    case "healing":
      return "Healing";
    case "building_damage":
      return "Building Damage";
    case "credits":
      return "Credits";
    case "damage_taken":
      return "Damage Taken";
    case "kda":
      return "KDA";
    default:
      return metric;
  }
}

function aggregateValues(values: number[], aggregation: AnalyticsAggregation): number {
  if (values.length === 0) {
    return 0;
  }
  if (aggregation === "best") {
    return Math.max(...values);
  }
  if (aggregation === "median") {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2));
    }
    return sorted[middle] ?? 0;
  }
  if (aggregation === "average") {
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
  }
  return values.reduce((sum, value) => sum + value, 0);
}

function metricValueFromWarMember(
  row: {
    kills: number | null;
    deaths: number | null;
    assists: number | null;
    damage: number | null;
    healing: number | null;
    building_damage: number | null;
    credits: number | null;
    damage_taken: number | null;
  },
  metric: AnalyticsMetricKey,
): number {
  const normalized = {
    kills: row.kills ?? 0,
    deaths: row.deaths ?? 0,
    assists: row.assists ?? 0,
    damage: row.damage ?? 0,
    healing: row.healing ?? 0,
    building_damage: row.building_damage ?? 0,
    credits: row.credits ?? 0,
    damage_taken: row.damage_taken ?? 0,
  };
  if (metric === "kda") {
    const deaths = normalized.deaths > 0 ? normalized.deaths : 1;
    return Number(((normalized.kills + normalized.assists) / deaths).toFixed(2));
  }
  return normalized[metric];
}

function metricValueOrNullFromWarMember(
  row: {
    kills: number | null;
    deaths: number | null;
    assists: number | null;
    damage: number | null;
    healing: number | null;
    building_damage: number | null;
    credits: number | null;
    damage_taken: number | null;
  },
  metric: AnalyticsMetricKey,
): number | null {
  if (metric === "kda") {
    if (row.kills === null && row.assists === null && row.deaths === null) {
      return null;
    }
    return metricValueFromWarMember(row, metric);
  }
  const value = row[metric];
  return value === null ? null : value;
}

const LOWER_IS_BETTER_METRICS: Set<AnalyticsMetricKey> = new Set(["deaths", "damage_taken"]);

function normalizeMetricValue(
  rawValue: number,
  metric: AnalyticsMetricKey,
  durationMinutes: number | null,
  referenceDuration: number,
  modifier: number,
): number {
  let timeNormalized = rawValue;
  if (durationMinutes !== null && durationMinutes > 0) {
    timeNormalized = (rawValue / durationMinutes) * referenceDuration;
  }
  if (modifier !== 1 && modifier > 0) {
    if (LOWER_IS_BETTER_METRICS.has(metric)) {
      timeNormalized = timeNormalized / modifier;
    } else {
      timeNormalized = timeNormalized * modifier;
    }
  }
  return Number(timeNormalized.toFixed(2));
}

function splitRoleTags(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  const result: string[] = [];
  for (const part of value.split(",")) {
    const tag = part.trim();
    if (!tag) {
      continue;
    }
    result.push(tag);
  }
  return result;
}

function joinRoleTags(tags: readonly string[]): string | null {
  const result: string[] = [];
  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (!tag) {
      continue;
    }
    result.push(tag);
  }
  return result.length > 0 ? result.join(", ") : null;
}

function parseUserIdFromDragId(value: string): string | null {
  if (!value.startsWith("member:")) {
    return null;
  }
  const userId = value.slice("member:".length).trim();
  return userId.length > 0 ? userId : null;
}

function toMemberDomId(itemId: string): string {
  return `guild-war-member-${itemId.replace(/[:]/g, "-")}`;
}

function sectionHeading(text: string) {
  return (
    <h3 className="guild-war-section-heading">
      {text}
    </h3>
  );
}

function resolveContainerFromOverId(
  overId: string | number | null | undefined,
  memberContainerMap: Map<string, string>,
): string | null {
  if (typeof overId !== "string") {
    return null;
  }

  if (overId.startsWith("container:")) {
    return overId.slice("container:".length);
  }

  if (overId.startsWith("member:")) {
    return memberContainerMap.get(overId) ?? null;
  }

  return null;
}

export function GuildWarPage() {
  const { t } = useTranslation("guild-war");
  const queryClient = useQueryClient();
  const themeSnapshot = useThemeSnapshot();
  const user = useAuthStore((state) => state.user);
  const isExternalView = useExternalView();
  const isModerator = Boolean(user && hasRoleAtLeast(user.role, "moderator"));
  const canManageActive = isModerator && !isExternalView;
  const { showError } = useAppError();
  const chartThemeName = useMemo(() => `infini-kit-${themeSnapshot.state.themeId}`, [themeSnapshot.state.themeId]);
  const chartThemeConfig = useMemo(() => buildEChartsTheme(themeSnapshot.state.themeId), [themeSnapshot.state.themeId]);
  const chartPalette = chartThemeConfig.color;

  const [selectedEventId, setSelectedEventId] = useState<string | undefined>(undefined);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [analyticsMode, setAnalyticsMode] = useState<AnalyticsMode>("player");
  const [analyticsSelectedMetrics, setAnalyticsSelectedMetrics] = useState<AnalyticsMetricKey[]>(["damage"]);
  const [analyticsOnlyParticipated, setAnalyticsOnlyParticipated] = useState(true);
  const [analyticsDatePreset, setAnalyticsDatePreset] = useState<AnalyticsDatePreset>("10");
  const [analyticsSelectedWarIds, setAnalyticsSelectedWarIds] = useState<string[]>([]);
  const [analyticsFocusedUser, setAnalyticsFocusedUser] = useState<string>("");
  const [analyticsSelectedUsers, setAnalyticsSelectedUsers] = useState<string[]>([]);
  const [analyticsAggregation, setAnalyticsAggregation] = useState<AnalyticsAggregation>("total");
  const [analyticsMinParticipation, setAnalyticsMinParticipation] = useState(1);
  const [analyticsTopN, setAnalyticsTopN] = useState(10);
  const [analyticsSelectedTeams, setAnalyticsSelectedTeams] = useState<string[]>([]);
  const [analyticsTeamAggregation, setAnalyticsTeamAggregation] = useState<"total" | "average">("total");
  const [analyticsNormEnabled, setAnalyticsNormEnabled] = useState(true);
  const [modifierWeights, setModifierWeights] = useState({ kda: 0.30, towers: 0.10, credits: 0.30, distance: 0.15, basehp: 0.15 });
  const [modifierWeightsInitialized, setModifierWeightsInitialized] = useState(false);
  const [historyViewMode, setHistoryViewMode] = useState<"table" | "chart">("table");
  const [historyChartMetric, setHistoryChartMetric] = useState<AnalyticsMetricKey>("damage");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");
  const [teamRoleEditors, setTeamRoleEditors] = useState<Record<string, TeamRoleEditorState>>({});

  // Check localStorage for war search navigation from dashboard
  const initialTabKey = useMemo(() => {
    const searchWarName = localStorage.getItem("guildWar.searchWarName");
    if (searchWarName) {
      return "history";
    }
    return undefined;
  }, []);
  const {
    selectedDragUserIds,
    setSelectedDragUserIds,
    selectionAnchorUserId,
    setSelectionAnchorUserId,
    activeDragItemId,
    setActiveDragItemId,
    undoMove,
    setUndoMove,
    undoRemainingSec,
    teamDraftNames,
    setTeamDraftNames,
    teamDraftNotes,
    setTeamDraftNotes,
    teamDraftLocks,
    setTeamDraftLocks,
    teamOrder,
    setTeamOrder,
    activeSearch,
    setActiveSearch,
    searchJumpIndex,
    setSearchJumpIndex,
    activeDetailUserId,
    setActiveDetailUserId,
    moveTeamOrder,
  } = useGuildWarActiveController({ selectedEventId });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    echarts.registerTheme(chartThemeName, chartThemeConfig);
  }, [chartThemeConfig, chartThemeName]);

  const {
    warEventsQuery,
    selectedEventDetailQuery,
    activeQuery,
    templatesQuery,
    historyQuery,
    historyDetailQuery,
  } = useGuildWarData({
    selectedEventId,
    selectedHistoryId,
    historyDateFrom,
    historyDateTo,
  });

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsersList,
  });

  useEffect(() => {
    if (selectedEventId) return;
    const first = warEventsQuery.data?.data[0];
    if (first) {
      setSelectedEventId(first.id);
    }
  }, [selectedEventId, warEventsQuery.data]);

  useEffect(() => {
    if (selectedHistoryId) return;
    const first = historyQuery.data?.data[0];
    if (first) {
      setSelectedHistoryId(first.id);
    }
  }, [historyQuery.data, selectedHistoryId]);

  useEffect(() => {
    const templates = templatesQuery.data ?? [];
    if (templates.length === 0) {
      if (selectedTemplateId) {
        setSelectedTemplateId("");
      }
      return;
    }

    if (!selectedTemplateId || !templates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(templates[0]?.id ?? "");
    }
  }, [selectedTemplateId, templatesQuery.data]);

  const analyticsWarIds = useMemo(() => {
    const rows = historyQuery.data?.data ?? [];
    if (rows.length === 0) {
      return [] as string[];
    }
    if (analyticsSelectedWarIds.length > 0) {
      return analyticsSelectedWarIds;
    }
    if (analyticsDatePreset === "all") {
      return rows.map((row) => row.id);
    }
    const count = Number.parseInt(analyticsDatePreset, 10);
    if (!Number.isFinite(count) || count <= 0) {
      return rows.map((row) => row.id);
    }
    return rows.slice(0, count).map((row) => row.id);
  }, [analyticsDatePreset, analyticsSelectedWarIds, historyQuery.data?.data]);

  const analyticsQuery = useQuery({
    queryKey: queryKeys.guildWar.analytics(analyticsWarIds.join(",")),
    queryFn: () =>
      fetchGuildWarAnalytics({
        war_ids: analyticsWarIds,
      }),
    enabled: analyticsWarIds.length > 0,
    staleTime: Infinity,
  });

  const analyticsDetailsQuery = useQuery({
    queryKey: queryKeys.guildWar.analyticsDetails(analyticsWarIds.join(",")),
    queryFn: async () => Promise.all(analyticsWarIds.map((warId) => fetchGuildWarHistoryDetail(warId))),
    enabled: analyticsWarIds.length > 0 && (analyticsMode !== "player" || Boolean(analyticsFocusedUser)),
    staleTime: Infinity,
  });

  const initTeamsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEventId) {
        throw new Error("Missing event id");
      }
      const eventDetail = await fetchEventDetail(selectedEventId);
      const participants = eventDetail.participants;

      const alpha = participants.filter((_, index) => index % 2 === 0);
      const bravo = participants.filter((_, index) => index % 2 !== 0);

      return saveGuildWarTeams({
        event_id: selectedEventId,
        teams: [
          {
            team_name: t("active.defaultTeamAlpha"),
            sort_order: 0,
            members: alpha.map((member, index) => ({
              user_id: member.user_id,
              sort_order: index,
            })),
          },
          {
            team_name: t("active.defaultTeamBravo"),
            sort_order: 1,
            members: bravo.map((member, index) => ({
              user_id: member.user_id,
              sort_order: index,
            })),
          },
        ],
        pool_members: [],
      });
    },
    onSuccess: async () => {
      message.success(t("message.teamsInitialized"));
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.active(selectedEventId ?? "none"),
      });
    },
    onError: (error) => {
      showError(error, t("message.teamsInitFailed"));
    },
  });

  useEffect(() => {
    if (!undoMove || undoRemainingSec > 0) {
      return;
    }
    const pendingMove = undoMove;
    setUndoMove(null);
    const commitQueuedMoves = async () => {
      try {
        for (const [index, move] of pendingMove.moves.entries()) {
          await moveGuildWarMember({
            event_id: pendingMove.eventId,
            user_id: move.userId,
            to: move.to,
            etag: index === 0 ? pendingMove.etag ?? activeQuery.data?.etag ?? undefined : undefined,
          });
        }
        await queryClient.invalidateQueries({
          queryKey: queryKeys.guildWar.active(selectedEventId ?? "none"),
        });
        message.success(
          pendingMove.moves.length === 1
            ? t("message.memberMoved")
            : t("message.membersMoved", { count: pendingMove.moves.length }),
        );
      } catch (error) {
        showError(error, pendingMove.moves.length > 1 ? t("message.batchMoveCommitFailed") : t("message.memberMoveFailed"));
      }
    };
    void commitQueuedMoves();
  }, [activeQuery.data?.etag, queryClient, selectedEventId, showError, t, undoMove, undoRemainingSec]);

  const roleTagMutation = useMutation({
    mutationFn: updateGuildWarRoleTag,
    onSuccess: async () => {
      message.success(t("message.roleTagUpdated"));
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.active(selectedEventId ?? "none"),
      });
    },
    onError: (error) => {
      showError(error, t("message.roleTagUpdateFailed"));
    },
  });

  const postTeamsMutation = useMutation({
    mutationFn: postGuildWarTeams,
    onSuccess: (payload) => {
      message.success(`Posted. Task: ${payload.task_id}`);
    },
    onError: (error) => {
      showError(error, "Failed to post");
    },
  });

  const postResultsMutation = useMutation({
    mutationFn: postGuildWarResults,
    onSuccess: (payload) => {
      message.success(`Results posted. Task: ${payload.task_id}`);
    },
    onError: (error) => {
      showError(error, "Failed to post results");
    },
  });

  const createTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEventId) {
        throw new Error("Missing event id");
      }
      const normalizedName = templateName.trim();
      if (!normalizedName) {
        throw new Error("Template name is required");
      }
      const normalizedDescription = templateDescription.trim();
      return createGuildWarTemplate({
        event_id: selectedEventId,
        template_name: normalizedName,
        description: normalizedDescription.length > 0 ? normalizedDescription : undefined,
      });
    },
    onSuccess: async (template) => {
      message.success(t("message.templateSaved"));
      setTemplateName("");
      setTemplateDescription("");
      setSelectedTemplateId(template.id);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.templates(selectedEventId ?? "none"),
      });
    },
    onError: (error) => {
      showError(error, t("message.templateSaveFailed"));
    },
  });

  const applyTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEventId) {
        throw new Error("Missing event id");
      }
      if (!selectedTemplateId) {
        throw new Error("Missing template id");
      }
      return applyGuildWarTemplate({
        event_id: selectedEventId,
        template_id: selectedTemplateId,
      });
    },
    onSuccess: async () => {
      message.success(t("message.templateApplied"));
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.active(selectedEventId ?? "none"),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.historyAll(),
      });
    },
    onError: (error) => {
      showError(error, t("message.templateApplyFailed"));
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplateId) {
        throw new Error("Missing template id");
      }
      return deleteGuildWarTemplate(selectedTemplateId);
    },
    onSuccess: async () => {
      message.success(t("message.templateDeleted"));
      setSelectedTemplateId("");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.templates(selectedEventId ?? "none"),
      });
    },
    onError: (error) => {
      showError(error, t("message.templateDeleteFailed"));
    },
  });

  const exportHistoryMutation = useMutation({
    mutationFn: async (format: "csv" | "json") =>
      downloadGuildWarExport({
        format,
        event_id: selectedEventId,
        date_from: historyDateFrom ? `${historyDateFrom}T00:00:00.000Z` : undefined,
        date_to: historyDateTo ? `${historyDateTo}T23:59:59.999Z` : undefined,
      }),
    onSuccess: ({ filename, blob }) => {
      downloadFileBlob(filename, blob);
      message.success(t("history.export.success"));
    },
    onError: (error) => {
      showError(error, t("history.export.failed"));
    },
  });

  const updateMemberStatsMutation = useMutation({
    mutationFn: ({
      historyId,
      updates,
    }: {
      historyId: string;
      updates: HistoryMemberStatsUpdate[];
    }) =>
      Promise.all(
        updates.map((update) => updateGuildWarMemberStats(historyId, update.userId, update.payload)),
      ),
    onSuccess: async () => {
      message.success(t("history.saveStatsSuccess"));
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.historyDetail(selectedHistoryId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.analyticsDetailsAll(),
      });
    },
    onError: (error) => {
      showError(error, t("history.saveStatsFailed"));
    },
  });

  const activeTeams = activeQuery.data?.teams;
  const teams = activeTeams ?? [];
  const pool = activeQuery.data?.pool ?? [];

  const userDataMap = useMemo(() => {
    const map = new Map<string, { username: string; power: number; class: string }>();
    for (const item of usersQuery.data?.data ?? []) {
      map.set(item.user.id, {
        username: item.user.username,
        power: item.profile.power,
        class: item.profile.classes[0] ?? "Unknown",
      });
    }
    return map;
  }, [usersQuery.data]);

  const orderedTeams = useMemo(() => {
    if (teamOrder.length === 0) {
      return teams;
    }
    const byId = new Map(teams.map((team) => [team.id, team]));
    const ordered = teamOrder
      .map((teamId) => byId.get(teamId))
      .filter((team): team is (typeof teams)[number] => Boolean(team));
    const missing = teams.filter((team) => !teamOrder.includes(team.id));
    return [...ordered, ...missing];
  }, [teamOrder, teams]);

  useEffect(() => {
    if (!activeTeams) {
      return;
    }

    setTeamOrder((current) => {
      const ids = activeTeams.map((team) => team.id);
      const preserved = current.filter((id) => ids.includes(id));
      const missing = ids.filter((id) => !preserved.includes(id));
      const next = [...preserved, ...missing];
      return shallowArrayEqual(current, next) ? current : next;
    });
    setTeamDraftNames((current) => {
      const next: Record<string, string> = {};
      for (const team of activeTeams) {
        next[team.id] = current[team.id] ?? team.team_name;
      }
      return shallowRecordEqual(current, next) ? current : next;
    });
    setTeamDraftNotes((current) => {
      const next: Record<string, string> = {};
      for (const team of activeTeams) {
        next[team.id] = current[team.id] ?? team.notes ?? "";
      }
      return shallowRecordEqual(current, next) ? current : next;
    });
    setTeamDraftLocks((current) => {
      const next: Record<string, boolean> = {};
      for (const team of activeTeams) {
        next[team.id] = current[team.id] ?? team.is_locked;
      }
      return shallowRecordEqual(current, next) ? current : next;
    });
  }, [activeTeams]);

  useEffect(() => {
    setTeamRoleEditors((current) => {
      const next: Record<string, TeamRoleEditorState> = {};
      let changed = false;

      for (const team of orderedTeams) {
        if (team.members.length === 0) {
          continue;
        }
        const existing = current[team.id];
        const existingValid = existing
          ? team.members.some((member) => member.user_id === existing.userId)
          : false;
        if (existing && existingValid) {
          next[team.id] = existing;
          continue;
        }
        const firstMember = team.members[0];
        if (!firstMember) {
          continue;
        }
        next[team.id] = {
          userId: firstMember.user_id,
          tags: splitRoleTags(firstMember.role_tag),
        };
        changed = true;
      }

      if (Object.keys(current).length !== Object.keys(next).length) {
        changed = true;
      }

      if (!changed) {
        for (const [teamId, editor] of Object.entries(next)) {
          const currentEditor = current[teamId];
          if (!currentEditor || currentEditor.userId !== editor.userId || !shallowArrayEqual(currentEditor.tags, editor.tags)) {
            changed = true;
            break;
          }
        }
      }

      return changed ? next : current;
    });
  }, [orderedTeams]);

  const lockedTeamIds = useMemo(
    () =>
      new Set(
        orderedTeams
          .filter((team) => teamDraftLocks[team.id] ?? team.is_locked)
          .map((team) => team.id),
      ),
    [orderedTeams, teamDraftLocks],
  );
  const activeMemberDetailByUserId = useMemo(() => {
    const map = new Map<
      string,
      {
        teamName: string;
        roleTag: string | null;
        kills: number;
        deaths: number;
        assists: number;
        damage: number;
        healing: number;
        buildingDamage: number;
        credits: number;
      }
    >();
    for (const team of orderedTeams) {
      const teamName = (teamDraftNames[team.id] ?? team.team_name).trim() || team.team_name;
      for (const member of team.members) {
        map.set(member.user_id, {
          teamName,
          roleTag: member.role_tag ?? null,
          kills: member.kills ?? 0,
          deaths: member.deaths ?? 0,
          assists: member.assists ?? 0,
          damage: member.damage ?? 0,
          healing: member.healing ?? 0,
          buildingDamage: member.building_damage ?? 0,
          credits: member.credits ?? 0,
        });
      }
    }
    for (const member of pool) {
      if (!map.has(member.userId)) {
        map.set(member.userId, {
          teamName: "Pool",
          roleTag: null,
          kills: 0,
          deaths: 0,
          assists: 0,
          damage: 0,
          healing: 0,
          buildingDamage: 0,
          credits: 0,
        });
      }
    }
    return map;
  }, [orderedTeams, pool, teamDraftNames]);
  const activeDetail = activeDetailUserId ? activeMemberDetailByUserId.get(activeDetailUserId) ?? null : null;

  const dragColumns = useMemo<DragMemberColumn[]>(() => {
    const teamColumns = orderedTeams.map((team) => ({
      containerId: team.id,
      title: (teamDraftNames[team.id] ?? team.team_name).trim() || team.team_name,
      locked: lockedTeamIds.has(team.id),
      members: team.members.map((member) => {
        const userData = userDataMap.get(member.user_id);
        return {
          itemId: `member:${member.user_id}`,
          userId: member.user_id,
          username: userData?.username ?? member.user_id,
          power: userData?.power ?? 0,
          class: userData?.class ?? "Unknown",
          subtitle: `${member.role_tag ? `[${member.role_tag}] ` : ""}K/D/A: ${member.kills ?? 0}/${member.deaths ?? 0}/${member.assists ?? 0}`,
        };
      }),
    }));

    const poolColumn: DragMemberColumn = {
      containerId: "pool",
      title: t("active.pool"),
      locked: false,
      members: pool.map((member) => {
        const userData = userDataMap.get(member.userId);
        return {
          itemId: `member:${member.userId}`,
          userId: member.userId,
          username: userData?.username ?? member.userId,
          power: userData?.power ?? 0,
          class: userData?.class ?? "Unknown",
          subtitle: "Pool",
        };
      }),
    };

    return [...teamColumns, poolColumn];
  }, [lockedTeamIds, orderedTeams, pool, t, teamDraftNames, userDataMap]);

  const memberContainerMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const column of dragColumns) {
      for (const member of column.members) {
        map.set(member.itemId, column.containerId);
      }
    }
    return map;
  }, [dragColumns]);

  const dragItemMap = useMemo(() => {
    const map = new Map<string, DragMemberItem>();
    for (const column of dragColumns) {
      for (const member of column.members) {
        map.set(member.itemId, member);
      }
    }
    return map;
  }, [dragColumns]);

  const activeDragItem = activeDragItemId ? dragItemMap.get(activeDragItemId) ?? null : null;
  const selectedDragUserIdSet = useMemo(() => new Set(selectedDragUserIds), [selectedDragUserIds]);
  const draggableUserOrder = useMemo(
    () => dragColumns.flatMap((column) => column.members.map((member) => member.userId)),
    [dragColumns],
  );
  const draggableUserOrderIndexMap = useMemo(
    () => new Map(draggableUserOrder.map((userId, index) => [userId, index])),
    [draggableUserOrder],
  );
  const normalizedActiveSearch = activeSearch.trim().toLowerCase();
  const matchedItemIds = useMemo(() => {
    if (!normalizedActiveSearch) {
      return [] as string[];
    }
    return dragColumns.flatMap((column) =>
      column.members
        .filter((member) =>
          `${member.userId} ${member.subtitle}`.toLowerCase().includes(normalizedActiveSearch),
        )
        .map((member) => member.itemId),
    );
  }, [dragColumns, normalizedActiveSearch]);
  const activeMatchIndex =
    matchedItemIds.length > 0
      ? ((searchJumpIndex % matchedItemIds.length) + matchedItemIds.length) % matchedItemIds.length
      : 0;
  const activeMatchedItemId = matchedItemIds.length > 0 ? matchedItemIds[activeMatchIndex] : null;

  useEffect(() => {
    setSearchJumpIndex(0);
  }, [normalizedActiveSearch, selectedEventId]);

  useEffect(() => {
    if (!activeMatchedItemId) {
      return;
    }
    const element = document.getElementById(toMemberDomId(activeMatchedItemId));
    if (!element) {
      return;
    }
    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }, [activeMatchedItemId]);

  const queueMoveWithUndo = (payloads: MovePayload[]) => {
    if (!canManageActive || payloads.length === 0) {
      return;
    }
    if (undoMove) {
      message.warning(t("message.moveQueueBusy"));
      return;
    }
    const firstPayload = payloads[0];
    if (!firstPayload) {
      return;
    }
    const normalizedMoves = payloads
      .map((payload) => ({
        userId: payload.user_id,
        from: payload.from ?? "unknown",
        to: payload.to,
      }))
      .filter((payload) => payload.from !== payload.to);
    if (normalizedMoves.length === 0) {
      return;
    }
    setUndoMove({
      eventId: firstPayload.event_id,
      moves: normalizedMoves,
      etag: firstPayload.etag,
      expiresAt: Date.now() + 5_000,
    });
    if (normalizedMoves.length === 1) {
      const onlyMove = normalizedMoves[0];
      if (!onlyMove) {
        return;
      }
      message.info(t("message.moveQueuedSingle", { userId: onlyMove.userId, from: onlyMove.from, to: onlyMove.to }));
      return;
    }
    message.info(t("message.moveQueuedMulti", { count: normalizedMoves.length }));
  };

  const handleSelectMember = (userId: string, event: MouseEvent<HTMLButtonElement>) => {
    if (!canManageActive) {
      return;
    }
    if (event.shiftKey) {
      setSelectedDragUserIds((current) => {
        const anchor = selectionAnchorUserId ?? current[current.length - 1] ?? userId;
        const anchorIndex = draggableUserOrderIndexMap.get(anchor);
        const targetIndex = draggableUserOrderIndexMap.get(userId);
        if (anchorIndex === undefined || targetIndex === undefined) {
          if (event.metaKey || event.ctrlKey) {
            return Array.from(new Set([...current, userId]));
          }
          return [userId];
        }
        const rangeStart = Math.min(anchorIndex, targetIndex);
        const rangeEnd = Math.max(anchorIndex, targetIndex);
        const rangeUserIds = draggableUserOrder.slice(rangeStart, rangeEnd + 1);
        if (event.metaKey || event.ctrlKey) {
          return Array.from(new Set([...current, ...rangeUserIds]));
        }
        return rangeUserIds;
      });
      setSelectionAnchorUserId(userId);
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      setSelectedDragUserIds((current) => {
        if (current.includes(userId)) {
          return current.filter((item) => item !== userId);
        }
        return [...current, userId];
      });
      setSelectionAnchorUserId(userId);
      return;
    }
    setSelectedDragUserIds([userId]);
    setSelectionAnchorUserId(userId);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const nextActiveId = String(event.active.id);
    setActiveDragItemId(nextActiveId);
    const activeUserId = parseUserIdFromDragId(nextActiveId);
    if (activeUserId && !selectedDragUserIdSet.has(activeUserId)) {
      setSelectedDragUserIds([activeUserId]);
    }
  };

  const handleDragCancel = () => {
    setActiveDragItemId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragItemId(null);

    if (!canManageActive || !selectedEventId) {
      return;
    }

    const activeId = String(event.active.id);
    const sourceContainer = memberContainerMap.get(activeId);
    const targetContainer = resolveContainerFromOverId(event.over?.id, memberContainerMap);
    const userId = parseUserIdFromDragId(activeId);
    if (!sourceContainer || !targetContainer || !userId || sourceContainer === targetContainer) {
      return;
    }

    if (lockedTeamIds.has(targetContainer)) {
      message.warning("Target team is locked");
      return;
    }

    const movingUserIds = selectedDragUserIdSet.has(userId)
      ? selectedDragUserIds
      : [userId];
    const uniqueUserIds = Array.from(new Set(movingUserIds));

    if (uniqueUserIds.length <= 1) {
      queueMoveWithUndo([
        {
          event_id: selectedEventId,
          user_id: userId,
          to: targetContainer,
          from: sourceContainer,
          etag: activeQuery.data?.etag ?? undefined,
        },
      ]);
      return;
    }

    queueMoveWithUndo(
      uniqueUserIds.map((movingUserId) => ({
        event_id: selectedEventId,
        user_id: movingUserId,
        to: targetContainer,
        from: memberContainerMap.get(`member:${movingUserId}`),
        etag: activeQuery.data?.etag ?? undefined,
      })),
    );
  };

  const activePoolStatus = null;

  const teamStatusContentByContainerId = useMemo<Record<string, ReactNode>>(() => {
    if (!canManageActive) {
      return {};
    }
    const result: Record<string, ReactNode> = {};
    for (let teamIndex = 0; teamIndex < orderedTeams.length; teamIndex += 1) {
      const team = orderedTeams[teamIndex];
      if (!team) {
        continue;
      }
      const draftName = teamDraftNames[team.id] ?? team.team_name;
      const draftNotes = teamDraftNotes[team.id] ?? team.notes ?? "";
      const draftLocked = teamDraftLocks[team.id] ?? team.is_locked;
      const roleEditor = teamRoleEditors[team.id];
      const selectedMember = team.members.find((member) => member.user_id === roleEditor?.userId) ?? null;
      const selectedMemberRoleTags = splitRoleTags(selectedMember?.role_tag ?? null);
      result[team.id] = (
        <Stack gap={8}>
          <Group gap={8} wrap="wrap" align="center">
            <Switch
              size="sm"
              checked={draftLocked}
              onLabel={t("active.teamSetup.locked")}
              offLabel={t("active.teamSetup.open")}
              onChange={(event) =>
                setTeamDraftLocks((current) => ({
                  ...current,
                  [team.id]: event.currentTarget.checked,
                }))
              }
            />
            <Button
              size="xs"
              variant="light"
              onClick={() => moveTeamOrder(team.id, "up")}
              disabled={draftLocked || teamIndex === 0}
            >
              {t("active.teamSetup.moveUp")}
            </Button>
            <Button
              size="xs"
              variant="light"
              onClick={() => moveTeamOrder(team.id, "down")}
              disabled={draftLocked || teamIndex === orderedTeams.length - 1}
            >
              {t("active.teamSetup.moveDown")}
            </Button>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconCopy size={16} />}
              onClick={() => {
                void copyPlainText(`${draftName.trim() || team.team_name}: ${team.members.map((member) => `@${member.user_id}`).join(", ")}`);
                message.success(t("active.teamCopied"));
              }}
            >
              {t("active.teamSetup.copyLabel")}
            </Button>
          </Group>
          <Group gap={8} wrap="wrap" grow>
            <TextInput
              value={draftName}
              onChange={(event) =>
                setTeamDraftNames((current) => ({
                  ...current,
                  [team.id]: event.currentTarget.value,
                }))
              }
              disabled={draftLocked}
              aria-label={`Team name for ${team.team_name}`}
              placeholder={t("active.teamSetup.namePlaceholder")}
              style={{ flex: "1 1 180px" }}
            />
            <TextInput
              value={draftNotes}
              onChange={(event) =>
                setTeamDraftNotes((current) => ({
                  ...current,
                  [team.id]: event.currentTarget.value,
                }))
              }
              disabled={draftLocked}
              aria-label={`Team notes for ${team.team_name}`}
              placeholder={t("active.teamSetup.notesPlaceholder")}
              style={{ flex: "2 1 220px" }}
            />
          </Group>
          <Group gap={8} wrap="wrap" align="flex-end">
            <Select
              value={roleEditor?.userId ?? null}
              onChange={(value) => {
                const nextUserId = value ?? "";
                const nextMember = team.members.find((member) => member.user_id === nextUserId);
                setTeamRoleEditors((current) => ({
                  ...current,
                  [team.id]: {
                    userId: nextUserId,
                    tags: splitRoleTags(nextMember?.role_tag ?? null),
                  },
                }));
              }}
              data={team.members.map((member) => ({
                value: member.user_id,
                label: member.user_id,
              }))}
              placeholder={t("active.teamSetup.roleTags.memberPlaceholder")}
              aria-label={t("active.teamSetup.roleTags.memberLabel")}
              disabled={draftLocked || team.members.length === 0}
              searchable
              style={{ flex: "1 1 200px", minWidth: 180 }}
            />
            <Button
              size="xs"
              variant="light"
              color="infini-danger"
              leftSection={<IconTrash size={16} />}
              disabled={draftLocked || !selectedEventId || !roleEditor?.userId}
              loading={roleTagMutation.isPending}
              onClick={() => {
                if (!selectedEventId || !roleEditor?.userId) {
                  return;
                }
                setTeamRoleEditors((current) => ({
                  ...current,
                  [team.id]: {
                    userId: roleEditor.userId,
                    tags: [],
                  },
                }));
                roleTagMutation.mutate({
                  event_id: selectedEventId,
                  user_id: roleEditor.userId,
                  role_tag: null,
                });
              }}
            >
              {t("active.teamSetup.roleTags.clear")}
            </Button>
          </Group>
          <TagsInput
            value={roleEditor?.tags ?? []}
            onChange={(values) =>
              setTeamRoleEditors((current) => {
                const currentEditor = current[team.id];
                if (!currentEditor) {
                  return current;
                }
                return {
                  ...current,
                  [team.id]: {
                    ...currentEditor,
                    tags: values,
                  },
                };
              })
            }
            data={Array.from(new Set([...ROLE_TAG_PRESETS, ...(roleEditor?.tags ?? [])]))}
            disabled={draftLocked || team.members.length === 0}
            placeholder={t("active.teamSetup.roleTags.tagsPlaceholder")}
            aria-label={t("active.teamSetup.roleTags.tagsLabel")}
            clearable
          />
          <Group gap={8} wrap="wrap" justify="space-between" align="center">
            <Text size="xs" c="dimmed">
              {t("active.teamSetup.roleTags.current", {
                tags: selectedMemberRoleTags.join(", ") || t("active.teamSetup.roleTags.noTag"),
              })}
            </Text>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconDeviceFloppy size={16} />}
              disabled={draftLocked || !selectedEventId || !roleEditor?.userId}
              loading={roleTagMutation.isPending}
              onClick={() => {
                if (!selectedEventId || !roleEditor?.userId) {
                  return;
                }
                roleTagMutation.mutate({
                  event_id: selectedEventId,
                  user_id: roleEditor.userId,
                  role_tag: joinRoleTags(roleEditor.tags),
                });
              }}
            >
              {t("active.teamSetup.roleTags.apply")}
            </Button>
          </Group>
        </Stack>
      );
    }
    return result;
  }, [
    canManageActive,
    moveTeamOrder,
    orderedTeams,
    roleTagMutation.isPending,
    roleTagMutation.mutate,
    selectedEventId,
    t,
    teamDraftLocks,
    teamDraftNames,
    teamDraftNotes,
    teamRoleEditors,
  ]);

  const historyColumns: ColumnDef<HistorySummaryRow, unknown>[] = [
    {
      header: t("history.table.name"),
      id: "war_name",
      accessorKey: "war_name",
    },
    {
      header: "Enemy",
      id: "enemy_name",
      accessorKey: "enemy_name",
      cell: ({ getValue }) => {
        const v = getValue();
        return typeof v === "string" && v ? v : "-";
      },
    },
    {
      header: t("history.table.result"),
      id: "result",
      accessorKey: "result",
      cell: ({ getValue }) => {
        const v = getValue();
        return typeof v === "string" ? v : "-";
      },
    },
    {
      header: t("history.table.kills"),
      id: "kills",
      enableSorting: false,
      cell: ({ row }) => `${row.original.own_kills ?? 0} / ${row.original.enemy_kills ?? 0}`,
    },
    {
      header: t("history.table.date"),
      id: "created_at",
      accessorKey: "created_at",
      cell: ({ getValue }) => {
        const v = getValue();
        return typeof v === "string" ? formatDateTime(v) : "-";
      },
    },
  ];

  const historyMvp = useMemo(() => {
    const stats = historyDetailQuery.data?.member_stats ?? [];
    if (stats.length === 0) {
      return null;
    }

    const topDamage = [...stats].sort((a, b) => (b.damage ?? 0) - (a.damage ?? 0))[0] ?? null;
    const topHealing = [...stats].sort((a, b) => (b.healing ?? 0) - (a.healing ?? 0))[0] ?? null;
    const topBuilding = [...stats].sort((a, b) => (b.building_damage ?? 0) - (a.building_damage ?? 0))[0] ?? null;

    return {
      damage: topDamage ? `${topDamage.user_id} (${topDamage.damage ?? 0})` : "-",
      healing: topHealing ? `${topHealing.user_id} (${topHealing.healing ?? 0})` : "-",
      building: topBuilding ? `${topBuilding.user_id} (${topBuilding.building_damage ?? 0})` : "-",
    };
  }, [historyDetailQuery.data]);
  const historyTeamSizeBaseline = useMemo(() => {
    const teams = historyDetailQuery.data?.teams ?? [];
    if (teams.length === 0) {
      return 0;
    }
    return teams.reduce((max, team) => Math.max(max, team.members.length), 0);
  }, [historyDetailQuery.data?.teams]);
  const historyMissingSlotsByUserId = useMemo(() => {
    const map = new Map<string, number>();
    const teams = historyDetailQuery.data?.teams ?? [];
    if (historyTeamSizeBaseline <= 0 || teams.length === 0) {
      return map;
    }
    for (const team of teams) {
      const missing = Math.max(0, historyTeamSizeBaseline - team.members.length);
      for (const member of team.members) {
        map.set(member.user_id, missing);
      }
    }
    return map;
  }, [historyDetailQuery.data?.teams, historyTeamSizeBaseline]);

  const templateOptions = useMemo(
    () =>
      (templatesQuery.data ?? []).map((template) => ({
        value: template.id,
        label: `${template.template_name} (${template.team_count}/${template.member_count})`,
      })),
    [templatesQuery.data],
  );
  const templateActionDisabled =
    !canManageActive ||
    !selectedEventId ||
    createTemplateMutation.isPending ||
    applyTemplateMutation.isPending ||
    deleteTemplateMutation.isPending;

  const analyticsRows = analyticsQuery.data?.member_stats ?? [];
  const analyticsWarDetails = analyticsDetailsQuery.data ?? [];
  const analyticsWarsCount = analyticsWarIds.length;
  const analyticsWarOptions = useMemo(
    () =>
      (historyQuery.data?.data ?? []).map((row) => ({
        value: row.id,
        label: `${row.war_name} (${row.created_at.slice(0, 10)})`,
      })),
    [historyQuery.data?.data],
  );
  const analyticsSelectableUserIds = useMemo(() => {
    const detailIds = analyticsWarDetails.flatMap((war) => war.member_stats.map((member) => member.user_id));
    const aggregatedIds = analyticsRows.map((row) => row.user_id);
    return Array.from(new Set([...detailIds, ...aggregatedIds])).sort();
  }, [analyticsRows, analyticsWarDetails]);
  const analyticsTeamOptions = useMemo(() => {
    const names = analyticsWarDetails.flatMap((war) => war.teams.map((team) => team.team_name));
    return Array.from(new Set(names)).sort();
  }, [analyticsWarDetails]);
  const analyticsMetric = analyticsSelectedMetrics[0] ?? "damage";
  const analyticsMetricLabel = getMetricLabel(analyticsMetric);
  const analyticsMetricLabels = analyticsSelectedMetrics.map(getMetricLabel);

  // Build normalization context from analytics API response
  const analyticsSettings = analyticsQuery.data?.analytics_settings;
  const referenceDuration = analyticsSettings?.reference_duration_minutes ?? 30;

  // Sync modifier weights from server once loaded
  useEffect(() => {
    if (analyticsSettings && !modifierWeightsInitialized) {
      setModifierWeights({
        kda: analyticsSettings.modifier_weight_kda,
        towers: analyticsSettings.modifier_weight_towers,
        credits: analyticsSettings.modifier_weight_credits,
        distance: analyticsSettings.modifier_weight_distance,
        basehp: analyticsSettings.modifier_weight_basehp,
      });
      setModifierWeightsInitialized(true);
    }
  }, [analyticsSettings, modifierWeightsInitialized]);

  const warNormContext = useMemo(() => {
    const wars = analyticsQuery.data?.wars ?? [];
    const map = new Map<string, { durationMinutes: number | null; modifier: number }>();
    for (const war of wars) {
      map.set(war.id, {
        durationMinutes: war.duration_minutes,
        modifier: war.modifier,
      });
    }
    return map;
  }, [analyticsQuery.data?.wars]);

  const getNormalizedMetricValue = useCallback(
    (warId: string, member: Parameters<typeof metricValueFromWarMember>[0], metric: AnalyticsMetricKey): number => {
      const raw = metricValueFromWarMember(member, metric);
      if (!analyticsNormEnabled) return raw;
      const ctx = warNormContext.get(warId);
      if (!ctx) return raw;
      if (metric === "kda") {
        // KDA: normalize K/D/A individually, then compute ratio
        const normK = normalizeMetricValue(member.kills ?? 0, "kills", ctx.durationMinutes, referenceDuration, ctx.modifier);
        const normD = normalizeMetricValue(member.deaths ?? 0, "deaths", ctx.durationMinutes, referenceDuration, ctx.modifier);
        const normA = normalizeMetricValue(member.assists ?? 0, "assists", ctx.durationMinutes, referenceDuration, ctx.modifier);
        return Number(((normK + normA) / Math.max(normD, 1)).toFixed(2));
      }
      return normalizeMetricValue(raw, metric, ctx.durationMinutes, referenceDuration, ctx.modifier);
    },
    [analyticsNormEnabled, referenceDuration, warNormContext],
  );

  const getNormalizedMetricValueOrNull = useCallback(
    (warId: string, member: Parameters<typeof metricValueOrNullFromWarMember>[0], metric: AnalyticsMetricKey): number | null => {
      const raw = metricValueOrNullFromWarMember(member, metric);
      if (raw === null) return null;
      if (!analyticsNormEnabled) return raw;
      const ctx = warNormContext.get(warId);
      if (!ctx) return raw;
      if (metric === "kda") {
        return getNormalizedMetricValue(warId, member, metric);
      }
      return normalizeMetricValue(raw, metric, ctx.durationMinutes, referenceDuration, ctx.modifier);
    },
    [analyticsNormEnabled, getNormalizedMetricValue, referenceDuration, warNormContext],
  );

  useEffect(() => {
    if (!analyticsFocusedUser && analyticsSelectableUserIds.length > 0) {
      setAnalyticsFocusedUser(analyticsSelectableUserIds[0] ?? "");
    }
  }, [analyticsFocusedUser, analyticsSelectableUserIds]);

  useEffect(() => {
    if (analyticsSelectedWarIds.length > 0) {
      setAnalyticsDatePreset("all");
    }
  }, [analyticsSelectedWarIds]);

  const analyticsTimeline = useMemo(() => {
    return [...analyticsWarDetails].sort(
      (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
    );
  }, [analyticsWarDetails]);

  const analyticsCompareUserIds = useMemo(() => {
    if (analyticsSelectedUsers.length > 0) {
      return analyticsSelectedUsers;
    }
    return analyticsSelectableUserIds.slice(0, Math.min(3, analyticsSelectableUserIds.length));
  }, [analyticsSelectableUserIds, analyticsSelectedUsers]);

  const analyticsRankingRows = useMemo(() => {
    const valuesByUser = new Map<string, number[]>();
    for (const war of analyticsTimeline) {
      for (const member of war.member_stats) {
        const current = valuesByUser.get(member.user_id) ?? [];
        current.push(getNormalizedMetricValue(war.id, member, analyticsMetric));
        valuesByUser.set(member.user_id, current);
      }
    }
    return Array.from(valuesByUser.entries())
      .map(([userId, values]) => ({
        key: userId,
        user_id: userId,
        participation: values.length,
        score: Number(aggregateValues(values, analyticsAggregation).toFixed(2)),
      }))
      .filter((row) => row.participation >= analyticsMinParticipation)
      .sort((left, right) => right.score - left.score)
      .slice(0, analyticsTopN);
  }, [analyticsAggregation, analyticsMetric, analyticsMinParticipation, analyticsTimeline, analyticsTopN, getNormalizedMetricValue]);

  const analyticsTeamSeries = useMemo(() => {
    const seriesMap = new Map<string, Array<{ warId: string; warName: string; value: number }>>();
    for (const war of analyticsTimeline) {
      for (const team of war.teams) {
        if (analyticsSelectedTeams.length > 0 && !analyticsSelectedTeams.includes(team.team_name)) {
          continue;
        }
        const values = team.members.map((member) => getNormalizedMetricValue(war.id, member, analyticsMetric));
        const score =
          analyticsTeamAggregation === "average"
            ? Number((values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)).toFixed(2))
            : values.reduce((sum, value) => sum + value, 0);
        const current = seriesMap.get(team.team_name) ?? [];
        current.push({
          warId: war.id,
          warName: war.war_name,
          value: Number(score.toFixed(2)),
        });
        seriesMap.set(team.team_name, current);
      }
    }
    return Array.from(seriesMap.entries()).map(([teamName, points]) => ({
      teamName,
      points,
    }));
  }, [analyticsMetric, analyticsSelectedTeams, analyticsTeamAggregation, analyticsTimeline, getNormalizedMetricValue]);

  const analyticsPlayerRows = useMemo(() => {
    if (analyticsSelectedUsers.length === 0) return [];
    return analyticsTimeline.map((war) => {
      const row: Record<string, unknown> = {
        key: war.id,
        war_name: war.war_name,
        created_at: war.created_at,
        result: war.result ?? "-",
      };
      analyticsSelectedUsers.forEach((userId, userIndex) => {
        const member = war.member_stats.find((item) => item.user_id === userId);
        analyticsSelectedMetrics.forEach((metric, metricIndex) => {
          row[`user${userIndex}_metric${metricIndex}`] = member ? getNormalizedMetricValueOrNull(war.id, member, metric) : null;
        });
      });
      return row;
    });
  }, [analyticsSelectedUsers, analyticsSelectedMetrics, analyticsTimeline, getNormalizedMetricValueOrNull]);

  const analyticsChartOption = useMemo(() => {
    if (analyticsMode === "player") {
      const series: Array<{ type: string; name: string; smooth: boolean; data: unknown[] }> = [];
      analyticsSelectedUsers.forEach((userId, userIndex) => {
        analyticsSelectedMetrics.forEach((metric, metricIndex) => {
          series.push({
            type: "line",
            name: `${userId} - ${getMetricLabel(metric)}`,
            smooth: true,
            data: analyticsPlayerRows.map((row) => row[`user${userIndex}_metric${metricIndex}`]),
          });
        });
      });
      return {
        color: chartPalette,
        tooltip: { trigger: "axis" },
        legend: { type: "scroll" },
        xAxis: { type: "category", data: analyticsPlayerRows.map((row) => row.war_name), axisLabel: { rotate: 18 } },
        yAxis: { type: "value" },
        series,
      };
    }

    if (analyticsMode === "rankings") {
      return {
        color: chartPalette,
        tooltip: { trigger: "axis" },
        xAxis: { type: "value" },
        yAxis: {
          type: "category",
          data: analyticsRankingRows.map((row) => row.user_id),
          axisLabel: { interval: 0 },
        },
        series: [
          {
            type: "bar",
            name: `${analyticsAggregation} ${analyticsMetricLabel}`,
            data: analyticsRankingRows.map((row) => ({
              value: row.score,
              itemStyle: { color: hashToPaletteColor(row.user_id, chartPalette) },
            })),
          },
        ],
      };
    }

    const firstSeries = analyticsTeamSeries[0];
    return {
      color: chartPalette,
      tooltip: { trigger: "axis" },
      legend: { type: "scroll" },
      xAxis: {
        type: "category",
        data: firstSeries ? firstSeries.points.map((point) => point.warName) : [],
        axisLabel: { rotate: 18 },
      },
      yAxis: { type: "value" },
      series: analyticsTeamSeries.map((series) => ({
        type: "bar",
        name: series.teamName,
        data: series.points.map((point) => point.value),
      })),
    };
  }, [
    analyticsCompareUserIds,
    analyticsMetric,
    analyticsMetricLabel,
    analyticsMetricLabels,
    analyticsMode,
    analyticsPlayerRows,
    analyticsRankingRows,
    analyticsSelectedMetrics,
    analyticsTeamSeries,
    analyticsTimeline,
    analyticsAggregation,
    chartPalette,
  ]);

  const analyticsTableRows = useMemo(() => {
    if (analyticsMode === "player") {
      return analyticsPlayerRows;
    }
    if (analyticsMode === "rankings") {
      return analyticsRankingRows.map((row, index) => ({ ...row, rank: index + 1 }));
    }
    return analyticsTeamSeries.map((series) => {
      const values = series.points.map((point) => point.value);
      return {
        key: series.teamName,
        team_name: series.teamName,
        wars: series.points.length,
        total: Number(values.reduce((sum, value) => sum + value, 0).toFixed(2)),
        average: Number(
          (values.reduce((sum, value) => sum + value, 0) / Math.max(1, series.points.length)).toFixed(2),
        ),
      };
    });
  }, [analyticsMode, analyticsPlayerRows, analyticsRankingRows, analyticsTeamSeries]);

  const analyticsTableColumns = useMemo<AnalyticsTableColumn[]>(() => {
    if (analyticsMode === "player") {
      const columns: AnalyticsTableColumn[] = [
        { title: "War", dataIndex: "war_name", key: "war_name" },
        { title: "Date", dataIndex: "created_at", key: "created_at" },
        { title: "Result", dataIndex: "result", key: "result" },
      ];
      analyticsSelectedUsers.forEach((userId, userIndex) => {
        analyticsSelectedMetrics.forEach((metric, metricIndex) => {
          columns.push({
            title: `${userId} - ${getMetricLabel(metric)}`,
            dataIndex: `user${userIndex}_metric${metricIndex}`,
            key: `user${userIndex}_metric${metricIndex}`,
          });
        });
      });
      return columns;
    }
    if (analyticsMode === "rankings") {
      return [
        { title: "#", dataIndex: "rank", key: "rank" },
        { title: "Member", dataIndex: "user_id", key: "user_id" },
        { title: "Wars", dataIndex: "participation", key: "participation" },
        { title: "Score", dataIndex: "score", key: "score" },
      ];
    }
    return [
      { title: "Team", dataIndex: "team_name", key: "team_name" },
      { title: "Wars", dataIndex: "wars", key: "wars" },
      { title: "Total", dataIndex: "total", key: "total" },
      { title: "Average", dataIndex: "average", key: "average" },
    ];
  }, [analyticsMode, analyticsSelectedMetrics, analyticsSelectedUsers]);

  const analyticsFocusLabel = useMemo(() => {
    if (analyticsMode === "player") {
      return analyticsFocusedUser || "none";
    }
    if (analyticsMode === "compare") {
      return analyticsCompareUserIds.join(", ") || "none";
    }
    if (analyticsMode === "rankings") {
      return `${analyticsAggregation} • top ${analyticsTopN}`;
    }
    return analyticsSelectedTeams.join(", ") || "all teams";
  }, [
    analyticsAggregation,
    analyticsCompareUserIds,
    analyticsFocusedUser,
    analyticsMode,
    analyticsSelectedTeams,
    analyticsTopN,
  ]);

  const applyAnalyticsSelection = (nextSelection: string[]) => {
    const deduped = Array.from(new Set(nextSelection));
    if (deduped.length > ANALYTICS_SELECTION_HARD_CAP) {
      message.warning(`Selection is capped at ${ANALYTICS_SELECTION_HARD_CAP} members.`);
      setAnalyticsSelectedUsers(deduped.slice(0, ANALYTICS_SELECTION_HARD_CAP));
      return;
    }
    if (deduped.length > ANALYTICS_SELECTION_SOFT_CAP) {
      message.warning(`Large compare set (${deduped.length}) may reduce chart readability.`);
    }
    setAnalyticsSelectedUsers(deduped);
  };

  const handleLegendInteraction = (userId: string, event: MouseEvent<HTMLButtonElement>) => {
    if (event.altKey) {
      if (analyticsSelectedUsers.includes(userId)) {
        applyAnalyticsSelection(analyticsSelectedUsers.filter((item) => item !== userId));
      } else {
        applyAnalyticsSelection([...analyticsSelectedUsers, userId]);
      }
      return;
    }
    if (event.shiftKey) {
      const next = analyticsSelectedUsers.includes(userId)
        ? analyticsSelectedUsers
        : [...analyticsSelectedUsers, userId];
      applyAnalyticsSelection(next);
      return;
    }
    if (event.detail >= 2) {
      applyAnalyticsSelection([userId]);
      return;
    }
    if (analyticsSelectedUsers.length === 1 && analyticsSelectedUsers[0] === userId) {
      applyAnalyticsSelection([]);
      return;
    }
    applyAnalyticsSelection([userId]);
  };

  const copyAnalyticsSnapshot = async () => {
    const lines = [
      "Guild War Analytics",
      `Mode: ${analyticsMode}`,
      `Metric: ${analyticsMetricLabel}`,
      `Wars: ${analyticsWarsCount}`,
      `Focus: ${analyticsFocusLabel}`,
      ...analyticsTableRows
        .slice(0, 5)
        .map((row, index) => `${index + 1}. ${JSON.stringify(row)}`),
    ];
    await copyPlainText(lines.join("\n"));
    message.success("Analysis snapshot copied");
  };

  const copyAnalyticsCsv = async () => {
    const headers = analyticsTableColumns
      .map((column) => ("dataIndex" in column ? String(column.dataIndex) : column.key))
      .filter((value): value is string => Boolean(value));
    const lines = [headers.join(",")];
    for (const row of analyticsTableRows as Array<Record<string, unknown>>) {
      lines.push(
        headers
          .map((header) => {
            const value = row[header];
            const text = value === null || value === undefined ? "" : String(value);
            return `"${text.replaceAll("\"", "\"\"")}"`;
          })
          .join(","),
      );
    }
    await copyPlainText(lines.join("\n"));
    message.success("CSV copied to clipboard");
  };

  const handleAnalyticsDatePresetChange = (value: AnalyticsDatePreset) => {
    setAnalyticsDatePreset(value);
    if (value !== "all") {
      setAnalyticsSelectedWarIds([]);
    }
  };

  const saveHistoryMemberStats = async (updates: HistoryMemberStatsUpdate[]) => {
    if (!selectedHistoryId || updates.length === 0) {
      return;
    }
    await updateMemberStatsMutation.mutateAsync({
      historyId: selectedHistoryId,
      updates,
    });
  };
  useLoadWarningToast(
    warEventsQuery.isError ||
      selectedEventDetailQuery.isError ||
      activeQuery.isError ||
      templatesQuery.isError ||
      historyQuery.isError ||
      historyDetailQuery.isError ||
      analyticsQuery.isError ||
      analyticsDetailsQuery.isError,
    t("common:loadErrorRetry"),
  );

  return (
    <PageLayout title={t("title")} subtitle={t("subtitle")} icon={<IconSwords size={22} />} className="guild-war-page">
      <PageTabs
        destroyInactiveTabPane
        initialActiveKey={initialTabKey}
        items={[
          ...(!isExternalView
            ? [
                {
                  key: "active",
                  label: t("tab.active"),
            children: (
              <Space direction="vertical" style={{ display: "flex" }} size={12}>
                <Suspense fallback={<Card><Spin /></Card>}>
                  <LazyGuildWarActiveTopCard
                    selectedEventId={selectedEventId}
                    eventOptions={(warEventsQuery.data?.data ?? []).map((item) => ({
                      value: item.id,
                      label: `${item.title} (${formatDateTime(item.start_at)})`,
                    }))}
                    eventPlaceholder={t("active.event")}
                    onSelectedEventIdChange={setSelectedEventId}
                    canManage={canManageActive}
                    onInitTeams={() => initTeamsMutation.mutate()}
                    initTeamsPending={initTeamsMutation.isPending}
                    canInitTeams={Boolean(selectedEventId) && (selectedEventDetailQuery.data?.participants.length ?? 0) > 0}
                    onPostTeams={(platform) => {
                      if (!selectedEventId) return;
                      postTeamsMutation.mutate({ event_id: selectedEventId, platform });
                    }}
                    postTeamsPending={postTeamsMutation.isPending}
                    activeSearch={activeSearch}
                    onActiveSearchChange={setActiveSearch}
                    matchLabel={
                      matchedItemIds.length === 0
                        ? t("active.noMatches")
                        : t("active.matchLabel", { current: activeMatchIndex + 1, total: matchedItemIds.length })
                    }
                    onPrevMatch={() => setSearchJumpIndex((current) => current - 1)}
                    onNextMatch={() => setSearchJumpIndex((current) => current + 1)}
                    hasMatches={matchedItemIds.length > 0}
                    searchPlaceholder={t("active.searchPlaceholder")}
                    initTeamsLabel={t("active.initTeams")}
                    selectedTemplateId={selectedTemplateId}
                    templateOptions={templateOptions}
                    templatePlaceholder={t("active.template.placeholder")}
                    templateName={templateName}
                    templateNamePlaceholder={t("active.template.name")}
                    onTemplateNameChange={setTemplateName}
                    templateDescription={templateDescription}
                    templateDescriptionPlaceholder={t("active.template.description")}
                    onTemplateDescriptionChange={setTemplateDescription}
                    onSelectedTemplateIdChange={(value) => {
                      setSelectedTemplateId(value);
                      const selectedTemplate = (templatesQuery.data ?? []).find((template) => template.id === value);
                      if (!selectedTemplate) {
                        return;
                      }
                      setTemplateName(selectedTemplate.template_name);
                      setTemplateDescription(selectedTemplate.description ?? "");
                    }}
                    onSaveTemplate={() => createTemplateMutation.mutate()}
                    onApplyTemplate={() => applyTemplateMutation.mutate()}
                    onDeleteTemplate={() => deleteTemplateMutation.mutate()}
                    saveTemplateLabel={t("active.template.save")}
                    applyTemplateLabel={t("active.template.apply")}
                    deleteTemplateLabel={t("active.template.delete")}
                    templateSavePending={createTemplateMutation.isPending}
                    templateApplyPending={applyTemplateMutation.isPending}
                    templateDeletePending={deleteTemplateMutation.isPending}
                    templateActionDisabled={templateActionDisabled}
                  />
                </Suspense>

                {undoMove && undoRemainingSec > 0 ? (
                  <Alert color="infini-primary" variant="light">
                    <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                      <Text size="sm">
                        {undoMove.moves.length === 1
                          ? t("active.undo.single", { userId: undoMove.moves[0]?.userId ?? "-", to: undoMove.moves[0]?.to ?? "-", seconds: undoRemainingSec })
                          : t("active.undo.multi", { count: undoMove.moves.length, seconds: undoRemainingSec })}
                      </Text>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconX size={16} />}
                        onClick={() => {
                          setUndoMove(null);
                        }}
                      >
                        {t("active.undo.cancel")}
                      </Button>
                    </Group>
                  </Alert>
                ) : null}

                <Suspense fallback={<Card><Spin /></Card>}>
                  <LazyGuildWarDragBoard
                    dragColumns={dragColumns}
                    canDrag={canManageActive}
                    emptyText={t("empty")}
                    activePoolStatus={activePoolStatus}
                    selectedUserIds={selectedDragUserIdSet}
                    activeSearch={activeSearch}
                    activeDragItem={activeDragItem}
                    toMemberDomId={toMemberDomId}
                    sensors={sensors}
                    onSelectMember={handleSelectMember}
                    onOpenMember={canManageActive ? (userId) => setActiveDetailUserId(userId) : undefined}
                    onDragStart={handleDragStart}
                    onDragCancel={handleDragCancel}
                    onDragEnd={handleDragEnd}
                    teamStatusContentByContainerId={teamStatusContentByContainerId}
                  />
                </Suspense>

                <Suspense fallback={null}>
                  <LazyWarMemberDetailModal
                    open={Boolean(activeDetailUserId && activeDetail)}
                    activeDetailUserId={activeDetailUserId}
                    activeDetail={activeDetail}
                    onClose={() => setActiveDetailUserId(null)}
                  />
                </Suspense>
              </Space>
            ),
                },
              ]
            : []),
          {
            key: "history",
            label: t("tab.history"),
            children: (
              <Suspense
                fallback={
                  <Card>
                    <Spin />
                  </Card>
                }
              >
                <LazyWarHistoryTab
                  heading={sectionHeading(t("tab.history"))}
                  historyViewMode={historyViewMode}
                  onHistoryViewModeChange={setHistoryViewMode}
                  historyChartMetric={historyChartMetric}
                  onHistoryChartMetricChange={setHistoryChartMetric}
                  historyDateFrom={historyDateFrom}
                  historyDateTo={historyDateTo}
                  onHistoryDateFromChange={setHistoryDateFrom}
                  onHistoryDateToChange={setHistoryDateTo}
                  onClearDates={() => {
                    setHistoryDateFrom("");
                    setHistoryDateTo("");
                  }}
                  onExport={(format) => exportHistoryMutation.mutate(format)}
                  exportPending={exportHistoryMutation.isPending}
                  exportCsvLabel={t("history.export.csv")}
                  exportJsonLabel={t("history.export.json")}
                  canManage={canManageActive}
                  historyLoading={historyQuery.isLoading}
                  historyError={false}
                  historyRows={historyQuery.data?.data ?? []}
                  historyColumns={historyColumns}
                  onSelectHistoryId={setSelectedHistoryId}
                  historyDetailLoading={historyDetailQuery.isLoading}
                  historyDetailError={historyDetailQuery.isError}
                  historyDetail={historyDetailQuery.data ?? null}
                  historyMvp={historyMvp}
                  historyMissingSlotsByUserId={historyMissingSlotsByUserId}
                  onPostResults={(platform) => {
                    if (!historyDetailQuery.data) {
                      return;
                    }
                    postResultsMutation.mutate({
                      war_history_id: historyDetailQuery.data.id,
                      platform,
                    });
                  }}
                  postResultsPending={postResultsMutation.isPending}
                  onSaveMemberStats={saveHistoryMemberStats}
                  saveMemberStatsPending={updateMemberStatsMutation.isPending}
                  renderCounter={renderCounter}
                  historyDetailTitle={t("history.detail")}
                  historyResultLabel={t("history.result")}
                  loadErrorMessage={t("common:loadError")}
                  chartThemeName={chartThemeName}
                  chartPalette={chartPalette}
                  hashToPaletteColor={hashToPaletteColor}
                  getMetricLabel={getMetricLabel}
                  metricValueOrNullFromWarMember={metricValueOrNullFromWarMember}
                  echarts={echarts}
                  initialSearch={localStorage.getItem("guildWar.searchWarName") ?? undefined}
                />
              </Suspense>
            ),
          },
          {
            key: "analytics",
            label: t("tab.analytics"),
            children: (
              <Suspense
                fallback={
                  <Card>
                    <Spin />
                  </Card>
                }
              >
                <LazyGuildWarAnalyticsTab
                  mode={analyticsMode}
                  onModeChange={setAnalyticsMode}
                  selectedMetrics={analyticsSelectedMetrics}
                  onSelectedMetricsChange={setAnalyticsSelectedMetrics}
                  selectedWarIds={analyticsSelectedWarIds}
                  onSelectedWarIdsChange={setAnalyticsSelectedWarIds}
                  warOptions={analyticsWarOptions}
                  datePreset={analyticsDatePreset}
                  onDatePresetChange={handleAnalyticsDatePresetChange}
                  onCopySnapshot={copyAnalyticsSnapshot}
                  onCopyCsv={copyAnalyticsCsv}
                  isExternalView={isExternalView}
                  tableRows={analyticsTableRows as Array<Record<string, unknown>>}
                  focusedUser={analyticsFocusedUser}
                  onFocusedUserChange={setAnalyticsFocusedUser}
                  selectableUserIds={analyticsSelectableUserIds}
                  onlyParticipated={analyticsOnlyParticipated}
                  onOnlyParticipatedChange={setAnalyticsOnlyParticipated}
                  selectedUsers={analyticsSelectedUsers}
                  onSelectedUsersChange={applyAnalyticsSelection}
                  compareUserIds={analyticsCompareUserIds}
                  onLegendInteraction={handleLegendInteraction}
                  hashToPaletteColor={hashToPaletteColor}
                  chartPalette={chartPalette}
                  aggregation={analyticsAggregation}
                  onAggregationChange={setAnalyticsAggregation}
                  topN={analyticsTopN}
                  onTopNChange={setAnalyticsTopN}
                  minParticipation={analyticsMinParticipation}
                  onMinParticipationChange={setAnalyticsMinParticipation}
                  selectedTeams={analyticsSelectedTeams}
                  onSelectedTeamsChange={setAnalyticsSelectedTeams}
                  teamOptions={analyticsTeamOptions}
                  teamAggregation={analyticsTeamAggregation}
                  onTeamAggregationChange={setAnalyticsTeamAggregation}
                  selectionSoftCap={ANALYTICS_SELECTION_SOFT_CAP}
                  analyticsQueryLoading={analyticsQuery.isLoading}
                  analyticsQueryError={false}
                  analyticsDetailsLoading={analyticsDetailsQuery.isLoading}
                  analyticsDetailsError={false}
                  loadErrorMessage={t("common:loadError")}
                  metricLabel={analyticsMetricLabel}
                  echarts={echarts}
                  chartThemeName={chartThemeName}
                  chartOption={analyticsChartOption}
                  normEnabled={analyticsNormEnabled}
                  onNormEnabledChange={setAnalyticsNormEnabled}
                  modifierWeights={modifierWeights}
                  onModifierWeightsChange={setModifierWeights}
                  referenceDuration={referenceDuration}
                />
              </Suspense>
            ),
          },
        ]}
      />
    </PageLayout>
  );
}
