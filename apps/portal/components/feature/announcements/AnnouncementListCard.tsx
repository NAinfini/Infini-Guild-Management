import type { AnnouncementSummary } from "@guild/shared";
import type { AnnouncementStatus } from "@guild/shared/constants/announcements";
import {
  ArchiveIcon,
  CalendarTimeIcon,
  CircleCheckIcon,
  FileTextIcon,
  PlusIcon,
} from "@portal/components/icons";
import { Alert, AlertTitle } from "@portal/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@portal/components/ui/avatar";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Skeleton } from "@portal/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@portal/components/ui/tooltip";
import { formatDateTimeWithTimeZone } from "@portal/utils/datetime";
import { resolveMediaUrl } from "@portal/utils/media";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

const STATUS_ICON = {
  draft: <FileTextIcon size={14} className="announcement-item-status-icon--draft" />,
  scheduled: <CalendarTimeIcon size={14} className="announcement-item-status-icon--scheduled" />,
  published: <CircleCheckIcon size={14} className="announcement-item-status-icon--published" />,
  archived: <ArchiveIcon size={14} className="announcement-item-status-icon--archived" />,
} satisfies Record<AnnouncementStatus, ReactNode>;

type AnnouncementListCardProps = {
  title: ReactNode;
  rows: AnnouncementSummary[];
  selectedId: string | null;
  canEdit: boolean;
  canCreate: boolean;
  announcementsLastSeenAt: string | null;
  isLoading: boolean;
  isError: boolean;
  warningMessage: ReactNode;
  emptyText: ReactNode;
  onSelect: (id: string) => void;
  onCreate?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
};

function isUnread(updatedAt: string, lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  return Date.parse(updatedAt) > Date.parse(lastSeenAt);
}

export function AnnouncementListCard({
  title,
  rows,
  selectedId,
  canEdit,
  canCreate,
  announcementsLastSeenAt,
  isLoading,
  isError,
  warningMessage,
  emptyText,
  onSelect,
  onCreate,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: AnnouncementListCardProps) {
  const { t } = useTranslation("announcements");

  return (
    <Card className="announcements-list-card">
      <header className="announcements-list-card__header">
        <h2 className="announcements-list-card__title">{title}</h2>
        {canCreate && onCreate ? (
          <Button type="button" size="sm" onClick={onCreate}>
            <PlusIcon size={16} aria-hidden="true" />
            {t("action.newAnnouncement")}
          </Button>
        ) : null}
      </header>

      <div className="announcements-list-card__content announcements-card-scroll">
        {isLoading ? (
          <div className="announcements-list-skeletons" aria-busy="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="announcements-list-skeleton">
                <Skeleton className="announcements-list-skeleton__title" />
                <Skeleton className="announcements-list-skeleton__meta" />
              </div>
            ))}
          </div>
        ) : null}

        {isError ? (
          <Alert variant="destructive">
            <AlertTitle>{warningMessage}</AlertTitle>
          </Alert>
        ) : null}

        {!isLoading && !isError ? (
          rows.length > 0 ? (
            <div className="announcements-list" role="list">
              {rows.map((item) => {
                const authorName = item.author.display_name;
                const publishedAt = item.publish_at ?? item.created_at;
                const timestampKey = item.status === "scheduled"
                  ? "meta.scheduled"
                  : item.status === "draft"
                    ? "meta.created"
                    : "meta.published";
                const showStatus = canEdit || item.status === "archived";

                return (
                  <div key={item.id} className="announcements-list-row" role="listitem">
                    {isUnread(item.updated_at, announcementsLastSeenAt) ? (
                      <span className="announcement-list-unread" aria-hidden="true" />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onSelect(item.id)}
                      aria-pressed={item.id === selectedId}
                      className={`announcement-item ${item.id === selectedId ? "announcement-item--active" : ""}`.trim()}
                    >
                      <span className="announcement-item-title">
                        <span className="announcement-item-headline">
                          {item.pinned ? (
                            <Badge variant="outline" className="announcement-important-badge">
                              {t("status.important")}
                            </Badge>
                          ) : null}
                          <span className="announcement-item-title-text">{item.title}</span>
                        </span>
                        {showStatus ? (
                          <span className="announcement-item-meta">
                            <Tooltip>
                              <TooltipTrigger
                                delay={350}
                                render={<span className="announcement-item-status-trigger" data-animate-icon-trigger />}
                              >
                                {STATUS_ICON[item.status]}
                                <span className="sr-only">{t(`status.${item.status}`)}</span>
                              </TooltipTrigger>
                              <TooltipContent className="announcement-status-tooltip" side="top">
                                <strong>{t(`status.${item.status}`)}</strong>
                                <span>{t(`tooltip.status.${item.status}.desc`)}</span>
                              </TooltipContent>
                            </Tooltip>
                          </span>
                        ) : null}
                      </span>

                      <span className="announcement-item-author-row">
                        <Avatar size="sm">
                          {item.author.avatar_media_id ? (
                            <AvatarImage
                              src={resolveMediaUrl(item.author.avatar_media_id)}
                              alt=""
                            />
                          ) : null}
                          <AvatarFallback>{authorName.trim().charAt(0).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="announcement-item-author">{authorName}</span>
                        <span className="announcement-meta-separator" aria-hidden="true" />
                        <span className="announcement-item-time">
                          {t(timestampKey, { datetime: formatDateTimeWithTimeZone(publishedAt) })}
                        </span>
                      </span>
                    </button>
                  </div>
                );
              })}

              {hasMore && onLoadMore ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isLoadingMore}
                  aria-busy={isLoadingMore || undefined}
                  className="announcements-list__load-more"
                  onClick={onLoadMore}
                >
                  {t("action.loadMore")}
                </Button>
              ) : null}
            </div>
          ) : (
            emptyText
          )
        ) : null}
      </div>
    </Card>
  );
}
