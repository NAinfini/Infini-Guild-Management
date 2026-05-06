import type { Event } from "@guild/shared";
import { activeGame } from "@guild/shared/games";
import { Grid, Skeleton, Stack } from "@mantine/core";
import { LayoutGridIcon } from "@portal/components/icons";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { differenceInHours } from "date-fns";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useExternalView } from "../../hooks/useExternalView";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { fetchEventDetailBatch, fetchEventsList, type EventDetailResponse } from "../../services/EventService";
import { fetchGuildWarHistory, fetchGuildWarHistoryBatch } from "../../services/GuildWarService";
import { queryKeys } from "../../api/query-keys";
import { fetchUsersList, fetchUsersStats } from "../../services/UserService";
import { useAuthStore } from "../../stores/auth";
import { buildEventWorkbenchSearch } from "../../utils/event-navigation";
import { PageLayout } from "../layout/PageLayout";
import {
  type DashboardLastWarMvp,
  type DashboardUpcomingEventRow,
} from "../dashboard/shared";
import { ActiveMembersCard } from "../dashboard/ActiveMembersCard";
import { LastWarCard } from "../dashboard/LastWarCard";
import { MySignupsCard } from "../dashboard/MySignupsCard";
import { UpcomingEventsCard } from "../dashboard/UpcomingEventsCard";
import "./DashboardPage.css";

/**
 * Module-level timestamp that survives component unmount/remount.
 * Rounded to 5-minute bucket so query keys stay stable across navigations.
 * Refreshed when the bucket boundary is crossed.
 */
let _dashboardNow: Date | null = null;
let _dashboardNowBucket = -1;
export const DASHBOARD_EVENTS_REFETCH_INTERVAL_MS = 60_000;

function getDashboardNow(): Date {
  const bucket = Math.floor(Date.now() / (5 * 60_000));
  if (!_dashboardNow || bucket !== _dashboardNowBucket) {
    const d = new Date();
    d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
    _dashboardNow = d;
    _dashboardNowBucket = bucket;
  }
  return _dashboardNow;
}

export function buildDashboardUpcomingEventsQueryParams(now: Date): Parameters<typeof fetchEventsList>[0] {
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + 7);

  return {
    page: 1,
    limit: 20,
    archived: false,
    start_after: now.toISOString(),
    start_before: end.toISOString(),
  };
}

function buildUpcomingEventRow(
  item: Event,
  source: Event[],
  now: Date,
  upcomingEventDetailById: Map<string, EventDetailResponse>,
  participantsByEventId: Map<
    string,
    { user: Awaited<ReturnType<typeof fetchUsersList>>["data"][number]["user"]; profile: Awaited<ReturnType<typeof fetchUsersList>>["data"][number]["profile"] }[]
  >,
  currentUserId: string | undefined,
): DashboardUpcomingEventRow {
  const startsAt = new Date(item.start_at);
  const endsAt = item.end_at ? new Date(item.end_at) : startsAt;
  const startsSoon = differenceInHours(startsAt, now) <= 6 && differenceInHours(startsAt, now) >= 0;
  const hasConflict = source.some((peer) => {
    if (peer.id === item.id) return false;
    const peerStart = new Date(peer.start_at);
    const peerEnd = peer.end_at ? new Date(peer.end_at) : peerStart;
    return startsAt < peerEnd && peerStart < endsAt;
  });
  const detail = upcomingEventDetailById.get(item.id);
  const participants = detail?.participants ?? [];
  const joined = Boolean(currentUserId && participants.some((participant) => participant.user_id === currentUserId));
  const participantCount = participants.length;
  const capacityLabel = item.capacity === null ? `${participantCount}/∞` : `${participantCount}/${item.capacity}`;
  const isFull = item.capacity !== null && participantCount >= item.capacity;

  return {
    item,
    startsSoon,
    hasConflict,
    members: participantsByEventId.get(item.id) ?? [],
    joined,
    capacityLabel,
    isFull,
  };
}

export function DashboardPage() {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const isExternalView = useExternalView();
  const now = useMemo(() => getDashboardNow(), []);
  const nowIso = now.toISOString();

  const upcomingEventsQuery = useQuery({
    queryKey: queryKeys.dashboard.upcomingEvents(nowIso),
    queryFn: () => fetchEventsList(buildDashboardUpcomingEventsQueryParams(now)),
    staleTime: DASHBOARD_EVENTS_REFETCH_INTERVAL_MS,
    refetchInterval: DASHBOARD_EVENTS_REFETCH_INTERVAL_MS,
    placeholderData: keepPreviousData,
  });

  const recentWarCount = 4;

  const warQuery = useQuery({
    queryKey: queryKeys.dashboard.wars(),
    queryFn: () =>
      fetchGuildWarHistory({
        page: 1,
        limit: 10,
      }),
    staleTime: 10 * 60_000,
  });

  const usersQuery = useQuery({
    queryKey: queryKeys.users.all,
    queryFn: fetchUsersList,
    staleTime: 10 * 60_000,
  });

  const usersStatsQuery = useQuery({
    queryKey: queryKeys.users.stats(),
    queryFn: fetchUsersStats,
    staleTime: 10 * 60_000,
  });

  const recentWars = useMemo(
    () => (warQuery.data?.data ?? []).slice(0, recentWarCount),
    [warQuery.data?.data],
  );
  const recentWarIds = recentWars.map((w) => w.id);

  const recentWarDetailsQuery = useQuery({
    queryKey: queryKeys.dashboard.lastWarDetail(recentWarIds.join(",") || "none"),
    enabled: recentWarIds.length > 0,
    queryFn: async () => {
      const res = await fetchGuildWarHistoryBatch(recentWarIds);
      return res.data;
    },
  });

  const upcomingEventDetailsQuery = useQuery({
    queryKey: queryKeys.dashboard.upcomingEventDetails(
      upcomingEventsQuery.data?.data.map((item) => item.id).join(",") ?? "",
    ),
    enabled: Boolean(upcomingEventsQuery.data) && Boolean(usersQuery.data),
    queryFn: async () => {
      const eventIds = (upcomingEventsQuery.data?.data ?? []).map((item) => item.id);
      if (eventIds.length === 0) return [];
      const res = await fetchEventDetailBatch(eventIds);
      return res.data;
    },
  });

  const upcomingEvents = upcomingEventsQuery.data?.data ?? [];
  const users = usersQuery.data?.data ?? [];
  const activeMemberCount = usersStatsQuery.data?.active_members ?? 0;
  const totalMembersCount = usersStatsQuery.data?.total_members ?? 0;
  const activeEventsCount = upcomingEvents.length;

  const upcomingEventDetailById = useMemo(
    () => new Map((upcomingEventDetailsQuery.data ?? []).map((detail) => [detail.id, detail])),
    [upcomingEventDetailsQuery.data],
  );

  const mySignupEvents = useMemo(() => {
    if (!user?.id) return [];
    return (upcomingEventDetailsQuery.data ?? [])
      .filter((detail) => detail.participants.some((p) => p.user_id === user.id))
      .map((detail) => ({
        event: detail as Event,
        participantCount: detail.participants.length,
      }));
  }, [upcomingEventDetailsQuery.data, user?.id]);

  const allWarWinRate = useMemo(() => {
    const history = warQuery.data?.data ?? [];
    const resolvedWars = history.filter((entry) => Boolean(entry.result));
    if (resolvedWars.length === 0) {
      return 0;
    }
    const winCount = resolvedWars.filter((entry) => entry.result === "win").length;
    return (winCount / resolvedWars.length) * 100;
  }, [warQuery.data?.data]);

  const userRowById = useMemo(
    () => new Map(users.map((entry) => [entry.user.id, entry])),
    [users],
  );

  const recentWarMvps = useMemo<DashboardLastWarMvp[]>(() => {
    const details = recentWarDetailsQuery.data ?? [];
    const resolveName = (userId: string) => {
      const row = userRowById.get(userId);
      return row?.user.username ?? userId;
    };
    const initials = (userId: string) => {
      const name = resolveName(userId);
      return name.slice(0, 2).toUpperCase();
    };
    const mvpCategories = activeGame.war.mvpCategories;
    return details.map((detail) => {
      const stats = detail.member_stats ?? [];
      if (stats.length === 0) return null;
      return mvpCategories.map((category) => {
        let top = stats[0];
        for (let i = 1; i < stats.length; i++) {
          if ((stats[i].stats?.[category] ?? 0) > (top.stats?.[category] ?? 0)) {
            top = stats[i];
          }
        }
        return {
          category,
          label: t(`card.lastWar.mvp.${category}`),
          name: resolveName(top.user_id),
          initials: initials(top.user_id),
          value: top.stats?.[category] ?? 0,
        };
      });
    });
  }, [recentWarDetailsQuery.data, userRowById, t]);

  const participantsByEventId = useMemo(() => {
    const map = new Map<string, { user: (typeof users)[number]["user"]; profile: (typeof users)[number]["profile"] }[]>();
    for (const detail of upcomingEventDetailsQuery.data ?? []) {
      const members = detail.participants
        .map((participant) => userRowById.get(participant.user_id))
        .filter((entry): entry is (typeof users)[number] => Boolean(entry))
        .map((entry) => ({ user: entry.user, profile: entry.profile }));
      map.set(detail.id, members);
    }
    return map;
  }, [upcomingEventDetailsQuery.data, userRowById]);

  const featuredEventRows = useMemo<DashboardUpcomingEventRow[]>(() => {
    return upcomingEvents
      .filter((item) => item.pinned)
      .map((item) =>
        buildUpcomingEventRow(
          item,
          upcomingEvents,
          now,
          upcomingEventDetailById,
          participantsByEventId,
          user?.id,
        ),
      );
  }, [now, participantsByEventId, upcomingEventDetailById, upcomingEvents, user?.id]);

  const upcomingEventRows = useMemo<DashboardUpcomingEventRow[]>(() => {
    return upcomingEvents
      .filter((item) => !item.pinned)
      .map((item) =>
        buildUpcomingEventRow(
          item,
          upcomingEvents,
          now,
          upcomingEventDetailById,
          participantsByEventId,
          user?.id,
        ),
      )
      .slice(0, 3);
  }, [now, participantsByEventId, upcomingEventDetailById, upcomingEvents, user?.id]);

  const openEventDetail = (event: Pick<Event, "id" | "title">) => {
    void navigate({
      to: "/events",
      search: buildEventWorkbenchSearch(event),
    });
  };

  const isUsersLoading = usersQuery.isLoading || usersStatsQuery.isLoading;
  const isWarLoading = warQuery.isLoading;
  const isEventsLoading = upcomingEventsQuery.isLoading;

  const hasError =
    upcomingEventsQuery.isError ||
    warQuery.isError ||
    usersQuery.isError ||
    usersStatsQuery.isError ||
    upcomingEventDetailsQuery.isError ||
    recentWarDetailsQuery.isError;
  useLoadWarningToast(hasError, t("common:loadErrorRetry"));

  return (
    <PageLayout
      title={t("title")}
      subtitle={t("welcome", { name: user?.username ?? t("welcomeFallback") })}
      icon={<LayoutGridIcon size={22} />}
      className="dashboard-page"
    >
      <Grid gutter={16} align="flex-start">
        <Grid.Col span={{ base: 12, xl: "auto" }}>
          <Stack gap={16}>
            {!isExternalView && (
              <Skeleton visible={isEventsLoading} radius={8}>
                <MySignupsCard
                  mySignupEvents={mySignupEvents}
                  now={now}
                  onOpenEvent={openEventDetail}
                />
              </Skeleton>
            )}

            <Skeleton visible={isEventsLoading} radius={8}>
              <UpcomingEventsCard
                upcomingEventsCount={upcomingEvents.length}
                featuredRows={featuredEventRows}
                rows={upcomingEventRows}
                onOpenEvent={openEventDetail}
              />
            </Skeleton>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, xl: isExternalView ? 6 : 4 }}>
          <Stack gap={16}>
            <Skeleton visible={isUsersLoading || isWarLoading} radius={8}>
              <ActiveMembersCard
                activeMemberCount={activeMemberCount}
                totalMembersCount={totalMembersCount}
                allWarWinRate={allWarWinRate}
                activeEventsCount={activeEventsCount}
              />
            </Skeleton>

            <Skeleton visible={isWarLoading} radius={8}>
              <LastWarCard
                recentWars={recentWars}
                warMvps={recentWarMvps}
                isExternalView={isExternalView}
                onOpenHistory={(warName) => {
                  void navigate({
                    to: "/guild-war",
                    search: {
                      tab: "history",
                      warName,
                    },
                  });
                }}
              />
            </Skeleton>
          </Stack>
        </Grid.Col>
      </Grid>
    </PageLayout>
  );
}
