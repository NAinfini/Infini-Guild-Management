import type { Event } from "@guild/shared";
import { Grid, Skeleton, Stack } from "@mantine/core";
import { LayoutGridIcon } from "@portal/components/icons";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { differenceInHours } from "date-fns";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useExternalView } from "../../hooks/useExternalView";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import {
  dashboardQueryKeys,
  fetchDashboardSummary,
  type DashboardSummaryEvent,
} from "../../services/DashboardService";
import { useAuthStore } from "../../stores/auth";
import { useSiteConfigStore } from "../../stores/site-config";
import { buildEventWorkbenchSearch } from "../../utils/event-navigation";
import { PageLayout } from "../layout/PageLayout";
import {
  type DashboardLastWarMvp,
  type DashboardMember,
  type DashboardUpcomingEventRow,
} from "../dashboard/shared";
import { ActiveMembersCard } from "../dashboard/ActiveMembersCard";
import { LastWarCard } from "../dashboard/LastWarCard";
import { MySignupsCard } from "../dashboard/MySignupsCard";
import { UpcomingEventsCard } from "../dashboard/UpcomingEventsCard";
import "./DashboardPage.css";

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

export function buildDashboardUpcomingEventsQueryParams(now: Date) {
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

export function participantToDashboardMember(participant: DashboardSummaryEvent["participants"][number]): DashboardMember {
  return {
    user: {
      id: participant.user_id,
      username: participant.username,
    },
    profile: {
      power: participant.power,
      classes: participant.classes,
      avatar_key: participant.avatar_key,
    },
  };
}

function buildUpcomingEventRow(
  item: DashboardSummaryEvent,
  source: DashboardSummaryEvent[],
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

  return {
    item,
    startsSoon,
    hasConflict,
    members: item.participants.map(participantToDashboardMember),
    joined,
    capacityLabel,
    isFull: item.capacity !== null && participantCount >= item.capacity,
  };
}

export function orderDashboardUpcomingRows<T extends { item: Pick<Event, "id" | "start_at" | "pinned"> }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftTime = new Date(left.item.start_at).getTime();
    const rightTime = new Date(right.item.start_at).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;
    if (left.item.pinned !== right.item.pinned) return left.item.pinned ? -1 : 1;
    return left.item.id.localeCompare(right.item.id);
  });
}

export function DashboardPage() {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const eventsEnabled = useSiteConfigStore((state) => state.features.events);
  const guildWarEnabled = useSiteConfigStore((state) => state.features.guildWar);
  const isExternalView = useExternalView();
  const now = useMemo(() => getDashboardNow(), []);

  const summaryQuery = useQuery({
    queryKey: dashboardQueryKeys.summary(),
    queryFn: fetchDashboardSummary,
    staleTime: DASHBOARD_EVENTS_REFETCH_INTERVAL_MS,
    placeholderData: keepPreviousData,
  });

  const summary = summaryQuery.data;
  const featuredEvents = summary?.featured_events ?? [];
  const upcomingEvents = summary?.upcoming_events ?? [];
  const dashboardEvents = useMemo(
    () => [...featuredEvents, ...upcomingEvents],
    [featuredEvents, upcomingEvents],
  );
  const recentWars = summary?.recent_wars ?? [];

  const mySignupEvents = useMemo(() => {
    const mySignupIds = new Set(summary?.my_signup_event_ids ?? []);
    return dashboardEvents
      .filter((event) => mySignupIds.has(event.id))
      .map((event) => ({ event, participantCount: event.participants.length }));
  }, [dashboardEvents, summary?.my_signup_event_ids]);

  const recentWarMvps = useMemo<DashboardLastWarMvp[]>(() => {
    return (summary?.recent_war_mvps ?? []).map((warMvp) =>
      warMvp?.map((entry) => ({
        ...entry,
        label: t(`card.lastWar.mvp.${entry.category}`),
      })) ?? null,
    );
  }, [summary?.recent_war_mvps, t]);

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

  useLoadWarningToast(summaryQuery.isError, t("common:loadErrorRetry"));

  return (
    <PageLayout
      title={t("title")}
      subtitle={t("welcome", { name: user?.username ?? t("welcomeFallback") })}
      icon={<LayoutGridIcon size={22} />}
      className="dashboard-page"
    >
      <Grid gutter={16} align="flex-start">
        {eventsEnabled ? <Grid.Col span={{ base: 12, xl: "auto" }}>
          <Stack gap={16}>
            {!isExternalView && (
              <Skeleton visible={summaryQuery.isLoading} radius={8}>
                <MySignupsCard mySignupEvents={mySignupEvents} now={now} onOpenEvent={openEventDetail} />
              </Skeleton>
            )}

            <Skeleton visible={summaryQuery.isLoading} radius={8}>
              <UpcomingEventsCard
                upcomingEventsCount={summary?.active_events_count ?? 0}
                featuredRows={featuredEventRows}
                rows={upcomingEventRows}
                onOpenEvent={openEventDetail}
                onViewAll={openAllEvents}
              />
            </Skeleton>
          </Stack>
        </Grid.Col> : null}

        <Grid.Col span={{ base: 12, xl: eventsEnabled ? (isExternalView ? 6 : 4) : 12 }}>
          <Stack gap={16}>
            <Skeleton visible={summaryQuery.isLoading} radius={8}>
              <ActiveMembersCard
                activeMemberCount={summary?.active_member_count ?? 0}
                totalMembersCount={summary?.total_member_count ?? 0}
                allWarWinRate={summary?.all_war_win_rate ?? 0}
                activeEventsCount={summary?.active_events_count ?? 0}
              />
            </Skeleton>

            {guildWarEnabled ? <Skeleton visible={summaryQuery.isLoading} radius={8}>
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
              />
            </Skeleton> : null}
          </Stack>
        </Grid.Col>
      </Grid>
    </PageLayout>
  );
}
