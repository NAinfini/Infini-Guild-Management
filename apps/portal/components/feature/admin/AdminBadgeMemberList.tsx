import type { BadgeAssignment } from "@guild/shared";
import { ActionIcon, Avatar, Text, Tooltip } from "@mantine/core";
import { XIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import { MemberRoleAvatar } from "../../shared/MemberRoleAvatar";
import { PickListFrame, PickListStaticRow } from "../../shared/PickList";
import type { AdminBadgeMemberRow } from "./AdminBadgesSection";

/** Compact assigned-member list with assignment provenance. */
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
