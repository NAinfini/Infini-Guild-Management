import type { Event, InboxNotification } from "@guild/shared";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Skeleton } from "@portal/components/ui/skeleton";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { announcementQueryKeys, fetchAnnouncements } from "../../services/AnnouncementService";
import { queryKeys } from "../../api/query-keys";
import { useExternalView } from "../../hooks/useExternalView";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import {
  dashboardQueryKeys,
  fetchDashboardEvents,
  fetchDashboardWars,
  type DashboardEvent,
} from "../../services/DashboardService";
import { useAuthStore } from "../../stores/auth";
import { useSiteConfigStore } from "../../stores/site-config";
import { fetchInboxNotifications } from "../../services/NotificationService";
import { formatDateTime } from "../../utils/datetime";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import {
  ArrowRightIcon,
  BellIcon,
  BookTextIcon,
  CalendarEventIcon,
  HeartbeatIcon,
  PlayerPauseIcon,
  PlayerPlayIcon,
  UsersIcon,
} from "../icons";
import {
  flattenInboxNotifications,
  getInboxNotificationPresentation,
} from "../notifications/inbox-presentation";
import {
  DashboardAttentionCard,
  type DashboardAttentionSummary,
} from "../dashboard/DashboardAttentionCard";
import {
  type DashboardLastWarMvp,
  type DashboardMember,
  type DashboardUpcomingEventRow,
  orderDashboardUpcomingRows,
} from "../dashboard/shared";
import { LastWarCard } from "../dashboard/LastWarCard";
import { MySignupsCard } from "../dashboard/MySignupsCard";
import { UpcomingEventsCard } from "../dashboard/UpcomingEventsCard";
import "./DashboardPage.css";

export const DASHBOARD_EVENTS_REFETCH_INTERVAL_MS = 60_000;

type DashboardPulseItem = {
  id: string;
  label: string;
  value: string | number;
};

function DashboardPanelSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`dashboard-panel-skeleton${compact ? " dashboard-panel-skeleton--compact" : ""}`} aria-busy="true">
      <Skeleton className="dashboard-panel-skeleton__heading" />
      <Skeleton className="dashboard-panel-skeleton__row" />
      <Skeleton className="dashboard-panel-skeleton__row dashboard-panel-skeleton__row--short" />
    </div>
  );
}

export function roundDashboardNow(value = new Date()): Date {
  const rounded = new Date(value);
  rounded.setMinutes(Math.floor(rounded.getMinutes() / 5) * 5, 0, 0);
  return rounded;
}

export function participantToDashboardMember(participant: DashboardEvent["participant_preview"][number]): DashboardMember {
  return {
    user: {
      id: participant.user_id,
      display_name: participant.display_name,
    },
    profile: {
      power: participant.power,
      classes: participant.classes,
      avatar_media_id: participant.avatar_media_id,
    },
  };
}

export function isDashboardEventStartingSoon(startsAt: Date, now: Date): boolean {
  const millisecondsUntilStart = startsAt.getTime() - now.getTime();
  return millisecondsUntilStart >= 0 && millisecondsUntilStart <= 6 * 60 * 60 * 1_000;
}

function buildUpcomingEventRow(
  item: DashboardEvent,
  source: DashboardEvent[],
  now: Date,
  joined: boolean,
): DashboardUpcomingEventRow {
  const startsAt = new Date(item.start_at);
  const endsAt = item.end_at ? new Date(item.end_at) : startsAt;
  const startsSoon = isDashboardEventStartingSoon(startsAt, now);
  const hasConflict = source.some((peer) => {
    if (peer.id === item.id) return false;
    const peerStart = new Date(peer.start_at);
    const peerEnd = peer.end_at ? new Date(peer.end_at) : peerStart;
    return startsAt < peerEnd && peerStart < endsAt;
  });
  const participantCount = item.participant_count;
  const capacityLabel = item.capacity === null ? `${participantCount}/∞` : `${participantCount}/${item.capacity}`;

  const members = item.participant_preview.map(participantToDashboardMember);

  return {
    item,
    startsSoon,
    hasConflict,
    members,
    participantCount,
    joined,
    capacityLabel,
    isFull: item.capacity !== null && participantCount >= item.capacity,
    quotaSummary: item.quota_summary && {
      slots: item.quota_summary.slots.map((slot) => ({
        key: slot.tag_id,
        required: slot.required,
        matched: slot.matched,
        eligible: slot.eligible,
      })),
      requiredTotal: item.quota_summary.required_total,
      matchedTotal: item.quota_summary.matched_total,
    },
  };
}

export { orderDashboardUpcomingRows } from "../dashboard/shared";

export function summarizeDashboardAttention(
  rows: DashboardUpcomingEventRow[],
): DashboardAttentionSummary {
  return rows.reduce<DashboardAttentionSummary>((summary, row) => ({
    startsSoon: summary.startsSoon + (row.startsSoon ? 1 : 0),
    conflicts: summary.conflicts + (row.hasConflict ? 1 : 0),
    full: summary.full + (row.isFull ? 1 : 0),
    quotaShortfalls: summary.quotaShortfalls + (
      row.quotaSummary && row.quotaSummary.matchedTotal < row.quotaSummary.requiredTotal ? 1 : 0
    ),
  }), { startsSoon: 0, conflicts: 0, full: 0, quotaShortfalls: 0 });
}

export function DashboardPage() {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const eventsEnabled = useSiteConfigStore((state) => state.features.events);
  const announcementsEnabled = useSiteConfigStore((state) => state.features.announcements);
  const guildWarEnabled = useSiteConfigStore((state) => state.features.guildWar);
  const siteName = useSiteConfigStore((state) => state.siteName);
  const isExternalView = useExternalView();

  const eventsQuery = useQuery({
    queryKey: dashboardQueryKeys.events(user?.id ?? "guest", isExternalView),
    queryFn: () => fetchDashboardEvents({ externalView: isExternalView }),
    enabled: eventsEnabled,
    staleTime: DASHBOARD_EVENTS_REFETCH_INTERVAL_MS,
    refetchInterval: DASHBOARD_EVENTS_REFETCH_INTERVAL_MS,
  });
  const warsQuery = useQuery({
    queryKey: dashboardQueryKeys.wars(user?.id ?? "guest", isExternalView),
    queryFn: () => fetchDashboardWars({ externalView: isExternalView }),
    enabled: guildWarEnabled,
    staleTime: DASHBOARD_EVENTS_REFETCH_INTERVAL_MS,
  });
  const announcementsQuery = useQuery({
    queryKey: announcementQueryKeys.list("dashboard", "published", "", "updated_desc"),
    queryFn: () => fetchAnnouncements({
      page: 1,
      limit: 1,
      status: "published",
      archived: false,
      sort: "updated_desc",
    }),
    enabled: announcementsEnabled,
    staleTime: DASHBOARD_EVENTS_REFETCH_INTERVAL_MS,
  });
  const activityQuery = useInfiniteQuery({
    queryKey: queryKeys.notifications.inbox(user?.id),
    queryFn: ({ pageParam }) => fetchInboxNotifications({ limit: 50, cursor: pageParam ?? null }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(user) && !isExternalView,
    staleTime: 15_000,
  });

  const now = useMemo(() => roundDashboardNow(), [eventsQuery.dataUpdatedAt]);
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
  const activityItems = useMemo(
    () => flattenInboxNotifications(activityQuery.data).slice(0, 5),
    [activityQuery.data],
  );

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

  const attentionSummary = useMemo(
    () => summarizeDashboardAttention([...featuredEventRows, ...upcomingEventRows]),
    [featuredEventRows, upcomingEventRows],
  );
  const attentionCount = Object.values(attentionSummary).reduce((total, count) => total + count, 0);

  const pulseItems = useMemo<DashboardPulseItem[]>(() => {
    const items: DashboardPulseItem[] = [];
    if (eventsEnabled && eventsQuery.data) {
      items.push({
        id: "events",
        label: t("pulse.events"),
        value: eventsQuery.data.active_events_count,
      });
      if (!isExternalView) {
        items.push({ id: "signups", label: t("pulse.signups"), value: mySignupEvents.length });
      }
      items.push({ id: "attention", label: t("pulse.attention"), value: attentionCount });
    }
    if (guildWarEnabled && warsQuery.data) {
      items.push({ id: "wars", label: t("pulse.wars"), value: recentWars.length });
    }
    if (announcementsEnabled && latestAnnouncement) {
      items.push({ id: "bulletin", label: t("pulse.bulletin"), value: latestAnnouncement.title });
    }
    return items;
  }, [
    announcementsEnabled,
    attentionCount,
    eventsEnabled,
    eventsQuery.data,
    guildWarEnabled,
    isExternalView,
    latestAnnouncement,
    mySignupEvents.length,
    recentWars.length,
    t,
    warsQuery.data,
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

  const openActivityItem = useCallback((item: InboxNotification) => {
    if (item.entity_type === "announcement") {
      void navigate({ to: "/announcements", search: { announcementId: item.entity_id } });
    } else if (item.entity_type === "event") {
      void navigate({ to: "/events/$id", params: { id: item.entity_id } });
    } else if (item.entity_type === "wiki_article") {
      void navigate({ to: "/wiki/$slug", params: { slug: item.payload.slug } });
    } else {
      void navigate({ to: "/roster" });
    }
  }, [navigate]);

  const eventsInitialError = eventsEnabled && eventsQuery.isError && !eventsQuery.data;
  const warsInitialError = guildWarEnabled && warsQuery.isError && !warsQuery.data;
  const announcementsInitialError = announcementsEnabled && announcementsQuery.isError && !announcementsQuery.data;
  const hasInitialLoadError = eventsInitialError || warsInitialError;
  const hasRefreshError =
    (eventsQuery.isError && Boolean(eventsQuery.data))
    || (warsQuery.isError && Boolean(warsQuery.data))
    || (announcementsQuery.isError && Boolean(announcementsQuery.data))
    || (activityQuery.isError && Boolean(activityQuery.data));

  useLoadWarningToast(
    hasRefreshError,
    t("common:loadErrorRetry"),
  );

  const mySignupsCard = eventsEnabled && !isExternalView ? (
    eventsQuery.isLoading ? <DashboardPanelSkeleton compact /> : (
      <MySignupsCard
        mySignupEvents={mySignupEvents}
        now={now}
        onOpenEvent={openEventDetail}
        onBrowseEvents={openAllEvents}
      />
    )
  ) : null;

  const upcomingEventsCard = eventsEnabled ? (
    eventsQuery.isLoading ? <DashboardPanelSkeleton /> : (
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
    warsQuery.isLoading ? <DashboardPanelSkeleton /> : (
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
          onClick={() => void navigate({
            to: "/announcements",
            search: latestAnnouncement ? { announcementId: latestAnnouncement.id } : {},
          })}
        >
          {announcementsQuery.isLoading ? (
            <span className="dashboard-bulletin-card__loading" aria-busy="true">
              <Skeleton className="dashboard-bulletin-card__title-skeleton" />
              <Skeleton className="dashboard-bulletin-card__meta-skeleton" />
            </span>
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

  const activityCard = user && !isExternalView ? (
    <DashboardActivityCard
      items={activityItems}
      loading={activityQuery.isLoading}
      error={activityQuery.isError && !activityQuery.data}
      onRetry={() => void activityQuery.refetch()}
      onOpen={openActivityItem}
    />
  ) : null;

  const hasWorkspaceAside = Boolean(latestAnnouncementCard || activityCard || eventsEnabled || lastWarCard);
  const hasWorkspaceMain = Boolean(mySignupsCard || upcomingEventsCard);

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
          <Card
            className="dashboard-briefing gap-0 py-0"
            role="region"
            aria-labelledby="dashboard-briefing-title"
          >
            <div className="dashboard-briefing__copy">
              <span className="dashboard-briefing__eyebrow">{siteName}</span>
              <h2 id="dashboard-briefing-title">
                {t("welcome", { name: user?.display_name ?? t("welcomeFallback") })}
              </h2>
              <p>{t("briefing.description")}</p>
              {eventsEnabled && !eventsQuery.isLoading ? (
                <Button size="sm" variant="outline" onClick={openAllEvents}>
                  {t("attention.openEvents")}
                  <ArrowRightIcon size={15} aria-hidden="true" />
                </Button>
              ) : null}
            </div>

            {eventsEnabled ? (
              <dl className="dashboard-briefing__metrics">
                <DashboardBriefingMetric
                  label={t("card.mySignups.title")}
                  loading={eventsQuery.isLoading}
                  value={mySignupEvents.length}
                />
                <DashboardBriefingMetric
                  label={t("card.upcomingEvents.title")}
                  loading={eventsQuery.isLoading}
                  value={eventsQuery.data?.active_events_count ?? 0}
                />
                <DashboardBriefingMetric
                  label={t("attention.title")}
                  loading={eventsQuery.isLoading}
                  value={attentionCount}
                  emphasized={attentionCount > 0}
                />
              </dl>
            ) : null}
          </Card>

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
                {latestAnnouncementCard ? <div className="dashboard-workspace__announcement">{latestAnnouncementCard}</div> : null}
                {activityCard ? <div className="dashboard-workspace__activity">{activityCard}</div> : null}
                {eventsEnabled ? (
                  <div className="dashboard-workspace__attention">
                    <DashboardAttentionCard
                      summary={attentionSummary}
                      loading={eventsQuery.isLoading}
                      onBrowse={openAllEvents}
                    />
                  </div>
                ) : null}
                {lastWarCard ? <div className="dashboard-workspace__war">{lastWarCard}</div> : null}
              </div>
            ) : null}
          </div>
        </>
      )}
    </PageLayout>
  );
}

function DashboardBriefingMetric({
  label,
  loading,
  value,
  emphasized = false,
}: {
  label: string;
  loading: boolean;
  value: number;
  emphasized?: boolean;
}) {
  return (
    <div className="dashboard-briefing__metric" data-emphasized={emphasized || undefined}>
      <dt>{label}</dt>
      <dd>{loading ? <Skeleton className="dashboard-briefing__metric-skeleton" /> : value}</dd>
    </div>
  );
}

function DashboardGuildPulse({ items }: { items: readonly DashboardPulseItem[] }) {
  const { t } = useTranslation("dashboard");
  const [paused, setPaused] = useState(false);

  if (items.length === 0) return null;

  const renderGroup = (duplicate: boolean) => (
    <ul
      className="dashboard-pulse__group"
      aria-hidden={duplicate || undefined}
      data-duplicate={duplicate || undefined}
    >
      {items.map((item) => (
        <li key={`${duplicate ? "duplicate-" : ""}${item.id}`} className="dashboard-pulse__item">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </li>
      ))}
    </ul>
  );

  return (
    <Card
      className="dashboard-pulse gap-0 py-0"
      role="region"
      aria-labelledby="dashboard-pulse-title"
      data-paused={paused || undefined}
      data-moving={items.length > 1 || undefined}
    >
      <div className="dashboard-pulse__label" id="dashboard-pulse-title">
        <HeartbeatIcon size={17} aria-hidden="true" />
        <span>{t("pulse.title")}</span>
      </div>
      <div className="dashboard-pulse__viewport">
        <div className="dashboard-pulse__track">
          {renderGroup(false)}
          {items.length > 1 ? renderGroup(true) : null}
        </div>
      </div>
      {items.length > 1 ? (
        <Button
          type="button"
          className="dashboard-pulse__control"
          variant="ghost"
          size="icon-sm"
          aria-pressed={paused}
          aria-label={t(paused ? "common:media.resume" : "common:media.pause")}
          title={t(paused ? "common:media.resume" : "common:media.pause")}
          onClick={() => setPaused((current) => !current)}
        >
          {paused
            ? <PlayerPlayIcon size={16} aria-hidden="true" />
            : <PlayerPauseIcon size={16} aria-hidden="true" />}
        </Button>
      ) : null}
    </Card>
  );
}

function DashboardActivityCard({
  items,
  loading,
  error,
  onRetry,
  onOpen,
}: {
  items: readonly InboxNotification[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onOpen: (item: InboxNotification) => void;
}) {
  const { t } = useTranslation("dashboard");
  const { t: tCommon } = useTranslation("common");

  return (
    <Card className="dashboard-activity-card gap-0 py-0">
      <div className="dashboard-activity-card__head">
        <span className="dashboard-activity-card__head-icon">
          <HeartbeatIcon size={17} aria-hidden="true" />
        </span>
        <div>
          <h2>{t("activity.title")}</h2>
          <p>{t("activity.description")}</p>
        </div>
      </div>

      {loading ? (
        <div className="dashboard-activity-card__skeletons" aria-busy="true">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : error ? (
        <div className="dashboard-activity-card__message" role="status">
          <span>{t("common:loadError")}</span>
          <Button type="button" size="xs" variant="outline" onClick={onRetry}>
            {t("common:action.retry")}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="dashboard-activity-card__empty">{t("activity.empty")}</p>
      ) : (
        <ul className="dashboard-activity-card__list">
          {items.map((item) => {
            const presentation = getInboxNotificationPresentation(item, tCommon);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="dashboard-activity-card__item"
                  aria-label={tCommon("notification.aria.open", { title: presentation.detail })}
                  onClick={() => onOpen(item)}
                >
                  <DashboardActivityGlyph item={item} />
                  <span className="dashboard-activity-card__copy">
                    <span className="dashboard-activity-card__title">
                      {tCommon(presentation.titleKey)}
                    </span>
                    <span className="dashboard-activity-card__detail">{presentation.detail}</span>
                  </span>
                  <span className="dashboard-activity-card__meta">
                    {item.read_at === null ? <span className="dashboard-activity-card__unread" aria-hidden="true" /> : null}
                    <time dateTime={item.occurred_at}>{formatDateTime(item.occurred_at)}</time>
                    <ArrowRightIcon size={14} aria-hidden="true" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function DashboardActivityGlyph({ item }: { item: InboxNotification }) {
  const glyph = (() => {
    switch (item.kind) {
      case "member_joined":
        return <UsersIcon size={16} aria-hidden="true" />;
      case "announcement_published":
        return <BellIcon size={16} aria-hidden="true" />;
      case "event_created":
        return <CalendarEventIcon size={16} aria-hidden="true" />;
      case "wiki_article_created":
        return <BookTextIcon size={16} aria-hidden="true" />;
    }
  })();

  return (
    <span className="dashboard-activity-card__glyph" data-tone={item.entity_type} aria-hidden="true">
      {glyph}
    </span>
  );
}
