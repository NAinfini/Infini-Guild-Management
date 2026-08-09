import type { Event } from "@guild/shared";
import { Button, Grid, Skeleton, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMediaQuery } from "@mantine/hooks";
import { differenceInHours } from "date-fns";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useExternalView } from "../../hooks/useExternalView";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import {
  dashboardQueryKeys,
  fetchDashboardEvents,
  fetchDashboardMemberStats,
  fetchDashboardWars,
  type DashboardEvent,
} from "../../services/DashboardService";
import { useAuthStore } from "../../stores/auth";
import { useSiteConfigStore } from "../../stores/site-config";
import { buildEventWorkbenchSearch } from "../../utils/event-navigation";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import {
  type DashboardLastWarMvp,
  type DashboardMember,
  type DashboardUpcomingEventRow,
  orderDashboardUpcomingRows,
} from "../dashboard/shared";
import { summariseEventClassQuotas } from "../feature/events/class-quota-view";
import { ActiveMembersCard } from "../dashboard/ActiveMembersCard";
import { LastWarCard } from "../dashboard/LastWarCard";
import { MySignupsCard } from "../dashboard/MySignupsCard";
import { UpcomingEventsCard } from "../dashboard/UpcomingEventsCard";
import "./DashboardPage.css";

export const DASHBOARD_EVENTS_REFETCH_INTERVAL_MS = 60_000;
export const DASHBOARD_MOBILE_MEDIA_QUERY = "(max-width: 47.99em)";

export function roundDashboardNow(value = new Date()): Date {
  const rounded = new Date(value);
  rounded.setMinutes(Math.floor(rounded.getMinutes() / 5) * 5, 0, 0);
  return rounded;
}

export function participantToDashboardMember(participant: DashboardEvent["participants"][number]): DashboardMember {
  return {
    user: {
      id: participant.user_id,
      username: participant.username,
    },
    profile: {
      power: participant.power,
      classes: participant.classes,
      avatar_media_id: participant.avatar_media_id,
    },
  };
}

function buildUpcomingEventRow(
  item: DashboardEvent,
  source: DashboardEvent[],
  now: Date,
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
  const participantCount = item.participants.length;
  const joined = Boolean(currentUserId && item.participants.some((participant) => participant.user_id === currentUserId));
  const capacityLabel = item.capacity === null ? `${participantCount}/∞` : `${participantCount}/${item.capacity}`;

  const members = item.participants.map(participantToDashboardMember);

  return {
    item,
    startsSoon,
    hasConflict,
    members,
    joined,
    capacityLabel,
    isFull: item.capacity !== null && participantCount >= item.capacity,
    quotaSummary: summariseEventClassQuotas(item, members),
  };
}

export { orderDashboardUpcomingRows } from "../dashboard/shared";

export function DashboardPage() {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const eventsEnabled = useSiteConfigStore((state) => state.features.events);
  const guildWarEnabled = useSiteConfigStore((state) => state.features.guildWar);
  const isExternalView = useExternalView();
  const isMobileDashboard = useMediaQuery(DASHBOARD_MOBILE_MEDIA_QUERY) ?? false;

  const memberStatsQuery = useQuery({
    queryKey: dashboardQueryKeys.members(),
    queryFn: fetchDashboardMemberStats,
    staleTime: DASHBOARD_EVENTS_REFETCH_INTERVAL_MS,
  });
  const eventsQuery = useQuery({
    queryKey: dashboardQueryKeys.events(user?.id ?? "guest", isExternalView),
    queryFn: () => fetchDashboardEvents({ externalView: isExternalView }),
    enabled: eventsEnabled,
    staleTime: DASHBOARD_EVENTS_REFETCH_INTERVAL_MS,
    refetchInterval: DASHBOARD_EVENTS_REFETCH_INTERVAL_MS,
  });
  const warsQuery = useQuery({
    queryKey: dashboardQueryKeys.wars(),
    queryFn: fetchDashboardWars,
    enabled: guildWarEnabled,
    staleTime: DASHBOARD_EVENTS_REFETCH_INTERVAL_MS,
  });

  const now = useMemo(() => roundDashboardNow(), [eventsQuery.dataUpdatedAt]);
  const featuredEvents = eventsQuery.data?.featured_events ?? [];
  const upcomingEvents = eventsQuery.data?.upcoming_events ?? [];
  const dashboardEvents = useMemo(
    () => [...featuredEvents, ...upcomingEvents],
    [featuredEvents, upcomingEvents],
  );
  const recentWars = warsQuery.data?.recent_wars ?? [];

  const mySignupEvents = useMemo(() => {
    const mySignupIds = new Set(eventsQuery.data?.my_signup_event_ids ?? []);
    return dashboardEvents
      .filter((event) => mySignupIds.has(event.id))
      .map((event) => ({ event, participantCount: event.participants.length }));
  }, [dashboardEvents, eventsQuery.data?.my_signup_event_ids]);

  const recentWarMvps = useMemo<DashboardLastWarMvp[]>(() => {
    return (warsQuery.data?.recent_war_mvps ?? []).map((warMvp) =>
      warMvp?.map((entry) => ({
        ...entry,
        label: t(`card.lastWar.mvp.${entry.category}`),
      })) ?? null,
    );
  }, [t, warsQuery.data?.recent_war_mvps]);

  const featuredEventRows = useMemo<DashboardUpcomingEventRow[]>(() => {
    return orderDashboardUpcomingRows(
      featuredEvents.map((item) => buildUpcomingEventRow(item, dashboardEvents, now, user?.id)),
    );
  }, [dashboardEvents, featuredEvents, now, user?.id]);

  const upcomingEventRows = useMemo<DashboardUpcomingEventRow[]>(() => {
    return orderDashboardUpcomingRows(
      upcomingEvents.map((item) => buildUpcomingEventRow(item, dashboardEvents, now, user?.id)),
    );
  }, [dashboardEvents, now, upcomingEvents, user?.id]);

  const openAllEvents = useCallback(
    () => {
      void navigate({
        to: "/events",
        search: { view: "cards" },
      });
    },
    [navigate],
  );

  const openEventDetail = (event: Pick<Event, "id" | "title">) => {
    void navigate({
      to: "/events",
      search: buildEventWorkbenchSearch(event),
    });
  };

  const memberStatsInitialError = memberStatsQuery.isError && !memberStatsQuery.data;
  const eventsInitialError = eventsEnabled && eventsQuery.isError && !eventsQuery.data;
  const warsInitialError = guildWarEnabled && warsQuery.isError && !warsQuery.data;
  const hasInitialLoadError = memberStatsInitialError || eventsInitialError || warsInitialError;
  const hasRefreshError =
    (memberStatsQuery.isError && Boolean(memberStatsQuery.data))
    || (eventsQuery.isError && Boolean(eventsQuery.data))
    || (warsQuery.isError && Boolean(warsQuery.data));

  useLoadWarningToast(
    hasRefreshError,
    t("common:loadErrorRetry"),
  );

  const actionsColumn = eventsEnabled ? (
    <Stack gap={16}>
      {!isExternalView && (
        <Skeleton visible={eventsQuery.isLoading} radius={8}>
          <MySignupsCard
            mySignupEvents={mySignupEvents}
            now={now}
            onOpenEvent={openEventDetail}
            onBrowseEvents={openAllEvents}
          />
        </Skeleton>
      )}

      <Skeleton visible={eventsQuery.isLoading} radius={8}>
        <UpcomingEventsCard
          upcomingEventsCount={eventsQuery.data?.active_events_count ?? 0}
          featuredRows={featuredEventRows}
          rows={upcomingEventRows}
          onOpenEvent={openEventDetail}
          onViewAll={openAllEvents}
        />
      </Skeleton>
    </Stack>
  ) : null;

  const activeMembersCard = (
    <ActiveMembersCard
      activeMemberCount={memberStatsQuery.data?.active_member_count ?? 0}
      totalMembersCount={memberStatsQuery.data?.total_member_count ?? 0}
      allWarWinRate={warsQuery.data?.all_war_win_rate ?? 0}
      activeEventsCount={eventsQuery.data?.active_events_count ?? 0}
      memberStatsLoading={memberStatsQuery.isLoading}
      eventsLoading={eventsQuery.isLoading}
      warsLoading={warsQuery.isLoading}
    />
  );

  const lastWarCard = guildWarEnabled ? (
    <Skeleton visible={warsQuery.isLoading} radius={8}>
      <LastWarCard
        recentWars={recentWars}
        warMvps={recentWarMvps}
        isExternalView={isExternalView}
        onOpenHistory={(warName) => {
          void navigate({
            to: "/guild-war",
            search: { tab: "history", warName },
          });
        }}
        onViewHistory={() => {
          void navigate({
            to: "/guild-war",
            search: { tab: "history" },
          });
        }}
      />
    </Skeleton>
  ) : null;

  return (
    <PageLayout className="dashboard-page">
      {hasInitialLoadError ? (
        <EmptyState
          status="error"
          title={t("common:loadError")}
          description={t("common:errors.connectionIssue")}
          actions={(
            <Button
              loading={memberStatsQuery.isFetching || eventsQuery.isFetching || warsQuery.isFetching}
              onClick={() => {
                if (memberStatsInitialError) void memberStatsQuery.refetch();
                if (eventsInitialError) void eventsQuery.refetch();
                if (warsInitialError) void warsQuery.refetch();
              }}
            >
              {t("common:action.retry")}
            </Button>
          )}
        />
      ) : (
        <Grid gap={{ base: 12, md: 16 }} align="flex-start">
          {isMobileDashboard ? (
            <>
              {actionsColumn ? <Grid.Col span={12}>{actionsColumn}</Grid.Col> : null}
              <Grid.Col span={12}>{activeMembersCard}</Grid.Col>
              {lastWarCard ? <Grid.Col span={12}>{lastWarCard}</Grid.Col> : null}
            </>
          ) : (
            <>
              {actionsColumn ? (
                <Grid.Col span={{ base: 12, xl: "auto" }}>{actionsColumn}</Grid.Col>
              ) : null}
              <Grid.Col span={{ base: 12, xl: eventsEnabled ? (isExternalView ? 6 : 4) : 12 }}>
                <Stack gap={16}>
                  {activeMembersCard}
                  {lastWarCard}
                </Stack>
              </Grid.Col>
            </>
          )}
        </Grid>
      )}
    </PageLayout>
  );
}
