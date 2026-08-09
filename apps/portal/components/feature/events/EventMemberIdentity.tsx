import type { MemberProfile, User } from "@guild/shared";
import { Group, Text } from "@mantine/core";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { MemberRoleAvatar } from "@portal/components/shared/MemberRoleAvatar";
import { resolveClassCatalogItem, useClassCatalogStore } from "@portal/stores/class-catalog";
import { useTranslation } from "react-i18next";

type MemberEntry = { user: User; profile: MemberProfile };

// Shared identity row for attendee and raffle rosters. Class names remain
// visible beside icons in profile order instead of relying on hover-only rings.
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
