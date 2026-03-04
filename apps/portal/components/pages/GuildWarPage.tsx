import { hasRoleAtLeast } from "@guild/shared";
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
import { InfiniNumberTicker } from "@infini-dev-kit/frontend/components";
import { Alert, Button, Card, Group, Loader, Stack, Tabs, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { Suspense, lazy, useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
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
import { isApiRequestError } from "../../api/client";
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
import { portalConfirm } from "../../overlays";
import { useAuthStore } from "../../stores/auth";
import { copyPlainText } from "../../utils/copy";
import { PageLayout } from "../layout/PageLayout";
import type { HistoryColumn, HistorySummaryRow } from "../feature/guild-war/WarHistoryTab";
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
const LazyGuildWarMoveMemberCard = lazy(() =>
  import("../feature/guild-war/GuildWarMoveMemberCard").then((mod) => ({ default: mod.GuildWarMoveMemberCard })),
);
const LazyGuildWarRoleTagsCard = lazy(() =>
  import("../feature/guild-war/GuildWarRoleTagsCard").then((mod) => ({ default: mod.GuildWarRoleTagsCard })),
);
const LazyGuildWarTeamSetupCard = lazy(() =>
  import("../feature/guild-war/GuildWarTeamSetupCard").then((mod) => ({ default: mod.GuildWarTeamSetupCard })),
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
  return <InfiniNumberTicker value={value ?? 0} />;
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
  pinnedRoles?: Partial<Record<PinnedRoleKey, string>>;
};

type MovePayload = {
  event_id: string;
  user_id: string;
  to: string;
  from?: string;
  etag?: string;
  undoing?: boolean;
};

type PinnedRoleKey = "dps" | "heal" | "tank" | "lead";

const ROLE_TAG_PRESETS = ["tank", "dps", "healer", "support", "shotcaller", "flex"] as const;
const ANALYTICS_SELECTION_SOFT_CAP = 10;
const ANALYTICS_SELECTION_HARD_CAP = 20;

const message = {
  success: (content: string) => notifications.show({ color: "green", message: content }),
  warning: (content: string) => notifications.show({ color: "yellow", message: content }),
  info: (content: string) => notifications.show({ color: "blue", message: content }),
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

function normalizePinnedRoleTag(value: string | null | undefined): PinnedRoleKey | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "dps") {
    return "dps";
  }
  if (normalized === "heal" || normalized === "healer" || normalized === "healing") {
    return "heal";
  }
  if (normalized === "tank") {
    return "tank";
  }
  if (normalized === "lead" || normalized === "leader" || normalized === "shotcaller") {
    return "lead";
  }
  return null;
}

function pinnedRoleToTag(role: PinnedRoleKey): string {
  if (role === "heal") {
    return "healer";
  }
  if (role === "lead") {
    return "lead";
  }
  return role;
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
  const [historyViewMode, setHistoryViewMode] = useState<"table" | "chart">("table");
  const [historyChartMetric, setHistoryChartMetric] = useState<AnalyticsMetricKey>("damage");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");

  // Check localStorage for war search navigation from dashboard
  const initialTabKey = useMemo(() => {
    const searchWarName = localStorage.getItem("guildWar.searchWarName");
    if (searchWarName) {
      return "history";
    }
    return undefined;
  }, []);
  const {
    selectedMoveUserId,
    setSelectedMoveUserId,
    selectedMoveTarget,
    setSelectedMoveTarget,
    selectedRoleUserId,
    setSelectedRoleUserId,
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
  const activePoolStatus = null;

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
            team_name: "Alpha",
            sort_order: 0,
            members: alpha.map((member, index) => ({
              user_id: member.user_id,
              sort_order: index,
            })),
          },
          {
            team_name: "Bravo",
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

  const moveMutation = useMutation({
    mutationFn: (payload: MovePayload) =>
      moveGuildWarMember({
        event_id: payload.event_id,
        user_id: payload.user_id,
        to: payload.to,
        etag: payload.etag,
      }),
    onSuccess: async () => {
      message.success(t("message.memberMoved"));
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.active(selectedEventId ?? "none"),
      });
    },
    onError: async (error) => {
      if (isApiRequestError(error) && error.status === 409) {
        const shouldRefresh = await portalConfirm({
          title: t("confirm.conflict.title"),
          description: t("confirm.conflict.description"),
          intent: "warning",
        });
        if (shouldRefresh) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.guildWar.active(selectedEventId ?? "none"),
          });
        }
        return;
      }
      showError(error, t("message.memberMoveFailed"));
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
            : `Moved ${pendingMove.moves.length} members`,
        );
      } catch (error) {
        showError(error, pendingMove.moves.length > 1 ? "Batch move commit failed" : t("message.memberMoveFailed"));
      }
    };
    void commitQueuedMoves();
  }, [activeQuery.data?.etag, queryClient, selectedEventId, showError, t, undoMove, undoRemainingSec]);

  const roleTagMutation = useMutation({
    mutationFn: updateGuildWarRoleTag,
    onSuccess: async () => {
      message.success("Role tag updated");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.active(selectedEventId ?? "none"),
      });
    },
    onError: (error) => {
      showError(error, "Failed to update role tag");
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
      userId,
      payload,
    }: {
      historyId: string;
      userId: string;
      payload: Record<string, unknown>;
    }) => updateGuildWarMemberStats(historyId, userId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.historyDetail(selectedHistoryId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.analyticsDetailsAll(),
      });
    },
    onError: (error) => {
      showError(error, "Failed to update member stat");
    },
  });

  const saveTeamsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEventId) {
        throw new Error("Missing event id");
      }

      return saveGuildWarTeams({
        event_id: selectedEventId,
        teams: orderedTeams.map((team, teamIndex) => {
          const isLocked = teamDraftLocks[team.id] ?? team.is_locked;
          const nextName = (teamDraftNames[team.id] ?? team.team_name).trim();
          const nextNotes = (teamDraftNotes[team.id] ?? team.notes ?? "").trim();
          return {
            team_name: nextName.length > 0 ? nextName : team.team_name,
            sort_order: teamIndex,
            notes: nextNotes.length > 0 ? nextNotes : undefined,
            is_locked: isLocked,
            members: team.members.map((member, memberIndex) => ({
              user_id: member.user_id,
              role_tag: member.role_tag ?? undefined,
              sort_order: memberIndex,
            })),
          };
        }),
        pool_members: pool.map((member) => ({ user_id: member.userId })),
      });
    },
    onSuccess: async () => {
      message.success("Guild war team layout saved");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.active(selectedEventId ?? "none"),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.historyAll(),
      });
    },
    onError: (error) => {
      showError(error, "Failed to save team layout");
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

  const moveCandidates = [
    ...orderedTeams.flatMap((team) =>
      team.members.map((member) => ({
        value: member.user_id,
        label: `${member.user_id} (${team.team_name})`,
      })),
    ),
    ...pool.map((member) => ({
      value: member.userId,
      label: `${member.userId} (Pool)`,
    })),
  ];

  const moveTargetOptions = [
    { value: "pool", label: "Pool" },
    ...orderedTeams.map((team) => ({
      value: team.id,
      label: (teamDraftNames[team.id] ?? team.team_name).trim() || team.team_name,
    })),
  ];
  const lockedTeamIds = useMemo(
    () =>
      new Set(
        orderedTeams
          .filter((team) => teamDraftLocks[team.id] ?? team.is_locked)
          .map((team) => team.id),
      ),
    [orderedTeams, teamDraftLocks],
  );
  const activeTeamMembers = orderedTeams.flatMap((team) => team.members);
  const selectedRoleMember = activeTeamMembers.find((member) => member.user_id === selectedRoleUserId) ?? null;
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
      pinnedRoles: team.members.reduce<Partial<Record<PinnedRoleKey, string>>>((acc, member) => {
        const role = normalizePinnedRoleTag(member.role_tag);
        if (!role) {
          return acc;
        }
        if (!acc[role]) {
          acc[role] = member.user_id;
        }
        return acc;
      }, {}),
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
  const selectedMoveSource = selectedMoveUserId
    ? memberContainerMap.get(`member:${selectedMoveUserId}`) ?? undefined
    : undefined;
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
      message.warning("A move is already queued. Cancel it or wait for commit.");
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
      message.info(`Queued move ${onlyMove.userId}: ${onlyMove.from} -> ${onlyMove.to}. Auto-commit in 5s.`);
      return;
    }
    message.info(`Queued ${normalizedMoves.length} members for move. Auto-commit in 5s.`);
  };

  const handleAssignPinnedRole = (containerId: string, role: PinnedRoleKey, userId: string | null) => {
    if (!canManageActive || !selectedEventId || containerId === "pool") {
      return;
    }
    if (lockedTeamIds.has(containerId)) {
      message.warning("Team is locked");
      return;
    }
    const team = orderedTeams.find((item) => item.id === containerId);
    if (!team) {
      return;
    }

    const targetTag = pinnedRoleToTag(role);
    const currentPinned = team.members.find((member) => normalizePinnedRoleTag(member.role_tag) === role) ?? null;

    void (async () => {
      try {
        if (currentPinned && currentPinned.user_id !== userId) {
          await roleTagMutation.mutateAsync({
            event_id: selectedEventId,
            user_id: currentPinned.user_id,
            role_tag: null,
          });
        }
        if (userId) {
          const currentForUser = team.members.find((member) => member.user_id === userId) ?? null;
          if (!currentForUser || currentForUser.role_tag !== targetTag) {
            await roleTagMutation.mutateAsync({
              event_id: selectedEventId,
              user_id: userId,
              role_tag: targetTag,
            });
          }
        }
      } catch (error) {
        showError(error, "Failed to update pinned role");
      }
    })();
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

  const historyColumns: HistoryColumn<HistorySummaryRow>[] = [
    {
      title: t("history.table.name"),
      dataIndex: "war_name",
      key: "war_name",
    },
    {
      title: "Enemy",
      dataIndex: "enemy_name",
      key: "enemy_name",
      render: (value) => (typeof value === "string" && value ? value : "-"),
    },
    {
      title: t("history.table.result"),
      dataIndex: "result",
      key: "result",
      render: (value) => (typeof value === "string" ? value : "-"),
    },
    {
      title: t("history.table.kills"),
      key: "kills",
      render: (_, row) => `${row.own_kills ?? 0} / ${row.enemy_kills ?? 0}`,
    },
    {
      title: t("history.table.date"),
      dataIndex: "created_at",
      key: "created_at",
      render: (value) => (typeof value === "string" ? formatDateTime(value) : "-"),
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

  const analyticsCompareSummaryRows = useMemo(() => {
    return analyticsCompareUserIds
      .map((userId) => {
        const values = analyticsTimeline
          .map((war) => {
            const member = war.member_stats.find((item) => item.user_id === userId);
            if (!member) {
              return null;
            }
            return metricValueFromWarMember(member, analyticsMetric);
          })
          .filter((value): value is number => value !== null);
        if (values.length === 0) {
          return null;
        }
        const total = values.reduce((sum, value) => sum + value, 0);
        return {
          key: userId,
          user_id: userId,
          participation: values.length,
          total: Number(total.toFixed(2)),
          average: Number((total / values.length).toFixed(2)),
          best: Math.max(...values),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((left, right) => right.total - left.total);
  }, [analyticsCompareUserIds, analyticsMetric, analyticsTimeline]);

  const analyticsRankingRows = useMemo(() => {
    const valuesByUser = new Map<string, number[]>();
    for (const war of analyticsTimeline) {
      for (const member of war.member_stats) {
        const current = valuesByUser.get(member.user_id) ?? [];
        current.push(metricValueFromWarMember(member, analyticsMetric));
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
  }, [analyticsAggregation, analyticsMetric, analyticsMinParticipation, analyticsTimeline, analyticsTopN]);

  const analyticsTeamSeries = useMemo(() => {
    const seriesMap = new Map<string, Array<{ warId: string; warName: string; value: number }>>();
    for (const war of analyticsTimeline) {
      for (const team of war.teams) {
        if (analyticsSelectedTeams.length > 0 && !analyticsSelectedTeams.includes(team.team_name)) {
          continue;
        }
        const values = team.members.map((member) => metricValueFromWarMember(member, analyticsMetric));
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
  }, [analyticsMetric, analyticsSelectedTeams, analyticsTeamAggregation, analyticsTimeline]);

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
          row[`user${userIndex}_metric${metricIndex}`] = member ? metricValueOrNullFromWarMember(member, metric) : null;
        });
      });
      return row;
    });
  }, [analyticsSelectedUsers, analyticsSelectedMetrics, analyticsTimeline]);

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

  const commitHistoryMemberMetric = (
    userId: string,
    key:
      | "kills"
      | "deaths"
      | "assists"
      | "damage"
      | "healing"
      | "building_damage"
      | "credits"
      | "damage_taken",
    value: number,
  ) => {
    if (!selectedHistoryId) {
      return;
    }
    if (!Number.isFinite(value)) {
      return;
    }
    updateMemberStatsMutation.mutate({
      historyId: selectedHistoryId,
      userId,
      payload: {
        [key]: Math.max(0, Math.floor(value)),
      },
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
    <PageLayout title={t("title")} subtitle="Guild War Modules" className="guild-war-page">
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
                        ? "No matches"
                        : `Match ${activeMatchIndex + 1} / ${matchedItemIds.length}`
                    }
                    onPrevMatch={() => setSearchJumpIndex((current) => current - 1)}
                    onNextMatch={() => setSearchJumpIndex((current) => current + 1)}
                    hasMatches={matchedItemIds.length > 0}
                    searchPlaceholder="Search user / role / stats"
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
                  <Alert color="blue" variant="light">
                    <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                      <Text size="sm">
                        {undoMove.moves.length === 1
                          ? `Queued ${undoMove.moves[0]?.userId ?? "-"} -> ${undoMove.moves[0]?.to ?? "-"}. Commit in ${undoRemainingSec}s`
                          : `Queued ${undoMove.moves.length} members. Commit in ${undoRemainingSec}s`}
                      </Text>
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => {
                          setUndoMove(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </Group>
                  </Alert>
                ) : null}

                {canManageActive ? (
                  <div className="guild-war-active-controls-row">
                    <Suspense fallback={<Card><Spin /></Card>}>
                      <LazyGuildWarMoveMemberCard
                      title={t("active.moveMember")}
                      selectedMoveUserId={selectedMoveUserId}
                      selectedMoveTarget={selectedMoveTarget}
                      moveCandidates={moveCandidates}
                      moveTargetOptions={moveTargetOptions}
                      memberPlaceholder={t("active.member")}
                      targetPlaceholder={t("active.target")}
                      moveLabel={t("active.move")}
                      movePending={moveMutation.isPending}
                      moveDisabled={!selectedMoveUserId || !selectedMoveTarget || !selectedEventId || Boolean(undoMove)}
                      onSelectedMoveUserIdChange={setSelectedMoveUserId}
                      onSelectedMoveTargetChange={setSelectedMoveTarget}
                      onMove={() => {
                        if (!selectedEventId || !selectedMoveUserId || !selectedMoveTarget) {
                          return;
                        }
                        if (selectedMoveTarget !== "pool" && lockedTeamIds.has(selectedMoveTarget)) {
                          message.warning("Target team is locked");
                          return;
                        }
                        queueMoveWithUndo([
                          {
                            event_id: selectedEventId,
                            user_id: selectedMoveUserId,
                            to: selectedMoveTarget,
                            from: selectedMoveSource,
                            etag: activeQuery.data?.etag ?? undefined,
                          },
                        ]);
                      }}
                    />
                  </Suspense>

                  <Suspense fallback={<Card><Spin /></Card>}>
                    <LazyGuildWarRoleTagsCard
                      selectedRoleUserId={selectedRoleUserId}
                      selectedRoleMember={selectedRoleMember}
                      activeTeamMembers={activeTeamMembers}
                      roleTagPresets={ROLE_TAG_PRESETS}
                      canAssignRoleTag={Boolean(selectedEventId && selectedRoleUserId)}
                      roleTagPending={roleTagMutation.isPending}
                      onSelectedRoleUserIdChange={setSelectedRoleUserId}
                      onAssignRoleTag={(tag) => {
                        if (!selectedEventId || !selectedRoleUserId) {
                          return;
                        }
                        roleTagMutation.mutate({
                          event_id: selectedEventId,
                          user_id: selectedRoleUserId,
                          role_tag: tag,
                        });
                      }}
                    />
                  </Suspense>
                  </div>
                ) : null}

                {canManageActive ? (
                  <Suspense fallback={<Card><Spin /></Card>}>
                    <LazyGuildWarTeamSetupCard
                      teams={orderedTeams}
                      teamDraftNames={teamDraftNames}
                      teamDraftNotes={teamDraftNotes}
                      teamDraftLocks={teamDraftLocks}
                      savePending={saveTeamsMutation.isPending}
                      saveDisabled={!selectedEventId || orderedTeams.length === 0}
                      onTeamLockChange={(teamId, checked) =>
                        setTeamDraftLocks((current) => ({
                          ...current,
                          [teamId]: checked,
                        }))
                      }
                      onTeamNameChange={(teamId, value) =>
                        setTeamDraftNames((current) => ({
                          ...current,
                          [teamId]: value,
                        }))
                      }
                      onTeamNotesChange={(teamId, value) =>
                        setTeamDraftNotes((current) => ({
                          ...current,
                          [teamId]: value,
                        }))
                      }
                      onMoveTeamOrder={moveTeamOrder}
                      onCopyTeamLabel={(teamId, draftName) => {
                        const team = orderedTeams.find((item) => item.id === teamId);
                        if (!team) {
                          return;
                        }
                        const teamLabel = draftName.trim() || team.team_name;
                        const mentions = team.members.map((member) => `@${member.user_id}`).join(", ");
                        void copyPlainText(`${teamLabel}: ${mentions}`);
                        message.success("Team mentions copied");
                      }}
                      onSaveTeams={() => saveTeamsMutation.mutate()}
                    />
                  </Suspense>
                ) : null}
                <Suspense fallback={<Card><Spin /></Card>}>
                  <LazyGuildWarDragBoard
                    dragColumns={dragColumns}
                    canDrag={canManageActive}
                    emptyText={t("empty")}
                    activePoolStatus={activePoolStatus}
                    selectedUserIds={selectedDragUserIdSet}
                    activeSearch={activeSearch}
                    selectedCount={selectedDragUserIds.length}
                    selectionHint={`Selected: ${selectedDragUserIds.length} member(s). Ctrl/Shift + click to multi-select, then drag one selected card.`}
                    activeDragItem={activeDragItem}
                    toMemberDomId={toMemberDomId}
                    sensors={sensors}
                    onSelectMember={handleSelectMember}
                    onOpenMember={canManageActive ? (userId) => setActiveDetailUserId(userId) : undefined}
                    onAssignPinnedRole={canManageActive ? handleAssignPinnedRole : undefined}
                    onDragStart={handleDragStart}
                    onDragCancel={handleDragCancel}
                    onDragEnd={handleDragEnd}
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
                  onCommitMemberMetric={commitHistoryMemberMetric}
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
                />
              </Suspense>
            ),
          },
        ]}
      />
    </PageLayout>
  );
}

