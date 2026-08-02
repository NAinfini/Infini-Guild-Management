import type { Event, MemberProfile, User } from "@guild/shared";
import { EVENT_TYPE_COLORS, UNKNOWN_EVENT_TYPE_COLOR } from "@portal/utils/event-colors";
import { Badge, Group, HoverCard, Paper, Stack, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import {
  ArchiveIcon,
  CalendarEventIcon,
  ChartBarIcon,
  ClockIcon,
  FriendsIcon,
  GiftIcon,
  LockIcon,
  PinIcon,
  RefreshCwIcon,
  Sparkles2Icon,
  SparklesIcon,
  SwordsIcon,
  TargetArrowIcon,
  UsersIcon,
} from "@portal/components/icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { MemberAvatarStack } from "@portal/components/shared/MemberAvatarStack";
import { EventClassQuotaChips } from "./EventClassQuotaChips";
import { summariseEventClassQuotas } from "./class-quota-view";

// Icons are not carried in the game config (config stores string identifiers like
// "TargetOutlined", not React nodes). The local map is keyed on event type ids;
// unknown types fall back to CalendarEventIcon via the ?? below.
const EVENT_TYPE_ICONS: Record<string, React.ReactNode> = {
  weekly_mission: <TargetArrowIcon size={12} />,
  guild_war: <SwordsIcon size={12} />,
  social: <FriendsIcon size={12} />,
  poll: <ChartBarIcon size={12} />,
  raffle: <GiftIcon size={12} />,
  other: <CalendarEventIcon size={12} />,
};

function getTypeGradientClass(type: string): string {
  return `event-card__header--${type in EVENT_TYPE_COLORS ? type : "other"}`;
}

// The card's meta row is one line wide. "2026年7月25日周六" plus "下午5:15 - 下午7:15"
// overflowed it on every card, so the year is only spelled out when the event is
// not in the current year, and the clock format is left to the locale (zh-CN
// resolves to 24h, en-US keeps AM/PM) instead of being forced to 12h.
function formatLocalDate(startAt: string, locale: string, now: Date): string {
  const date = new Date(startAt);
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(locale, {
    weekday: "short",
    ...(sameYear ? null : { year: "numeric" }),
    month: "short",
    day: "numeric",
  });
}

function formatLocalTime(startAt: string, endAt: string | null, locale: string): string {
  const start = new Date(startAt);
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const startTime = start.toLocaleTimeString(locale, timeOpts);
  if (!endAt) return startTime;
  const end = new Date(endAt);
  const endTime = end.toLocaleTimeString(locale, timeOpts);
  return `${startTime}–${endTime}`;
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
    <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
      <HoverCard.Target>
        <span
          className="event-card__status-icon"
          data-animate-icon-trigger
          role="img"
          aria-label={title}
          tabIndex={0}
        >
          {children}
        </span>
      </HoverCard.Target>
      <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
        <Group gap={10} wrap="nowrap" align="flex-start">
          <ThemeIcon variant="light" color={color} size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
            {icon}
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Text size="sm" fw={700} lh={1.3} mb={4}>{title}</Text>
            <Text size="xs" c="dimmed" lh={1.5}>{description}</Text>
          </div>
        </Group>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

/*
 * 活动卡的展示层：只吃数据，不碰 store、不发请求、不弹确认框。
 *
 * 拆出来是因为周期模板编辑器要在右栏画一张「下一次会生成这个」的预览卡。预览要是
 * 另写一份 JSX，它和线上卡片迟早会长得不一样——那张预览就成了谎言。所以两处共用
 * 这一个组件，模板那边传一个拼出来的 Event 和空成员列表，不传任何操作插槽。
 *
 * 交互全部走插槽（headerActions / menu / footer）。展示层不知道「报名」是什么，
 * 也不知道谁有权限——那些是容器的事。
 */
type EventCardViewProps = {
  event: Event;
  now: Date;
  /** 卡上要露脸的人。投票活动传投票者，其余传报名者；模板预览传空数组。 */
  members: readonly MemberEntry[];
  flag?: "NEW" | "UPDATED";
  isFocused?: boolean;
  /** 整卡点击的鼠标快捷方式。模板预览不传，卡片就不可点。 */
  onOpenDetail?: () => void;
  /** 色带右端、kebab 左侧的按钮（复制 @提及）。 */
  headerActions?: React.ReactNode;
  /** 色带最右的管理菜单。 */
  menu?: React.ReactNode;
  /** 页脚。这里只放主操作按钮，不放文字：禁用原因由色带上的状态图标和按钮自己的 Tooltip 说。 */
  footer?: React.ReactNode;
};

export function EventCardView({
  event,
  now,
  members,
  flag,
  isFocused = false,
  onOpenDetail,
  headerActions,
  menu,
  footer,
}: EventCardViewProps) {
  const { t, i18n } = useTranslation("events");
  const joinedCount = members.length;
  const typeColor = EVENT_TYPE_COLORS[event.type] ?? UNKNOWN_EVENT_TYPE_COLOR;
  const raffleHasDrawn = event.type === "raffle" && (event.raffle_winners?.length ?? 0) > 0;
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

  /*
   * The card used to be role="button" + tabIndex={0}, but it also holds
   * real buttons (copy mentions, the kebab menu, the signup actions), so
   * it was a widget with focusable descendants — unusable by keyboard and
   * screen reader alike. The whole-card click stays as a mouse shortcut;
   * the title below is the focusable affordance that opens the detail.
   */
  return (
    <Paper
      withBorder
      className={`event-card${isFocused ? " event-card--focused" : ""}`}
      onClick={onOpenDetail}
      style={onOpenDetail ? { cursor: "pointer" } : undefined}
    >
      {/* ── 色带：身份与管理 ── */}
      <div className={`event-card__header ${getTypeGradientClass(event.type)}`}>
        <div className="event-card__header-left">
          <Badge
            size="sm"
            variant="light"
            color={typeColor}
            className="event-card__type-badge"
            leftSection={EVENT_TYPE_ICONS[event.type] ?? EVENT_TYPE_ICONS.other}
          >
            {t(`common:eventType.${event.type}`)}
          </Badge>
        </div>
        {/* 状态图标固定单行不换行——它一换行整张卡就变高，一排卡片的底边就参差不齐。 */}
        <div className="event-card__status-rail">{statusIndicators}</div>
        <div className="event-card__header-right">
          {headerActions}
          {menu}
        </div>
      </div>

      {/* ── 正文：这场活动是什么 ── */}
      <div className="event-card__body">
        <Stack gap={8}>
          <UnstyledButton
            className="event-card__title-btn"
            onClick={onOpenDetail}
            component={onOpenDetail ? "button" : "div"}
          >
            <Text component="h2" fw={700} size="md" className="event-card__title">
              {event.title}
            </Text>
          </UnstyledButton>

          <Group gap={6} align="center" wrap="nowrap">
            <CalendarEventIcon size={14} className="event-card__icon-muted" />
            <Text size="xs" className="event-card__date-text">
              {formatLocalDate(event.start_at, i18n.language, now)}
            </Text>
            <Text size="xs" c="dimmed">·</Text>
            <ClockIcon size={14} className="event-card__icon-muted" />
            <Text size="xs" className="event-card__time-text">
              {formatLocalTime(event.start_at, event.end_at, i18n.language)}
            </Text>
          </Group>

          <Text size="xs" c="dimmed" lineClamp={1} className="event-card__description">
            {event.description || t("card.noDescription")}
          </Text>

          {/* ── 参与状况：上一行是谁来了，下一行是缺什么、来了多少 ── */}
          <div className="event-card__members-bar">
            {raffleHasDrawn ? (
              <span className="event-card__winners-tag">
                <GiftIcon size={13} />
                <span>{t("raffle.detail.winnersLabel")}</span>
              </span>
            ) : null}
            <MemberAvatarStack members={members} />
          </div>

          {/*
           * 人数跟配额筹码同一行：两边讲的是同一件事（还缺不缺人），而且这一行**永远**
           * 渲染——没配额的卡也有人数，行数才不会随配额有无变化。以前配额行是条件渲染，
           * 同一排卡里有的三行有的两行，页脚按钮跟着高低不齐。
           *
           * 容量进度条撤了：同一行右端已经有 10/20，进度条是把同一个数再画一遍，
           * 而且它占的横向空间正是筹码要用的。
           */}
          <div className="event-card__tally">
            {quotaSummary ? <EventClassQuotaChips summary={quotaSummary} event={event} /> : null}
            <div className="event-card__capacity">
              <UsersIcon size={13} />
              <span>{joinedCount}/{event.capacity ?? "∞"}</span>
            </div>
          </div>
        </Stack>
      </div>

      {/* ── 页脚：你要不要去。只有一个右对齐的按钮，不放任何文字。 ── */}
      {footer ? <div className="event-card__footer">{footer}</div> : null}
    </Paper>
  );
}
