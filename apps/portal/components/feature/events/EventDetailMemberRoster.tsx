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
 * 分组本身的规则见 class-quota-view.ts：分组人数必须跟筹码上的分子一致。
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
  const quotaGroups = useMemo(
    () => (quotaSummary ? groupMembersByClassQuota(quotaSummary, members) : null),
    [quotaSummary, members],
  );

  const renderRow = (entry: MemberEntry) => (
    <Group key={entry.user.id} gap={10} className="event-detail-modal__member-row" wrap="nowrap">
      <MemberRoleAvatar user={entry.user} profile={entry.profile} size={40} withTooltip={false} />
      <div className="event-detail-modal__member-info">
        <Text size="sm" fw={700}>{entry.user.username}</Text>
        <Group gap={6}>
          <Text size="xs" c="dimmed">
            {entry.profile.classes[0]
              ? resolveClassCatalogItem(entry.profile.classes[0], classCatalog).label
              : "-"}
          </Text>
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

  return (
    <>
      {quotaSummary ? (
        <EventClassQuotaChips summary={quotaSummary} className="event-detail-modal__quota-row" />
      ) : null}

      {members.length === 0 ? (
        <Text c="dimmed" size="sm">{t("detail.noMembers")}</Text>
      ) : quotaGroups ? (
        <div className="event-detail-modal__member-list">
          <Stack gap={16}>
            {quotaGroups.map((group) => {
              const item = group.kind === "quota"
                ? resolveClassCatalogItem(group.slot.class_id, classCatalog)
                : null;
              return (
                <div key={group.kind === "quota" ? group.slot.class_id : group.kind}>
                  <Group gap={6} mb={8} wrap="nowrap">
                    {group.kind === "quota" && item ? (
                      <>
                        <ClassIcon item={item} size={18} framed={false} />
                        <Text size="xs" fw={800}>{item.label}</Text>
                        <Text
                          size="xs"
                          fw={800}
                          className="quota-status-text"
                          data-quota-status={group.slot.status}
                        >
                          {group.slot.dedicated}/{group.slot.required}
                        </Text>
                      </>
                    ) : (
                      <Text size="xs" fw={800} c="dimmed">
                        {t(group.kind === "flexible" ? "quota.group.flexible" : "quota.group.unassigned", {
                          count: group.members.length,
                        })}
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
