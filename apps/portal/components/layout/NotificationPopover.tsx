import type {
  InboxNotification,
  InboxNotificationListResponse,
  ImportantNoticeActive,
  User,
} from "@guild/shared";
import { extractTipTapText } from "@guild/shared/utils/tiptap-text";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@portal/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@portal/components/ui/popover";
import { Skeleton } from "@portal/components/ui/skeleton";
import { queryKeys } from "../../api/query-keys";
import {
  fetchActiveImportantNotices,
  fetchInboxNotifications,
  markInboxNotificationsRead,
  markImportantNoticesRead,
} from "../../services/NotificationService";
import { CheckIcon, XIcon } from "@portal/components/icons";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { NotificationOutlined } from "../../utils/icons";
import {
  flattenInboxNotifications,
  getInboxNotificationPresentation,
  type InboxNotificationTone,
} from "../notifications/inbox-presentation";
import { EmptyState } from "../shared/EmptyState";
import { ImportantNoticeReaderDialog } from "./ImportantNoticeReaderDialog";
import styles from "./NotificationPopover.module.css";

const notificationToneClassNames: Record<InboxNotificationTone, string> = {
  member: styles.badgeMember!,
  announcement: styles.badgeAnnouncement!,
  event: styles.badgeEvent!,
  wiki: styles.badgeWiki!,
};

type InboxNotificationCache = InfiniteData<InboxNotificationListResponse>;

function patchReadState(
  current: InboxNotificationCache | undefined,
  ids: readonly string[] | null,
  unreadReduction: number,
): InboxNotificationCache | undefined {
  if (!current) return current;
  const shouldRead = (item: InboxNotification) => ids === null || ids.includes(item.id);
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      data: page.data.map((item) => shouldRead(item) ? { ...item, read_at: new Date().toISOString() } : item),
      unread_count: ids === null ? 0 : Math.max(0, page.unread_count - unreadReduction),
    })),
  };
}

function countUnreadNotifications(
  current: InboxNotificationCache | undefined,
  ids: readonly string[] | null,
): number {
  if (ids === null) return 0;
  const unreadIds = new Set<string>();
  for (const item of flattenInboxNotifications(current)) {
    if (item.read_at === null && ids.includes(item.id)) unreadIds.add(item.id);
  }
  return unreadIds.size;
}

function patchImportantNoticeReadState(
  current: ImportantNoticeActive[] | undefined,
  ids: readonly string[] | null,
): ImportantNoticeActive[] | undefined {
  if (!current) return current;
  const readAt = new Date().toISOString();
  return current.map((notice) => (
    notice.read_at === null && (ids === null || ids.includes(notice.id))
      ? { ...notice, read_at: readAt }
      : notice
  ));
}

export function NotificationPopover({ user }: { user: User | null }) {
  const { t, i18n } = useTranslation("common");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [opened, setOpened] = useState(false);
  const [selectedNotice, setSelectedNotice] = useState<ImportantNoticeActive | null>(null);
  const isPhone = useMediaQuery("(max-width: 47.99em)");
  const wasOpenedRef = useRef(false);
  const readInFlightIdsRef = useRef(new Set<string>());
  const inboxUserId = user?.id ?? "anonymous";
  const dateFnsLocale = i18n.language === "zh" ? zhCN : undefined;
  const inboxQueryKey = queryKeys.notifications.inbox(user?.id);
  const importantNoticesQueryKey = queryKeys.importantNotices.active(user?.id);

  const inboxQuery = useInfiniteQuery({
    queryKey: inboxQueryKey,
    queryFn: ({ pageParam }) => fetchInboxNotifications({ limit: 50, cursor: pageParam ?? null }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(user),
    staleTime: 15_000,
    refetchInterval: () => opened && document.visibilityState === "visible" ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const { isStale: inboxIsStale, refetch: refetchInbox } = inboxQuery;
  const importantNoticesQuery = useQuery({
    queryKey: importantNoticesQueryKey,
    queryFn: fetchActiveImportantNotices,
    enabled: Boolean(user),
    staleTime: 30_000,
    refetchInterval: () => opened && document.visibilityState === "visible" ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const { isStale: importantNoticesAreStale, refetch: refetchImportantNotices } = importantNoticesQuery;

  const invalidateInbox = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.user(inboxUserId) }),
    [inboxUserId, queryClient],
  );
  const invalidateImportantNotices = useCallback(
    () => queryClient.invalidateQueries({ queryKey: importantNoticesQueryKey }),
    [importantNoticesQueryKey, queryClient],
  );

  const markReadMutation = useMutation({
    mutationFn: (input: { ids?: string[]; all?: true }) => markInboxNotificationsRead(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications.user(inboxUserId) });
      const previous = queryClient.getQueryData<InboxNotificationCache>(inboxQueryKey);
      const ids = input.all ? null : (input.ids ?? []);
      const unreadReduction = countUnreadNotifications(previous, ids);
      queryClient.setQueryData<InboxNotificationCache>(inboxQueryKey, (current) => patchReadState(current, ids, unreadReduction));
      return { previous };
    },
    onError: (_error, _input, context) => {
      queryClient.setQueryData(inboxQueryKey, context?.previous);
    },
    onSettled: () => { void invalidateInbox(); },
  });

  const markImportantNoticesReadMutation = useMutation({
    mutationFn: (input: { ids?: string[]; all?: true }) => markImportantNoticesRead(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: importantNoticesQueryKey });
      const previous = queryClient.getQueryData<ImportantNoticeActive[]>(importantNoticesQueryKey);
      const ids = input.all ? null : (input.ids ?? []);
      queryClient.setQueryData<ImportantNoticeActive[]>(
        importantNoticesQueryKey,
        (current) => patchImportantNoticeReadState(current, ids),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      queryClient.setQueryData(importantNoticesQueryKey, context?.previous);
    },
    onSettled: () => { void invalidateImportantNotices(); },
  });

  const markItemRead = useCallback((item: InboxNotification) => {
    if (item.read_at !== null || readInFlightIdsRef.current.has(item.id)) return;
    readInFlightIdsRef.current.add(item.id);
    markReadMutation.mutate({ ids: [item.id] }, {
      onSettled: () => { readInFlightIdsRef.current.delete(item.id); },
    });
  }, [markReadMutation]);

  const markImportantNoticeRead = useCallback((notice: ImportantNoticeActive) => {
    if (notice.read_at !== null || readInFlightIdsRef.current.has(notice.id)) return;
    readInFlightIdsRef.current.add(notice.id);
    markImportantNoticesReadMutation.mutate({ ids: [notice.id] }, {
      onSettled: () => { readInFlightIdsRef.current.delete(notice.id); },
    });
  }, [markImportantNoticesReadMutation]);

  const markAllRead = useCallback(() => {
    const ids = flattenInboxNotifications(inboxQuery.data)
      .filter((item) => item.read_at === null)
      .map((item) => item.id);
    ids.forEach((id) => readInFlightIdsRef.current.add(id));
    if (ids.length > 0) {
      markReadMutation.mutate({ all: true }, {
        onSettled: () => { ids.forEach((id) => readInFlightIdsRef.current.delete(id)); },
      });
    }
    const noticeIds = (importantNoticesQuery.data ?? [])
      .filter((notice) => notice.read_at === null)
      .map((notice) => notice.id);
    noticeIds.forEach((id) => readInFlightIdsRef.current.add(id));
    if (noticeIds.length > 0) {
      markImportantNoticesReadMutation.mutate({ all: true }, {
        onSettled: () => { noticeIds.forEach((id) => readInFlightIdsRef.current.delete(id)); },
      });
    }
  }, [importantNoticesQuery.data, inboxQuery.data, markImportantNoticesReadMutation, markReadMutation]);

  const markPointerItemRead = useCallback((item: InboxNotification, event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse") markItemRead(item);
  }, [markItemRead]);

  useEffect(() => {
    const justOpened = opened && !wasOpenedRef.current;
    wasOpenedRef.current = opened;
    if (justOpened && user && inboxIsStale) {
      void refetchInbox();
    }
    if (justOpened && user && importantNoticesAreStale) {
      void refetchImportantNotices();
    }
  }, [importantNoticesAreStale, inboxIsStale, opened, refetchImportantNotices, refetchInbox, user?.id]);

  const openItem = useCallback((item: InboxNotification) => {
    markItemRead(item);
    setOpened(false);
    if (item.entity_type === "announcement") {
      void navigate({ to: "/announcements/$announcementId", params: { announcementId: item.entity_id } });
    } else if (item.entity_type === "event") {
      void navigate({ to: "/events/$id", params: { id: item.entity_id } });
    } else if (item.entity_type === "wiki_article") {
      void navigate({ to: "/wiki/$slug", params: { slug: item.payload.slug } });
    } else {
      void navigate({ to: "/roster" });
    }
  }, [markItemRead, navigate]);

  const openImportantNotice = useCallback((notice: ImportantNoticeActive) => {
    markImportantNoticeRead(notice);
    setOpened(false);
    setSelectedNotice(notice);
  }, [markImportantNoticeRead]);

  const items = flattenInboxNotifications(inboxQuery.data);
  const importantNotices = importantNoticesQuery.data ?? [];
  const importantNoticeUnreadCount = importantNotices.filter((notice) => notice.read_at === null).length;
  const unreadCount = (inboxQuery.data?.pages[0]?.unread_count ?? 0) + importantNoticeUnreadCount;
  const triggerLabel = unreadCount > 0 ? t("label.notificationsUnread", { count: unreadCount }) : t("label.notifications");

  const triggerGlyph = (
    <span className={styles.triggerGlyph}>
      <NotificationOutlined aria-hidden="true" />
      {unreadCount > 0 ? <span className={styles.unreadIndicator} aria-hidden="true" /> : null}
    </span>
  );

  const markAllButton = (
    <Button
      variant="ghost"
      size="xs"
      className={styles.markAllButton}
      disabled={unreadCount === 0 || markReadMutation.isPending || markImportantNoticesReadMutation.isPending}
      onClick={markAllRead}
    >
      <CheckIcon size={14} aria-hidden="true" />
      {t("action.markAllRead")}
    </Button>
  );

  const noticeListBody = importantNoticesQuery.isLoading && importantNotices.length === 0 ? (
    <div className={styles.loading} role="status" aria-label={t("message.loading")}>
      <Skeleton className={styles.skeleton} />
    </div>
  ) : importantNoticesQuery.isError && importantNotices.length === 0 ? (
    <div className={styles.error} role="alert">
      <p>{t("notification.noticesLoadError")}</p>
      <Button size="xs" variant="outline" onClick={() => void importantNoticesQuery.refetch()}>
        {t("action.retry")}
      </Button>
    </div>
  ) : (
    <div className={styles.list}>
      {importantNotices.map((notice) => {
        const isUnread = notice.read_at === null;
        const requiresAcknowledgement = notice.requires_acknowledgement && notice.acknowledged_at === null;
        const detail = extractTipTapText(notice.body_json).replace(/\s+/gu, " ").trim();
        return (
          <div
            key={notice.id}
            className={`${styles.item}${isUnread ? ` ${styles.itemUnread}` : ""}`}
          >
            <button
              type="button"
              className={styles.itemButton}
              aria-label={t(
                requiresAcknowledgement ? "notification.aria.openRequired" : "notification.aria.open",
                { title: notice.title },
              )}
              onClick={() => openImportantNotice(notice)}
            >
              <div className={styles.itemCopy}>
                <div className={styles.itemTitleRow}>
                  <span className={`${styles.itemTitle}${isUnread ? ` ${styles.itemTitleUnread}` : ""}`}>
                    {notice.title}
                  </span>
                  <Badge
                    variant="outline"
                    className={`${styles.typeBadge} ${requiresAcknowledgement ? styles.badgeRequired : styles.badgeNotice}`}
                  >
                    {t(requiresAcknowledgement ? "notification.acknowledgementRequired" : "notification.noticeBadge")}
                  </Badge>
                </div>
                {detail ? <span className={styles.itemDetail}>{detail}</span> : null}
              </div>
              <time className={styles.time} dateTime={notice.published_at}>
                {formatDistanceToNow(new Date(notice.published_at), { addSuffix: true, locale: dateFnsLocale })}
              </time>
            </button>
          </div>
        );
      })}
    </div>
  );

  const activityListBody = inboxQuery.isLoading && items.length === 0 ? (
    <div className={styles.loading} role="status" aria-label={t("message.loading")}>
      <Skeleton className={styles.skeleton} />
      <Skeleton className={styles.skeleton} />
    </div>
  ) : inboxQuery.isError && items.length === 0 ? (
    <div className={styles.error} role="alert">
      <p>{t("notification.activityLoadError")}</p>
      <Button size="xs" variant="outline" onClick={() => void inboxQuery.refetch()}>
        {t("action.retry")}
      </Button>
    </div>
  ) : items.length === 0 ? (
    <p className={styles.sectionEmpty}>{t("notification.activityEmpty")}</p>
  ) : (
    <div className={styles.list}>
      {items.map((item) => {
        const presentation = getInboxNotificationPresentation(item, t);
        const isUnread = item.read_at === null;
        const accessibleTitle = `${t(presentation.titleKey)}: ${presentation.detail}`;
        return (
          <div
            key={item.id}
            className={`${styles.item}${isUnread ? ` ${styles.itemUnread}` : ""}`}
          >
            <button
              type="button"
              className={styles.itemButton}
              aria-label={t("notification.aria.open", { title: accessibleTitle })}
              onClick={() => openItem(item)}
              onPointerEnter={(event) => markPointerItemRead(item, event)}
              onFocus={() => markItemRead(item)}
            >
              <div className={styles.itemCopy}>
                <div className={styles.itemTitleRow}>
                  <span className={`${styles.itemTitle}${isUnread ? ` ${styles.itemTitleUnread}` : ""}`}>
                    {t(presentation.titleKey)}
                  </span>
                  <Badge
                    variant="outline"
                    className={`${styles.typeBadge} ${notificationToneClassNames[presentation.tone]}`}
                  >
                    {t(presentation.badgeKey)}
                  </Badge>
                </div>
                <span className={styles.itemDetail}>{presentation.detail}</span>
              </div>
              <time className={styles.time} dateTime={item.occurred_at}>
                {formatDistanceToNow(new Date(item.occurred_at), { addSuffix: true, locale: dateFnsLocale })}
              </time>
            </button>
          </div>
        );
      })}
      {inboxQuery.isFetchNextPageError ? (
        <div className={`${styles.error} ${styles.paginationError}`} role="alert">
          <p>{t("notification.loadMoreError")}</p>
          <Button type="button" size="xs" variant="outline" onClick={() => void inboxQuery.fetchNextPage()}>
            {t("action.retry")}
          </Button>
        </div>
      ) : inboxQuery.hasNextPage ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={styles.loadMoreButton}
          loading={inboxQuery.isFetchingNextPage}
          onClick={() => void inboxQuery.fetchNextPage()}
        >
          {t("action.loadMore")}
        </Button>
      ) : null}
    </div>
  );

  const notificationBody = importantNotices.length === 0
    && items.length === 0
    && !importantNoticesQuery.isLoading
    && !inboxQuery.isLoading
    && !importantNoticesQuery.isError
    && !inboxQuery.isError ? (
      <div className={styles.empty}><EmptyState title={t("notification.empty")} /></div>
    ) : (
      <div className={styles.sections}>
        <section className={styles.section} aria-labelledby="notification-notices-heading">
          <div className={styles.sectionHeader}>
            <h3 id="notification-notices-heading" className={styles.sectionTitle}>{t("notification.noticesSection")}</h3>
            <span className={styles.sectionHint}>{t("notification.noticesHint")}</span>
          </div>
          {importantNotices.length === 0 && !importantNoticesQuery.isLoading && !importantNoticesQuery.isError
            ? <p className={styles.sectionEmpty}>{t("notification.noticesEmpty")}</p>
            : noticeListBody}
        </section>
        <section className={styles.section} aria-labelledby="notification-activity-heading">
          <div className={styles.sectionHeader}>
            <h3 id="notification-activity-heading" className={styles.sectionTitle}>{t("notification.activitySection")}</h3>
            <span className={styles.sectionHint}>{t("notification.activityHint")}</span>
          </div>
          {activityListBody}
        </section>
      </div>
    );
  if (isPhone) {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`${styles.trigger} app-header-icon-btn`}
          aria-label={triggerLabel}
          aria-expanded={opened}
          aria-controls="notification-inbox-drawer"
          onClick={() => setOpened((current) => !current)}
        >
          {triggerGlyph}
        </Button>
        <Drawer open={opened} onOpenChange={setOpened} swipeDirection="down">
          <DrawerContent id="notification-inbox-drawer" className={styles.drawerContent}>
            <DrawerHeader className={styles.drawerHeader}>
              <div className={styles.drawerTitleGroup}>
                <DrawerTitle className={styles.drawerTitle}>{t("label.notifications")}</DrawerTitle>
                {unreadCount > 0 ? <Badge className={styles.countBadge}>{unreadCount}</Badge> : null}
              </div>
              <DrawerClose
                aria-label={t("action.close")}
                render={<button type="button" className={styles.drawerClose} />}
              >
                <XIcon size={18} aria-hidden="true" />
              </DrawerClose>
            </DrawerHeader>
            <div className={styles.drawerActions}>{markAllButton}</div>
            <div className={styles.drawerBody}>{notificationBody}</div>
          </DrawerContent>
        </Drawer>
        <ImportantNoticeReaderDialog
          notice={selectedNotice}
          onOpenChange={(open) => { if (!open) setSelectedNotice(null); }}
        />
      </>
    );
  }

  return (
    <>
      <Popover open={opened} onOpenChange={setOpened}>
        <PopoverTrigger
          type="button"
          className={`${styles.trigger} app-header-icon-btn`}
          aria-label={triggerLabel}
        >
          {triggerGlyph}
        </PopoverTrigger>
        <PopoverContent className={styles.dropdown} align="end" side="bottom" sideOffset={8}>
          <div className={styles.overlay}>
            <div className={styles.header}>
              <div className={styles.titleGroup}>
                <PopoverTitle className={styles.title}>{t("label.notifications")}</PopoverTitle>
                {unreadCount > 0 ? <Badge className={styles.countBadge}>{unreadCount}</Badge> : null}
              </div>
              {markAllButton}
            </div>
            {notificationBody}
          </div>
        </PopoverContent>
      </Popover>
      <ImportantNoticeReaderDialog
        notice={selectedNotice}
        onOpenChange={(open) => { if (!open) setSelectedNotice(null); }}
      />
    </>
  );
}
