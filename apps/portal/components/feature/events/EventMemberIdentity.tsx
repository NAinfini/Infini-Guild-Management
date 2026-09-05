import type { MemberDirectoryEntry } from "@guild/shared";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { MemberRoleAvatar } from "@portal/components/shared/MemberRoleAvatar";
import { useClassCatalog } from "@portal/hooks/data/useClassData";
import { resolveClassCatalogItem } from "@portal/utils/class-catalog";
import { useTranslation } from "react-i18next";

type MemberEntry = MemberDirectoryEntry;

// Shared identity row for attendee and raffle rosters. Class names remain
// visible beside icons in profile order instead of relying on hover-only rings.
export function EventMemberIdentity({ entry }: { entry: MemberEntry }) {
  const { t } = useTranslation("events");
  const classCatalog = useClassCatalog();
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
      <div className="event-detail-content__member-info">
        <strong>{entry.user.display_name}</strong>
        <div className="event-detail-content__member-meta">
          {classItems.length === 0 ? <span>-</span> : null}
          {classItems.map((item) => (
            <span key={item.id} className="event-detail-content__member-class">
              <ClassIcon item={item} size={14} framed={false} />
              <span>{item.label}</span>
            </span>
          ))}
          <span>-</span>
          <span>{t("detail.power", { value: entry.profile.power ?? "-" })}</span>
        </div>
      </div>
    </>
  );
}
