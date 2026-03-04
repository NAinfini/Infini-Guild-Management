import type { Event } from "@guild/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { addDays, differenceInHours } from "date-fns";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { joinEvent, leaveEvent } from "../../api/mutations/events";
import { queryKeys } from "../../api/query-keys";
import { fetchEventDetail, fetchEventsList } from "../../api/queries/events";
import { fetchGuildWarHistory, fetchGuildWarHistoryDetail } from "../../api/queries/guild-war";
import { fetchUsersList } from "../../api/queries/users";
import { useExternalView } from "../../hooks/useExternalView";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { portalToast } from "../../overlays";
import { useAuthStore } from "../../stores/auth";
import { buildMentionList, copyPlainText } from "../../utils/copy";
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

function buildUpcomingEventRow(
  item: Event,
  source: Event[],
  now: Date,
  upcomingEventDetailById: Map<string, Awaited<ReturnType<typeof fetchEventDetail>>>,
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
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isExternalView = useExternalView();
  const now = useMemo(() => getDashboardNow(), []);
  const nowIso = now.toISOString();

  const upcomingEventsQuery = useQuery({
    queryKey: queryKeys.dashboard.upcomingEvents(nowIso),
    queryFn: async () => {
      // Fetch all non-archived events, then filter client-side
      const all = await fetchEventsList({
        page: 1,
        limit: 100,
        archived: false,
      });
      const nextWeek = addDays(now, 7);
      const filtered = all.data.filter((event) => {
        const startsAt = new Date(event.start_at);
        // Upcoming: starts within next 7 days
        if (startsAt >= now && startsAt <= nextWeek) return true;
        // Ongoing: already started but not yet ended
        if (startsAt < now) {
          if (!event.end_at) return true; // no end_at means still active
          return new Date(event.end_at) > now;
        }
        return false;
      });
      return { ...all, data: filtered };
    },
  });

  const recentWarCount = 4;

  const warQuery = useQuery({
    queryKey: queryKeys.dashboard.wars(),
    queryFn: () =>
      fetchGuildWarHistory({
        page: 1,
        limit: 100,
      }),
  });

  const usersQuery = useQuery({
    queryKey: queryKeys.dashboard.users(),
    queryFn: () => fetchUsersList(),
  });

  const recentWars = useMemo(
    () => (warQuery.data?.data ?? []).slice(0, recentWarCount),
    [warQuery.data?.data],
  );
  const recentWarIds = recentWars.map((w) => w.id);

  const recentWarDetailsQuery = useQuery({
    queryKey: queryKeys.dashboard.lastWarDetail(recentWarIds.join(",") || "none"),
    enabled: recentWarIds.length > 0,
    queryFn: () => Promise.all(recentWarIds.map((id) => fetchGuildWarHistoryDetail(id))),
  });

  const upcomingEventDetailsQuery = useQuery({
    queryKey: queryKeys.dashboard.upcomingEventDetails(
      upcomingEventsQuery.data?.data.slice(0, 12).map((item) => item.id).join(",") ?? "",
    ),
    enabled: Boolean(upcomingEventsQuery.data) && Boolean(usersQuery.data),
    queryFn: async () => {
      const eventIds = (upcomingEventsQuery.data?.data ?? []).slice(0, 12).map((item) => item.id);
      return Promise.all(eventIds.map((eventId) => fetchEventDetail(eventId)));
    },
  });

  const mySignupsQuery = useQuery({
    queryKey: queryKeys.dashboard.mySignups(
      user?.id ?? "anonymous",
      upcomingEventsQuery.data?.data.map((item) => item.id).join(",") ?? "",
    ),
    enabled: Boolean(user?.id) && Boolean(upcomingEventsQuery.data),
    queryFn: async () => {
      if (!user?.id) {
        return [] as Event[];
      }
      const eventIds = (upcomingEventsQuery.data?.data ?? []).slice(0, 12).map((item) => item.id);
      const details = await Promise.all(eventIds.map((eventId) => fetchEventDetail(eventId)));
      return details
        .filter((detail) => detail.participants.some((participant) => participant.user_id === user.id))
        .map((detail) => detail as Event);
    },
  });

  const toggleSignupMutation = useMutation({
    mutationFn: async ({ eventId, joined }: { eventId: string; joined: boolean }) =>
      (joined ? leaveEvent(eventId) : joinEvent(eventId)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.upcomingEventDetailsAll() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.mySignupsAll() });
    },
    onError: (error) => {
      const messageText = error instanceof Error ? error.message : "Failed to update signup";
      portalToast({ title: messageText, status: "error" });
    },
  });

  const upcomingEvents = upcomingEventsQuery.data?.data ?? [];
  const users = usersQuery.data?.data ?? [];
  const activeMemberCount = users.filter((entry) => entry.user.is_active && entry.user.deleted_at === null).length;
  const totalMembersCount = users.filter((entry) => entry.user.deleted_at === null).length;
  const activeEventsCount = upcomingEvents.length;

  const upcomingEventDetailById = useMemo(
    () => new Map((upcomingEventDetailsQuery.data ?? []).map((detail) => [detail.id, detail])),
    [upcomingEventDetailsQuery.data],
  );

  const mySignupEvents = useMemo(() => {
    const rawEvents = mySignupsQuery.data ?? [];
    return rawEvents.map((event) => {
      const detail = upcomingEventDetailById.get(event.id);
      return {
        event,
        participantCount: detail?.participants.length ?? 0,
      };
    });
  }, [mySignupsQuery.data, upcomingEventDetailById]);

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
      return row?.profile.wechat_name ?? row?.user.username ?? userId;
    };
    const initials = (userId: string) => {
      const name = resolveName(userId);
      return name.slice(0, 2).toUpperCase();
    };
    return details.map((detail) => {
      const stats = detail.member_stats ?? [];
      if (stats.length === 0) return null;
      const topDamage = [...stats].sort((l, r) => (r.damage ?? 0) - (l.damage ?? 0))[0];
      const topHealing = [...stats].sort((l, r) => (r.healing ?? 0) - (l.healing ?? 0))[0];
      const topBuilding = [...stats].sort((l, r) => (r.building_damage ?? 0) - (l.building_damage ?? 0))[0];
      return {
        damage: {
          label: "Damage",
          name: topDamage ? resolveName(topDamage.user_id) : "-",
          initials: topDamage ? initials(topDamage.user_id) : "?",
          value: topDamage?.damage ?? 0,
        },
        healing: {
          label: "Healing",
          name: topHealing ? resolveName(topHealing.user_id) : "-",
          initials: topHealing ? initials(topHealing.user_id) : "?",
          value: topHealing?.healing ?? 0,
        },
        building: {
          label: "Building",
          name: topBuilding ? resolveName(topBuilding.user_id) : "-",
          initials: topBuilding ? initials(topBuilding.user_id) : "?",
          value: topBuilding?.building_damage ?? 0,
        },
      };
    });
  }, [recentWarDetailsQuery.data, userRowById]);

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

  const openEventDetail = (eventId: string) => {
    localStorage.setItem("events.openEventId", eventId);
    void navigate({ to: "/events" });
  };

  const handleCopySignup = async (eventId: string, title: string) => {
    const members = participantsByEventId.get(eventId) ?? [];
    const output = buildMentionList(
      members.map((entry) => ({
        username: entry.user.username,
        wechatName: entry.profile.wechat_name,
      })),
      title,
    );
    await copyPlainText(output);
    portalToast({ title: "Signup mentions copied", status: "success" });
  };

  const handleToggleSignup = (eventId: string, joined: boolean) => {
    if (!user || isExternalView) {
      return;
    }
    toggleSignupMutation.mutate({ eventId, joined });
  };

  const hasError =
    upcomingEventsQuery.isError ||
    warQuery.isError ||
    usersQuery.isError ||
    upcomingEventDetailsQuery.isError ||
    mySignupsQuery.isError ||
    recentWarDetailsQuery.isError;
  useLoadWarningToast(hasError, t("common:loadErrorRetry"));
  const dashboardGridClassName = isExternalView ? "dashboard-grid dashboard-grid--external" : "dashboard-grid";

  return (
    <PageLayout
      title={t("title")}
      subtitle={t("welcome", { name: user?.username ?? "Guild member" })}
      className="dashboard-page"
    >
      <div className={dashboardGridClassName}>
        <div className="dashboard-grid-column dashboard-grid-column--left">
          {!isExternalView ? (
            <div className="dashboard-slot dashboard-slot-signups">
              <MySignupsCard
                mySignupEvents={mySignupEvents}
                now={now}
                onOpenEvent={openEventDetail}
              />
            </div>
          ) : null}

          <div className="dashboard-slot dashboard-slot-upcoming-primary">
            <UpcomingEventsCard
              upcomingEventsCount={upcomingEvents.length}
              featuredRows={featuredEventRows}
              rows={upcomingEventRows}
              isExternalView={isExternalView}
              hasUser={Boolean(user)}
              isSignupPending={(eventId) =>
                toggleSignupMutation.isPending && toggleSignupMutation.variables?.eventId === eventId
              }
              onToggleSignup={handleToggleSignup}
              onCopySignup={(eventId, title) => {
                void handleCopySignup(eventId, title);
              }}
              onOpenEvent={openEventDetail}
            />
          </div>
        </div>

        <div className="dashboard-grid-column dashboard-grid-column--right">
          <div className="dashboard-slot dashboard-slot-stats">
            <ActiveMembersCard
              activeMemberCount={activeMemberCount}
              totalMembersCount={totalMembersCount}
              allWarWinRate={allWarWinRate}
              activeEventsCount={activeEventsCount}
            />
          </div>

          <div className="dashboard-slot dashboard-slot-last-war">
            <LastWarCard
              recentWars={recentWars}
              warMvps={recentWarMvps}
              isExternalView={isExternalView}
              onOpenHistory={(warName) => {
                localStorage.setItem("guildWar.searchWarName", warName);
                void navigate({ to: "/guild-war" });
              }}
            />
          </div>

        </div>
      </div>
    </PageLayout>
  );
}
