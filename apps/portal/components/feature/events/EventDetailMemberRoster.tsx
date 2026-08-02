import type { Event, MemberProfile, User } from "@guild/shared";
import { Button, Group, Stack, Text, Tooltip } from "@mantine/core";
import { UserMinusIcon } from "@portal/components/icons";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { resolveClassCatalogItem, useClassCatalogStore } from "@portal/stores/class-catalog";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EventMemberIdentity } from "./EventMemberIdentity";
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

  const renderRow = (entry: MemberEntry) => (
    <Group key={entry.user.id} gap={10} className="event-detail-modal__member-row" wrap="nowrap">
      <EventMemberIdentity entry={entry} />
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

  return (
    <>
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
                        {/* 组头上只有一排图标，认不出哪个是哪个职业就等于没写；
                            悬停给名字，同时 label 让读屏也念得出来。 */}
                        {group.slot.class_ids.map((classId) => {
                          const item = resolveClassCatalogItem(classId, classCatalog);
                          return (
                            <Tooltip key={classId} label={item.label} withArrow>
                              <span className="event-detail-modal__group-class">
                                <ClassIcon item={item} size={18} framed={false} label={item.label} />
                              </span>
                            </Tooltip>
                          );
                        })}
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
