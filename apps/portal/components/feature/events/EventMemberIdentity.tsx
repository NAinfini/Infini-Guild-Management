import type { MemberProfile, User } from "@guild/shared";
import { Group, Text } from "@mantine/core";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { MemberRoleAvatar } from "@portal/components/shared/MemberRoleAvatar";
import { resolveClassCatalogItem, useClassCatalogStore } from "@portal/stores/class-catalog";
import { useTranslation } from "react-i18next";

type MemberEntry = { user: User; profile: MemberProfile };

/*
 * 详情弹窗里「一个人长什么样」的唯一一份写法：头像＋名字＋职业（图标配名字）＋战力。
 *
 * 报名名单和抽奖中奖名单共用它。中奖名单原来是另写的一行——头像挂着职业小圈、只有名字，
 * 同一个弹窗里同一批人有两种样子。
 *
 * 职业不挂在头像右下角那一圈小图标上：那里三个圈叠着，图标看不清、名字根本没有，
 * 想知道一个人能打什么还得把鼠标停上去。改成图标＋名字成对排在名字下面那一行，
 * 而且是全部职业按 profile.classes 的顺序排——他还能顶哪一格，看这一行就够了。
 */
export function EventMemberIdentity({ entry }: { entry: MemberEntry }) {
  const { t } = useTranslation("events");
  const classCatalog = useClassCatalogStore((state) => state.items);
  const classItems = [...new Set(entry.profile.classes.filter(Boolean))].map((id) =>
    resolveClassCatalogItem(id, classCatalog),
  );

  return (
    <>
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
    </>
  );
}
