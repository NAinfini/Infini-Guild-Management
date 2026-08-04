import type { BadgeAssignment } from "@guild/shared";
import { ActionIcon, Avatar, Text, Tooltip } from "@mantine/core";
import { XIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import { MemberRoleAvatar } from "../../shared/MemberRoleAvatar";
import { PickListFrame, PickListStaticRow } from "../../shared/PickList";
import type { AdminBadgeMemberRow } from "./AdminBadgesSection";

/*
 * 已分配成员。原先一个人占一整行、右端一个删除按钮，中间上千像素空白，除了名字
 * 什么都看不到。现在是一份紧凑名单：头像认人，授予时间（后端一直在返回，页面此前
 * 整个丢掉了）靠右成列，停上去还有授予人；行高压到 44px，九个人不再占满一屏。
 */
export function AdminBadgeMemberList({
  assignments,
  memberById,
  isUnassignPending,
  onUnassign,
}: {
  assignments: BadgeAssignment[];
  memberById: Map<string, AdminBadgeMemberRow>;
  isUnassignPending: (userId: string) => boolean;
  onUnassign: (userId: string) => void;
}) {
  const { t, i18n } = useTranslation("admin");
  const formatDay = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { year: "numeric", month: "short", day: "numeric" });
  const formatMoment = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  return (
    <PickListFrame>
      {assignments.map((assignment) => {
        const row = memberById.get(assignment.user_id);
        const name = assignment.username ?? row?.user.username ?? assignment.user_id.slice(0, 8);
        const grantedBy = assignment.assigned_by_username;
        const pending = isUnassignPending(assignment.user_id);
        return (
          <PickListStaticRow
            key={assignment.user_id}
            icon={row ? (
              /* 不挂职业圈：这一页看的是「谁有这枚徽章」，职业图标是另一件事。 */
              <MemberRoleAvatar
                user={row.user}
                profile={row.profile}
                size={28}
                withTooltip={false}
                withClassCircles={false}
              />
            ) : (
              <Avatar size={28} radius="xl" color="portal-brand">
                {name.slice(0, 1).toUpperCase()}
              </Avatar>
            )}
            label={<Text size="sm" fw={500} truncate>{name}</Text>}
            meta={(
              <>
                <Tooltip
                  label={grantedBy
                    ? t("badges.grantedBy", { user: grantedBy, datetime: formatMoment(assignment.assigned_at) })
                    : t("badges.grantedAt", { datetime: formatMoment(assignment.assigned_at) })}
                >
                  <Text size="xs" c="dimmed">
                    {t("badges.grantedOn", { date: formatDay(assignment.assigned_at) })}
                  </Text>
                </Tooltip>
                {/* size={44} 是 19788bf「improve tablet accessibility」定的触控靶面。 */}
                <ActionIcon
                  variant="subtle"
                  color="red"
                  size={44}
                  aria-label={t("badges.action.unassign")}
                  onClick={() => onUnassign(assignment.user_id)}
                  loading={pending}
                  disabled={pending}
                >
                  <XIcon size={14} />
                </ActionIcon>
              </>
            )}
          />
        );
      })}
    </PickListFrame>
  );
}
