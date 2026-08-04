import type { Event } from "@guild/shared";
import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { MemberAvatarStack } from "../shared/MemberAvatarStack";
import { ArrowRightIcon, ClockIcon } from "@portal/components/icons";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CalendarEventOutlined } from "../../utils/icons";
import { EventQuotaBar } from "../feature/events/EventQuotaBar";
import { EventTypeIcon } from "../shared/EventTypeIcon";
import { getEventTypeLabel } from "@portal/utils/game-rules";
import { useSiteConfigStore } from "@portal/stores/site-config";
import { EmptyState } from "../shared/EmptyState";
import {
  cardHeading,
  eventTypeTagColor,
  orderDashboardUpcomingRows,
  type DashboardUpcomingEventRow,
} from "./shared";

type UpcomingEventsCardProps = {
  upcomingEventsCount: number;
  featuredRows: DashboardUpcomingEventRow[];
  rows: DashboardUpcomingEventRow[];
  onOpenEvent: (event: Pick<Event, "id" | "title">) => void;
  onViewAll: () => void;
};

export const UpcomingEventsCard = memo(function UpcomingEventsCard({
  upcomingEventsCount,
  featuredRows,
  rows,
  onOpenEvent,
  onViewAll,
}: UpcomingEventsCardProps) {
  const { t, i18n } = useTranslation("dashboard");
  const gameRules = useSiteConfigStore((state) => state.gameRules);
  const safeUpcomingCount = Math.max(0, upcomingEventsCount);
  const hasAnyRows = featuredRows.length > 0 || rows.length > 0;
  const orderedRows = useMemo(
    () => orderDashboardUpcomingRows([...featuredRows, ...rows]),
    [featuredRows, rows],
  );

  return (
    <Paper withBorder radius="md" className="dashboard-card">
      <div>
      {/* The count used to sit under the heading as its own xl line, repeating what
          the list below already shows. It rides along with the heading now. */}
      {/* 徽章原先写着「6 场」，右边紧挨着的按钮又写「查看全部 6 场」，同一个数并排说
          两遍。留按钮：它既报了数又能点，徽章报了数却点不了。 */}
      <Group gap={8} align="center" wrap="nowrap" justify="space-between">
        {cardHeading(t("card.upcomingEvents.title"), <CalendarEventOutlined size={18} />)}
        {safeUpcomingCount > 0 ? (
          <Button size="xs" variant="subtle" onClick={onViewAll}>
            {t("card.upcomingEvents.viewAll", { count: safeUpcomingCount })}
          </Button>
        ) : null}
      </Group>
        {!hasAnyRows ? (
          <EmptyState title={t("empty")} />
        ) : (
          <Stack gap={8} mt={12}>
            {orderedRows.map((item) => {
              const signedUpCount = item.members.length;
              const capacity = item.item.capacity ?? 0;
              const startDate = new Date(item.item.start_at);
              const month = startDate.toLocaleString(i18n.language, { month: "short" }).toUpperCase();
              const day = startDate.getDate();

              return (
                <div
                  key={item.item.id}
                  className="upcoming-event-row"
                  data-has-quota={item.quotaSummary ? "true" : undefined}
                >
                  {/* 网格而不是一条 flex：原先中间那列是 flex:1，宽屏下标题和右边的
                      头像/容量之间是一千多像素的空白，两头看着毫无关系。配额条现在自己
                      占一列去填这块空白，顺带拿到一个稳定的宽度——它三个槽位是等分的，
                      挤在 flex 里时宽度由内容撑出来，于是每个槽位的名字和数字之间空多少
                      全看名字多长，看起来就是没对齐。 */}
                  <div className="upcoming-event-row__grid">
                    <div className="upcoming-event-row__date">
                      <span className="upcoming-event-row__month">{month}</span>
                      <span className="upcoming-event-row__day">{day}</span>
                    </div>
                    <div className="upcoming-event-row__main">
                      <Text
                        fw={600}
                        size="sm"
                        lineClamp={2}
                        className="upcoming-event-row__title"
                      >
                        {item.item.title}
                      </Text>
                      {item.item.description ? (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {item.item.description}
                        </Text>
                      ) : null}
                      {/* 这一行只留分类和时刻两样同类的东西。进度计原先也挤在这里，
                          三种性质不同的信息压在同一条基线上，谁都不先读到。 */}
                      <Group gap={6}>
                        <Badge size="xs" color={eventTypeTagColor(item.item.type)} variant="light" leftSection={<EventTypeIcon eventType={item.item.type} />}>
                          {getEventTypeLabel(item.item.type, i18n.language, gameRules)}
                        </Badge>
                        <Group gap={4}>
                          <ClockIcon size={12} style={{ opacity: 0.6 }} />
                          <Text size="xs" c="dimmed">
                            {startDate.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", hour12: false })}
                          </Text>
                        </Group>
                      </Group>
                    </div>
                    {/* 「还缺什么职业」跟活动卡上是同一行筹码：面板是大多数人每天
                        唯一会看的一页，缺人只在活动页显示等于没人看得见。 */}
                    {/* 面板这一行右边已经有容量数字了，没配额时再画一条报名进度是
                        同一件事说两遍，所以这里只在真有配额时渲染。 */}
                    {item.quotaSummary ? (
                      <div className="upcoming-event-row__quota">
                        <EventQuotaBar
                          summary={item.quotaSummary}
                          event={item.item}
                          participantCount={item.members.length}
                        />
                      </div>
                    ) : null}
                    {/* 头像和容量数字讲的是同一件事（谁报了名、报了几个），所以收进同一组
                        紧挨着放。原先中间隔着 12px 的行间距，那个 8/10 看上去像是跟右边的
                        箭头一伙的。跟活动卡用同一摞头像：叠着放、不挂职业圈。 */}
                    <div className="upcoming-event-row__people">
                      <div className="upcoming-event-row__avatars">
                        <MemberAvatarStack members={item.members} />
                      </div>
                      <Text
                        className="upcoming-event-row__capacity"
                        aria-label={t("card.upcomingEvents.capacity", {
                          current: signedUpCount,
                          capacity: capacity > 0 ? capacity : "∞",
                        })}
                      >
                        {capacity > 0 ? `${signedUpCount}/${capacity}` : "∞"}
                      </Text>
                    </div>
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => onOpenEvent(item.item)}
                      className="upcoming-event-row__go"
                      aria-label={t("card.upcomingEvents.viewEvent")}
                    >
                      <ArrowRightIcon size={16} />
                    </Button>
                  </div>
                </div>
              );
            })}
          </Stack>
        )}
      </div>
    </Paper>
  );
});
