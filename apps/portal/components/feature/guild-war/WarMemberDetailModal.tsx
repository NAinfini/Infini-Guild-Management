import { Badge } from "@portal/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { useMemo, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { AvailabilityDayKey } from "@guild/shared";
import { BoltIcon } from "@portal/components/icons";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { useClassCatalog } from "@portal/hooks/data/useClassData";
import { resolveClassCatalogItem } from "@portal/utils/class-catalog";
import { convertAvailabilityToLocalDays } from "../../../utils/availability";
import {
  formatCalendarDate,
  formatTimeZoneAbbreviation,
  viewerTimeZone,
  viewerUtcOffsetMinutes,
} from "../../../utils/datetime";
import { sanitizeTitleHtml } from "../../../utils/sanitize";
import type { ActiveGuildWarMemberDetail } from "../../../hooks/guild-war/useGuildWarDragData";

const DETAIL_DAYS: readonly AvailabilityDayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

type WarMemberDetailModalProps = {
  open: boolean;
  activeDetailUserId: string | null;
  activeDetail: ActiveGuildWarMemberDetail | null;
  canViewNotes: boolean;
  onClose: () => void;
};

function formatVacationRange(start: string | null, end: string | null, locale: string): string | null {
  if (!start && !end) return null;
  if (!start) return formatCalendarDate(end, locale);
  if (!end || start === end) return formatCalendarDate(start, locale);
  return `${formatCalendarDate(start, locale)} – ${formatCalendarDate(end, locale)}`;
}

export function WarMemberDetailModal({
  open,
  activeDetailUserId,
  activeDetail,
  canViewNotes,
  onClose,
}: WarMemberDetailModalProps) {
  const { t, i18n } = useTranslation("guild-war");
  const classCatalog = useClassCatalog();
  const safeTitleHtml = useMemo(
    () => (activeDetail?.titleHtml ? sanitizeTitleHtml(activeDetail.titleHtml) : ""),
    [activeDetail?.titleHtml],
  );
  const viewerTimezone = useMemo(() => viewerTimeZone(), []);
  const viewerTimezoneAbbreviation = useMemo(
    () => formatTimeZoneAbbreviation(new Date(), viewerTimezone),
    [viewerTimezone],
  );
  const offsetMinutes = useMemo(() => viewerUtcOffsetMinutes(), []);
  /*
   * 时段按阅读者的时区显示。存的是 UTC，读的人却要拿它对自己的表——UTC 周五 23:00
   * 在 UTC+8 是周六 07:00，直接把库里的数字摆出来，看的人得自己心算，还容易忘了换星期。
   */
  const availabilityRows = useMemo(() => {
    if (!activeDetail?.availability) return [];
    const localDays = convertAvailabilityToLocalDays(activeDetail.availability, offsetMinutes);
    return DETAIL_DAYS.flatMap((day) => {
      const blocks = localDays[day];
      if (blocks.length === 0) return [];
      return [{
        day,
        ranges: `${blocks.map((block) => `${block.start}–${block.end}`).join(", ")} ${viewerTimezoneAbbreviation}`,
      }];
    });
  }, [activeDetail?.availability, offsetMinutes, viewerTimezoneAbbreviation]);
  const vacationRange = activeDetail
    ? formatVacationRange(activeDetail.vacationStart, activeDetail.vacationEnd, i18n.language)
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        className="guild-war-member-detail sm:max-w-2xl"
        closeLabel={t("common:action.close")}
      >
        <DialogHeader>
          <DialogTitle>{activeDetail?.display_name ?? activeDetailUserId ?? ""}</DialogTitle>
        </DialogHeader>
        {activeDetail ? (
        <div className="guild-war-member-detail__body grid gap-4">
          <div className="guild-war-member-detail__identity">
            <div>
              {safeTitleHtml ? (
                <div className="text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: safeTitleHtml }} />
              ) : (
                <p className="text-sm text-muted-foreground">{t("memberDetail.titleFallback")}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {activeDetail.classes.map((classId) => {
                  const item = resolveClassCatalogItem(classId, classCatalog);
                  return (
                    <Badge
                      key={classId}
                      variant="outline"
                      className="guild-war-member-detail__class"
                      style={{ "--badge-color": item.color } as CSSProperties}
                    >
                      <ClassIcon item={item} size={16} framed={false} />
                      {item.label}
                    </Badge>
                  );
                })}
              </div>
            </div>
            <div className="guild-war-member-detail__power">
              <BoltIcon size={16} aria-hidden="true" />
              <strong className="tabular-nums">
                {activeDetail.power.toLocaleString()}
              </strong>
            </div>
          </div>

          <div className="guild-war-member-detail__schedule">
            <section className="guild-war-member-detail__panel">
              <h3 className="text-sm font-bold">
                {t("memberDetail.availability")}
              </h3>
              {availabilityRows.length > 0 ? (
                <dl className="guild-war-member-detail__availability-list">
                  {availabilityRows.map((row) => (
                    <div key={row.day} className="guild-war-member-detail__availability-row">
                      <dt className="text-xs text-muted-foreground">
                        {t(`memberDetail.day.${row.day}`)}
                      </dt>
                      <dd className="tabular-nums text-sm">
                        {row.ranges}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">{t("memberDetail.notAvailable")}</p>
              )}
            </section>

            <section className="guild-war-member-detail__panel">
              <h3 className="text-sm font-bold">
                {t("memberDetail.vacation")}
              </h3>
              <p className={vacationRange ? "mt-1 text-sm" : "mt-1 text-sm text-muted-foreground"}>
                {vacationRange ?? t("memberDetail.notAvailable")}
              </p>
            </section>
          </div>

          {canViewNotes ? (
            <section className="guild-war-member-detail__panel">
              <h3 className="text-sm font-bold">
                {t("memberDetail.note")}
              </h3>
              <p
                className={`guild-war-member-detail__note mt-1 text-sm${activeDetail.notes?.trim() ? "" : " text-muted-foreground"}`}
              >
                {activeDetail.notes?.trim() || t("memberDetail.notAvailable")}
              </p>
            </section>
          ) : null}
        </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
