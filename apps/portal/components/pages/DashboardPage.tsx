import type { Event } from "@guild/shared";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { LoadingIndicator } from "@portal/components/ui/loading-indicator";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchAnnouncements } from "../../services/AnnouncementService";
import { useExternalView } from "../../hooks/useExternalView";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import {
  dashboardQueryKeys,
  fetchDashboardEvents,
  fetchDashboardWars,
} from "../../services/DashboardService";
import { useAuthStore } from "../../stores/auth";
import { useSiteConfigStore } from "../../stores/site-config";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import { ArrowRightIcon, BellIcon } from "../icons";
import { DashboardAttentionCard } from "../dashboard/DashboardAttentionCard";
import {
  buildUpcomingEventRow,
  DASHBOARD_CLOCK_TICK_MS,
  getDashboardAttentionKinds,
  isDashboardEventStartingSoon,
  participantToDashboardMember,
  roundDashboardNow,
  summarizeDashboardAttention,
} from "../dashboard/dashboard-page-data";
import {
  type DashboardLastWarMvp,
  type DashboardUpcomingEventRow,
  orderDashboardUpcomingRows,
} from "../dashboard/shared";
import { LastWarCard } from "../dashboard/LastWarCard";
import { MySignupsCard } from "../dashboard/MySignupsCard";
import { UpcomingEventsCard } from "../dashboard/UpcomingEventsCard";
import "./DashboardPage.css";

export {
  DASHBOARD_CLOCK_TICK_MS,
  isDashboardEventStartingSoon,
  participantToDashboardMember,
  roundDashboardNow,
  summarizeDashboardAttention,
};
export { orderDashboardUpcomingRows } from "../dashboard/shared";

type DashboardPulseItem = {
  id: string;
  label: string;
  value: number | string;
};

export function DashboardPage() {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const eventsEnabled = useSiteConfigStore((state) => state.features.events);
  const announcementsEnabled = useSiteConfigStore((state) => state.features.announcements);
  const guildWarEnabled = useSiteConfigStore((state) => state.features.guildWar);
  const isExternalView = useExternalView();
  const [now, setNow] = useState(() => roundDashboardNow());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(roundDashboardNow()), DASHBOARD_CLOCK_TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  const eventsQuery = useQuery({
    queryKey: dashboardQueryKeys.events(user?.id ?? "guest", isExternalView),
    queryFn: () => fetchDashboardEvents({ externalView: isExternalView }),
    enabled: eventsEnabled,
    staleTime: DASHBOARD_CLOCK_TICK_MS,
  });
  const warsQuery = useQuery({
    queryKey: dashboardQueryKeys.wars(user?.id ?? "guest", isExternalView),
    queryFn: () => fetchDashboardWars({ externalView: isExternalView }),
    enabled: guildWarEnabled,
    staleTime: DASHBOARD_CLOCK_TICK_MS,
  });
  const announcementsQuery = useQuery({
    queryKey: dashboardQueryKeys.latestAnnouncement(),
    queryFn: () => fetchAnnouncements({
      page: 1,
      limit: 1,
      status: "published",
      sort: "updated_desc",
    }),
    enabled: announcementsEnabled,
    staleTime: DASHBOARD_CLOCK_TICK_MS,
  });

  const featuredEvents = eventsQuery.data?.featured_events ?? [];
  const upcomingEvents = eventsQuery.data?.upcoming_events ?? [];
  const dashboardEvents = useMemo(
    () => [...featuredEvents, ...upcomingEvents],
    [featuredEvents, upcomingEvents],
  );
  const recentWars = warsQuery.data?.recent_wars ?? [];
  const mySignupEventIds = useMemo(
    () => new Set(eventsQuery.data?.my_signup_event_ids ?? []),
    [eventsQuery.data?.my_signup_event_ids],
  );
  const latestAnnouncement = announcementsQuery.data?.data[0];

  const mySignupEvents = useMemo(() => {
    return dashboardEvents
      .filter((event) => mySignupEventIds.has(event.id))
      .map((event) => ({ event, participantCount: event.participant_count }));
  }, [dashboardEvents, mySignupEventIds]);

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
      featuredEvents.map((item) => buildUpcomingEventRow(item, dashboardEvents, now, mySignupEventIds.has(item.id))),
    );
  }, [dashboardEvents, featuredEvents, mySignupEventIds, now]);

  const upcomingEventRows = useMemo<DashboardUpcomingEventRow[]>(() => {
    return orderDashboardUpcomingRows(
      upcomingEvents.map((item) => buildUpcomingEventRow(item, dashboardEvents, now, mySignupEventIds.has(item.id))),
    );
  }, [dashboardEvents, mySignupEventIds, now, upcomingEvents]);

  const attentionRows = useMemo(
    () => orderDashboardUpcomingRows([...featuredEventRows, ...upcomingEventRows])
      .filter((row) => getDashboardAttentionKinds(row).length > 0),
    [featuredEventRows, upcomingEventRows],
  );
  const attentionCount = attentionRows.length;

  const pulseItems = useMemo<DashboardPulseItem[]>(() => {
    const items: DashboardPulseItem[] = [];

    if (eventsEnabled && eventsQuery.data) {
      items.push({
        id: "events",
        label: t("pulse.events"),
        value: eventsQuery.data.active_events_count,
      });
      if (user && !isExternalView) {
        items.push({ id: "signups", label: t("pulse.signups"), value: mySignupEvents.length });
      }
      items.push({ id: "attention", label: t("pulse.attention"), value: attentionCount });
    }
    return items;
  }, [
    attentionCount,
    eventsEnabled,
    eventsQuery.data,
    isExternalView,
    mySignupEvents.length,
    t,
    user,
  ]);

  const openAllEvents = useCallback(
    () => {
      void navigate({
        to: "/events",
        search: { view: "cards" },
      });
    },
    [navigate],
  );

  const openEventDetail = (event: Pick<Event, "id">) => {
    void navigate({
      to: "/events/$id",
      params: { id: event.id },
    });
  };

  const eventsInitialError = eventsEnabled && eventsQuery.isError && !eventsQuery.data;
  const warsInitialError = guildWarEnabled && warsQuery.isError && !warsQuery.data;
  const announcementsInitialError = announcementsEnabled && announcementsQuery.isError && !announcementsQuery.data;
  const hasInitialLoadError = eventsInitialError || warsInitialError;
  const hasRefreshError =
    (eventsQuery.isError && Boolean(eventsQuery.data))
    || (warsQuery.isError && Boolean(warsQuery.data))
    || (announcementsQuery.isError && Boolean(announcementsQuery.data));

  useLoadWarningToast(
    hasRefreshError,
    t("common:loadErrorRetry"),
  );

  const mySignupsCard = eventsEnabled && user && !isExternalView ? (
    eventsQuery.isLoading ? <LoadingIndicator /> : (
      <MySignupsCard
        mySignupEvents={mySignupEvents}
        now={now}
        onOpenEvent={openEventDetail}
        onBrowseEvents={openAllEvents}
      />
    )
  ) : null;

  const upcomingEventsCard = eventsEnabled ? (
    eventsQuery.isLoading ? <LoadingIndicator /> : (
      <UpcomingEventsCard
        upcomingEventsCount={eventsQuery.data?.active_events_count ?? 0}
        featuredRows={featuredEventRows}
        rows={upcomingEventRows}
        onOpenEvent={openEventDetail}
        onViewAll={openAllEvents}
      />
    )
  ) : null;

  const lastWarCard = guildWarEnabled ? (
    warsQuery.isLoading ? <LoadingIndicator /> : (
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
    )
  ) : null;

  const latestAnnouncementCard = announcementsEnabled ? (
    <Card className="dashboard-bulletin-card gap-0 py-0">
      <div className="dashboard-bulletin-card__head">
        <span className="dashboard-bulletin-card__icon"><BellIcon size={17} aria-hidden="true" /></span>
        <strong className="dashboard-bulletin-card__label">{t("command.bulletin.label")}</strong>
      </div>
      {announcementsInitialError ? (
        <div className="dashboard-bulletin-card__error" role="status">
          <strong>{t("common:loadError")}</strong>
          <Button size="xs" onClick={() => void announcementsQuery.refetch()}>
            {t("common:action.retry")}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          className="dashboard-bulletin-card__body"
          onClick={() => {
            if (latestAnnouncement) {
              void navigate({
                to: "/announcements/$announcementId",
                params: { announcementId: latestAnnouncement.id },
              });
            } else {
              void navigate({ to: "/announcements" });
            }
          }}
        >
          {announcementsQuery.isLoading ? (
            <LoadingIndicator />
          ) : (
            <>
              <strong className="dashboard-bulletin-card__title">{latestAnnouncement?.title ?? t("command.bulletin.empty")}</strong>
              <span className="dashboard-bulletin-card__open">
                <span>{t("command.action.announcements")}</span>
                <ArrowRightIcon size={15} aria-hidden="true" />
              </span>
            </>
          )}
        </button>
      )}
    </Card>
  ) : null;

  const hasWorkspaceAside = Boolean(eventsEnabled || latestAnnouncementCard || lastWarCard);
  const hasWorkspaceMain = Boolean(eventsEnabled || mySignupsCard || upcomingEventsCard);

  return (
    <PageLayout className="dashboard-page">
      {hasInitialLoadError ? (
        <EmptyState
          status="error"
          title={t("common:loadError")}
          description={t("common:errors.connectionIssue")}
          actions={(
            <Button
              loading={eventsQuery.isFetching || warsQuery.isFetching}
              onClick={() => {
                if (eventsInitialError) void eventsQuery.refetch();
                if (warsInitialError) void warsQuery.refetch();
              }}
            >
              {t("common:action.retry")}
            </Button>
          )}
        />
      ) : (
        <>
          <DashboardGuildPulse items={pulseItems} />
          <div className={`dashboard-workspace${hasWorkspaceMain && hasWorkspaceAside ? "" : " dashboard-workspace--single"}`}>
            {hasWorkspaceMain ? (
              <div className="dashboard-workspace__main">
                {mySignupsCard ? <div className="dashboard-workspace__signups">{mySignupsCard}</div> : null}
                {upcomingEventsCard ? <div className="dashboard-workspace__upcoming">{upcomingEventsCard}</div> : null}
              </div>
            ) : null}
            {hasWorkspaceAside ? (
              <div className="dashboard-workspace__aside">
                {eventsEnabled ? (
                  <div className="dashboard-workspace__attention">
                    <DashboardAttentionCard
                      rows={attentionRows}
                      loading={eventsQuery.isLoading}
                    />
                  </div>
                ) : null}
                {latestAnnouncementCard ? <div className="dashboard-workspace__announcement">{latestAnnouncementCard}</div> : null}
                {lastWarCard ? <div className="dashboard-workspace__war">{lastWarCard}</div> : null}
              </div>
            ) : null}
          </div>
        </>
      )}
    </PageLayout>
  );
}

function DashboardGuildPulse({ items }: { items: readonly DashboardPulseItem[] }) {
  const { t } = useTranslation("dashboard");

  if (items.length === 0) return null;

  return (
    <Card
      className="dashboard-pulse gap-0 py-0"
      role="region"
      aria-label={t("pulse.ariaLabel")}
    >
      <ul className="dashboard-pulse__list">
        {items.map((item) => (
          <li key={item.id} className="dashboard-pulse__item">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </li>
        ))}
      </ul>
    </Card>
  );
}
