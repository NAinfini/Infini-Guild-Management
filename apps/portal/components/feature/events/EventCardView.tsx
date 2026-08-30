import type { Event, MemberProfile, User } from "@guild/shared";
import { Badge } from "@portal/components/ui/badge";
import { Card } from "@portal/components/ui/card";
import {
  TOOLTIP_CLOSE_DELAY_MS,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@portal/components/ui/tooltip";
import {
  ArchiveIcon,
  CalendarEventIcon,
  ClockIcon,
  GiftIcon,
  LockIcon,
  PinIcon,
  RefreshCwIcon,
  Sparkles2Icon,
  SparklesIcon,
  UsersIcon,
} from "@portal/components/icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { MemberAvatarStack } from "@portal/components/shared/MemberAvatarStack";
import { EventQuotaBar } from "./EventQuotaBar";
import { summariseEventClassQuotas } from "./class-quota-view";
import { eventHasBehavior, getEventTypeLabel } from "@portal/utils/game-rules";
import { EventTypeIcon } from "@portal/components/shared/EventTypeIcon";
import { eventTypeColor } from "@portal/utils/event-colors";
import { formatEventTimeRange, formatLocaleParts } from "@portal/utils/datetime";

// The card's meta row is one line wide. "2026年7月25日周六" plus "下午5:15 - 下午7:15"
// overflowed it on every card, so the year is only spelled out when the event is
// not in the current year, and the clock format is left to the locale (zh-CN
// resolves to 24h, en-US keeps AM/PM) instead of being forced to 12h.
function formatLocalDate(startAt: string, locale: string, now: Date): string {
  const sameYear = new Date(startAt).getFullYear() === now.getFullYear();
  return formatLocaleParts(startAt, locale, {
    weekday: "short",
    ...(sameYear ? null : { year: "numeric" }),
    month: "short",
    day: "numeric",
  });
}

type MemberEntry = { user: User; profile: MemberProfile };

type EventStatusIndicatorProps = {
  children: React.ReactNode;
  color: string;
  icon: React.ReactNode;
  title: string;
  description: string;
};

function EventStatusIndicator({ children, color, icon, title, description }: EventStatusIndicatorProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={350}
        closeDelay={TOOLTIP_CLOSE_DELAY_MS}
        render={<span
          className="event-card__status-icon"
          data-animate-icon-trigger
          role="img"
          aria-label={title}
          tabIndex={0}
        />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent className="event-card__status-tooltip" side="top">
        <span className="event-card__status-tooltip-icon" style={{ color }}>{icon}</span>
        <span><strong>{title}</strong><span>{description}</span></span>
      </TooltipContent>
    </Tooltip>
  );
}

/*
 * 活动卡的展示层：只吃数据，不碰 store、不发请求、不弹确认框。
 *
 * 拆出来是因为周期模板编辑器要在右栏画一张「下一次会生成这个」的预览卡。预览要是
 * 另写一份 JSX，它和线上卡片迟早会长得不一样——那张预览就成了谎言。所以两处共用
 * 这一个组件，模板那边传一个拼出来的 Event 和空成员列表，不传任何操作插槽。
 *
 * 交互全部走插槽（headerActions / menu / participantAction）。展示层不知道「报名」是什么，
 * 也不知道谁有权限——那些是容器的事。
 */
type EventCardViewProps = {
  event: Event;
  now: Date;
  /** 卡上要露脸的人。投票活动传投票者，其余传报名者；模板预览传空数组。 */
  members: readonly MemberEntry[];
  flag?: "NEW" | "UPDATED";
  /** 整卡点击的鼠标快捷方式。模板预览不传，卡片就不可点。 */
  onOpenDetail?: () => void;
  /** 色带右端、kebab 左侧的按钮（复制 @提及）。 */
  headerActions?: React.ReactNode;
  /** 色带最右的管理菜单。 */
  menu?: React.ReactNode;
  /** 参与者头像右侧的主操作；禁用原因由状态图标和按钮自己的 Tooltip 说明。 */
  participantAction?: React.ReactNode;
};

export function EventCardView({
  event,
  now,
  members,
  flag,
  onOpenDetail,
  headerActions,
  menu,
  participantAction,
}: EventCardViewProps) {
  const { t, i18n } = useTranslation("events");
  const joinedCount = members.length;
  const overCapacity = event.capacity !== null && joinedCount > event.capacity;

  const typeColor = eventTypeColor(event.type);
  const raffleHasDrawn = eventHasBehavior(event.type, "raffle") && (event.raffle_winners?.length ?? 0) > 0;
  const quotaSummary = summariseEventClassQuotas(event, members);

  const statusIndicators = (
    <>
      {event.series_id ? (
        <EventStatusIndicator
          color="teal"
          icon={<RefreshCwIcon size={16} />}
          title={t("tooltip.recurring.title")}
          description={t("tooltip.recurring.desc")}
        >
          <RefreshCwIcon size={14} />
        </EventStatusIndicator>
      ) : null}
      {event.pinned ? (
        <EventStatusIndicator
          color="portal-brand"
          icon={<PinIcon size={16} />}
          title={t("tooltip.pinned.title")}
          description={t("tooltip.pinned.desc")}
        >
          <PinIcon size={16} className="event-card__status-icon--pinned" />
        </EventStatusIndicator>
      ) : null}
      {event.signup_locked ? (
        <EventStatusIndicator
          color="red"
          icon={<LockIcon size={16} />}
          title={t("tooltip.locked.title")}
          description={t("tooltip.locked.desc")}
        >
          <LockIcon size={16} className="event-card__status-icon--locked" />
        </EventStatusIndicator>
      ) : null}
      {event.archived_at ? (
        <EventStatusIndicator
          color="gray"
          icon={<ArchiveIcon size={16} />}
          title={t("tooltip.archived.title")}
          description={t("tooltip.archived.desc")}
        >
          <ArchiveIcon size={16} style={{ opacity: 0.5 }} />
        </EventStatusIndicator>
      ) : null}
      {flag === "NEW" ? (
        <EventStatusIndicator
          color="green"
          icon={<SparklesIcon size={16} />}
          title={t("tooltip.new.title")}
          description={t("tooltip.new.desc")}
        >
          <SparklesIcon size={16} className="event-card__status-icon--new" />
        </EventStatusIndicator>
      ) : null}
      {flag === "UPDATED" ? (
        <EventStatusIndicator
          color="orange"
          icon={<Sparkles2Icon size={16} />}
          title={t("tooltip.updated.title")}
          description={t("tooltip.updated.desc")}
        >
          <Sparkles2Icon size={16} className="event-card__status-icon--updated" />
        </EventStatusIndicator>
      ) : null}
    </>
  );

  // The card contains interactive descendants, so only its title receives the
  // keyboard link affordance; the card-level click remains a pointer shortcut.
  return (
    <Card
      className="event-card p-0"
      onClick={onOpenDetail}
      style={{
        "--event-card-accent": typeColor,
        ...(onOpenDetail ? { cursor: "pointer" } : {}),
      } as React.CSSProperties}
    >
      {/*
       * 类型图标放大成水印，压在整张卡的右下角。活动卡以前只有一条 28px 的色带，
       * 一屏十几张卡除了徽章里那几个字全长一个样；给它一个 64px 的图形，卡片在
       * 扫视距离上就有了形状差异——不必读字也知道这是公会战还是抽奖。
       * 纯图标、无外部素材，所以不增加任何请求或包体。
       */}
      <span className="event-card__watermark" aria-hidden>
        <EventTypeIcon eventType={event.type} size={64} />
      </span>

      {/* ── 管理行：身份与操作 ── */}
      <div className="event-card__header">
        <div className="event-card__header-left">
          <Badge
            variant="outline"
            className="event-card__type-badge"
            style={{ "--event-card-badge-color": typeColor } as React.CSSProperties}
          >
            <EventTypeIcon eventType={event.type} size={12} />
            {getEventTypeLabel(event.type, i18n.language)}
          </Badge>
        </div>
        {/* 状态图标固定单行不换行——它一换行整张卡就变高，一排卡片的底边就参差不齐。 */}
        <div className="event-card__status-rail">{statusIndicators}</div>
        <div className="event-card__header-right">
          {/*
           * 人数上到色带来了。它在正文里跟配额筹码抢同一行的宽度：筹码一多就把人数挤到
           * 第二行，那张卡就比旁边高一截。色带这一行的宽度是固定的（徽章、状态图标、
           * 两个按钮都不随数据变宽），人数放这儿谁也挤不着谁。
           */}
          <div
            className="event-card__capacity"
            data-capacity-state={overCapacity ? "over" : undefined}
          >
            <UsersIcon size={13} />
            <span>{joinedCount}/{event.capacity ?? "∞"}</span>
          </div>
          {headerActions}
          {menu}
        </div>
      </div>

      {/* ── 正文：这场活动是什么 ── */}
      <div className="event-card__body">
        <div className="event-card__body-stack">
          {onOpenDetail ? (
          <button
            type="button"
            className="event-card__title-btn"
            onClick={(clickEvent) => {
              clickEvent.stopPropagation();
              onOpenDetail();
            }}
          >
            <h2 className="event-card__title">{event.title}</h2>
          </button>
          ) : <h2 className="event-card__title">{event.title}</h2>}

          <div className="event-card__datetime">
            <CalendarEventIcon size={14} className="event-card__icon-muted" />
            <span className="event-card__date-text">
              {formatLocalDate(event.start_at, i18n.language, now)}
            </span>
            <span className="event-card__datetime-divider">·</span>
            <ClockIcon size={14} className="event-card__icon-muted" />
            <span className="event-card__time-text">
              {formatEventTimeRange(event.start_at, event.end_at, i18n.language)}
            </span>
          </div>

          <p className="event-card__description">
            {event.description || t("card.noDescription")}
          </p>

          {/* 没配额也画：那时它是一条报名进度，「这场还收不收人」跟「缺哪个职业」在
              卡片上占同一个位置，不会因为活动类型不同而少一块。 */}
          <EventQuotaBar summary={quotaSummary} event={event} participantCount={joinedCount} />

          {/* ── 参与状况：先看缺口，再在同一行看成员并完成报名操作。 ── */}
          <div className="event-card__participation-row">
            <div className="event-card__members-bar">
              {raffleHasDrawn ? (
                <span className="event-card__winners-tag">
                  <GiftIcon size={13} />
                  <span>{t("raffle.detail.winnersLabel")}</span>
                </span>
              ) : null}
              <MemberAvatarStack members={members} />
            </div>
            {participantAction ? (
              <div className="event-card__participant-action">{participantAction}</div>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );
}
