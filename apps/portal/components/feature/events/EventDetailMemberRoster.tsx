import type { Event, MemberProfile, User } from "@guild/shared";
import { Button } from "@portal/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { UserMinusIcon } from "@portal/components/icons";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { useClassCatalog } from "@portal/hooks/data/useClassData";
import { resolveClassCatalogItem } from "@portal/utils/class-catalog";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EventMemberIdentity } from "./EventMemberIdentity";
import { groupMembersByClassQuota, summariseEventClassQuotas } from "./class-quota-view";

type MemberEntry = { user: User; profile: MemberProfile };

type EventDetailMemberRosterProps = {
  event: Pick<Event, "class_quotas">;
  members: MemberEntry[];
  canManage: boolean;
  onRemoveMember: (userId: string, display_name: string) => void;
};

// Quota grouping and its counters share the allocation algorithm in
// class-quota-view.ts; events without quotas use the flat roster.
export function EventDetailMemberRoster({
  event,
  members,
  canManage,
  onRemoveMember,
}: EventDetailMemberRosterProps) {
  const { t } = useTranslation("events");
  const classCatalog = useClassCatalog();

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
    <div key={entry.user.id} className="event-detail-content__member-row">
      <EventMemberIdentity entry={entry} />
      {canManage ? (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onRemoveMember(entry.user.id, entry.user.display_name)}
        >
          <UserMinusIcon size={14} />
          {t("detail.removeMember")}
        </Button>
      ) : null}
    </div>
  );

  if (members.length === 0) {
    return <p className="event-detail-content__empty-members">{t("detail.noMembers")}</p>;
  }

  return (
    <div
      className="event-detail-content__member-list"
      role="region"
      tabIndex={0}
      aria-label={t("detail.memberListAria", { count: members.length })}
    >
      {quotaGroups ? (
        <div className="event-detail-content__quota-groups">
          {quotaGroups.map((group) => {
            return (
              <div key={group.kind === "quota" ? group.slot.key : group.kind}>
                <div className="event-detail-content__quota-group-heading">
                  {group.kind === "quota" ? (
                    <>
                      {/* 组头上只有一排图标，认不出哪个是哪个职业就等于没写；
                          悬停给名字，同时 label 让读屏也念得出来。 */}
                      {group.slot.class_ids.map((classId) => {
                        const item = resolveClassCatalogItem(classId, classCatalog);
                        return (
                          <Tooltip key={classId}>
                            <TooltipTrigger render={<span className="event-detail-content__group-class" />}>
                              <ClassIcon item={item} size={18} framed={false} label={item.label} />
                            </TooltipTrigger>
                            <TooltipContent>{item.label}</TooltipContent>
                          </Tooltip>
                        );
                      })}
                      <strong className="event-detail-content__quota-label">
                        {labelByTagId.get(group.slot.key) ?? t("quota.editor.unknownTag")}
                      </strong>
                      <strong
                        className="quota-status-text"
                        data-quota-status={group.slot.status}
                      >
                        {group.slot.matched}/{group.slot.required}
                      </strong>
                    </>
                  ) : (
                    <strong className="event-detail-content__quota-label event-detail-content__quota-label--muted">
                      {t("quota.group.other", { count: group.members.length })}
                    </strong>
                  )}
                </div>
                {group.members.length === 0 ? (
                  <p className="event-detail-content__quota-empty">{t("quota.group.empty")}</p>
                ) : (
                  <div>{group.members.map(renderRow)}</div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div>{members.map(renderRow)}</div>
      )}
    </div>
  );
}
