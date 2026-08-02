import type { Event, MemberProfile, User } from "@guild/shared";
import { Button, Group, Stack, Text } from "@mantine/core";
import { UserMinusIcon } from "@portal/components/icons";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { MemberRoleAvatar } from "@portal/components/shared/MemberRoleAvatar";
import { resolveClassCatalogItem, useClassCatalogStore } from "@portal/stores/class-catalog";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EventClassQuotaChips } from "./EventClassQuotaChips";
import { groupMembersByClassQuota, summariseEventClassQuotas } from "./class-quota-view";

type MemberEntry = { user: User; profile: MemberProfile };

type EventDetailMemberRosterProps = {
  event: Pick<Event, "class_quotas">;
  members: MemberEntry[];
  canManage: boolean;
  onRemoveMember: (userId: string, username: string) => void;
};

/*
 * 活动详情弹窗里的报名名单。
 *
 * 有配额时按配额分组，没配额时保持原来那份平铺名单——分组只在真有配额时接管。
 * 分组本身的规则见 class-quota-view.ts：每组的人就是算法分进这一格的人，人数跟筹码上
 * 的分子同源。
 */
export function EventDetailMemberRoster({
  event,
  members,
  canManage,
  onRemoveMember,
}: EventDetailMemberRosterProps) {
  const { t } = useTranslation("events");
  const classCatalog = useClassCatalogStore((state) => state.items);

  const quotaSummary = useMemo(() => summariseEventClassQuotas(event, members), [event, members]);
  const labelByTagId = useMemo(
    () => new Map(event.class_quotas.map((quota) => [quota.tag_id, quota.label])),
    [event],
  );
  const quotaGroups = useMemo(
    () => (quotaSummary ? groupMembersByClassQuota(quotaSummary, members) : null),
    [quotaSummary, members],
  );

  /*
   * 职业不再挂在头像右下角那一圈小图标上：那里三个圈叠着，图标看不清、名字根本没有，
   * 想知道一个人能打什么还得把鼠标停上去。改成图标＋名字成对排在原来那一行，
   * 而且是全部职业按 profile.classes 的顺序排——他还能顶哪一格，看这一行就够了。
   */
  const renderRow = (entry: MemberEntry) => {
    const classItems = [...new Set(entry.profile.classes.filter(Boolean))].map((id) =>
      resolveClassCatalogItem(id, classCatalog),
    );
    return (
      <Group key={entry.user.id} gap={10} className="event-detail-modal__member-row" wrap="nowrap">
        <MemberRoleAvatar
          user={entry.user}
          profile={entry.profile}
          size={40}
          withTooltip={false}
          withClassCircles={false}
        />
        <div className="event-detail-modal__member-info">
          <Text size="sm" fw={700}>{entry.user.username}</Text>
          <Group gap={6}>
            {classItems.length === 0 ? <Text size="xs" c="dimmed">-</Text> : null}
            {classItems.map((item) => (
              <Group key={item.id} gap={4} wrap="nowrap">
                <ClassIcon item={item} size={14} framed={false} />
                <Text size="xs" c="dimmed">{item.label}</Text>
              </Group>
            ))}
            <Text size="xs" c="dimmed">-</Text>
            <Text size="xs" c="dimmed">{t("detail.power", { value: entry.profile.power ?? "-" })}</Text>
          </Group>
        </div>
        {canManage ? (
          <Button
            color="red"
            variant="light"
            size="sm"
            leftSection={<UserMinusIcon size={14} />}
            onClick={() => onRemoveMember(entry.user.id, entry.user.username)}
          >
            {t("detail.removeMember")}
          </Button>
        ) : null}
      </Group>
    );
  };

  return (
    <>
      {quotaSummary ? (
        <EventClassQuotaChips
          summary={quotaSummary}
          event={event}
          className="event-detail-modal__quota-row"
        />
      ) : null}

      {members.length === 0 ? (
        <Text c="dimmed" size="sm">{t("detail.noMembers")}</Text>
      ) : quotaGroups ? (
        <div className="event-detail-modal__member-list">
          <Stack gap={16}>
            {quotaGroups.map((group) => {
              return (
                <div key={group.kind === "quota" ? group.slot.key : group.kind}>
                  <Group gap={6} mb={8} wrap="nowrap">
                    {group.kind === "quota" ? (
                      <>
                        {group.slot.class_ids.map((classId) => (
                          <ClassIcon
                            key={classId}
                            item={resolveClassCatalogItem(classId, classCatalog)}
                            size={18}
                            framed={false}
                          />
                        ))}
                        <Text size="xs" fw={800}>
                          {labelByTagId.get(group.slot.key) ?? t("quota.editor.unknownTag")}
                        </Text>
                        <Text
                          size="xs"
                          fw={800}
                          className="quota-status-text"
                          data-quota-status={group.slot.status}
                        >
                          {group.slot.matched}/{group.slot.required}
                        </Text>
                      </>
                    ) : (
                      <Text size="xs" fw={800} c="dimmed">
                        {t("quota.group.other", { count: group.members.length })}
                      </Text>
                    )}
                  </Group>
                  {group.members.length === 0 ? (
                    <Text size="xs" c="dimmed">{t("quota.group.empty")}</Text>
                  ) : (
                    <Stack gap={8}>{group.members.map(renderRow)}</Stack>
                  )}
                </div>
              );
            })}
          </Stack>
        </div>
      ) : (
        <div className="event-detail-modal__member-list">
          <Stack gap={8}>{members.map(renderRow)}</Stack>
        </div>
      )}
    </>
  );
}
