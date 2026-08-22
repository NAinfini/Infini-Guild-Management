import { Badge, Group, Modal, Stack, Text } from "@mantine/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AvailabilityDayKey } from "@guild/shared";
import { BoltIcon } from "@portal/components/icons";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { useClassCatalog } from "@portal/hooks/data/useClassData";
import { resolveClassCatalogItem } from "@portal/utils/class-catalog";
import { convertAvailabilityToLocalDays } from "../../../utils/availability";
import { formatCalendarDate, viewerTimeZone, viewerUtcOffsetMinutes } from "../../../utils/datetime";
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
        ranges: blocks.map((block) => `${block.start}–${block.end}`).join(", "),
      }];
    });
  }, [activeDetail?.availability, offsetMinutes]);
  const vacationRange = activeDetail
    ? formatVacationRange(activeDetail.vacationStart, activeDetail.vacationEnd, i18n.language)
    : null;

  return (
    <Modal
      opened={open}
      title={activeDetail?.username ?? activeDetailUserId ?? ""}
      onClose={onClose}
      withCloseButton
      centered
      size="lg"
      classNames={{
        content: "guild-war-member-detail",
        body: "guild-war-member-detail__body",
      }}
    >
      {activeDetail ? (
        <Stack gap={16}>
          <div className="guild-war-member-detail__identity">
            <div>
              {safeTitleHtml ? (
                <Text size="sm" c="dimmed" dangerouslySetInnerHTML={{ __html: safeTitleHtml }} />
              ) : (
                <Text size="sm" c="dimmed">{t("memberDetail.titleFallback")}</Text>
              )}
              <Group gap={8} wrap="wrap" mt={8}>
                {activeDetail.classes.map((classId) => {
                  const item = resolveClassCatalogItem(classId, classCatalog);
                  return (
                    <Badge
                      key={classId}
                      variant="light"
                      size="sm"
                      color={item.color}
                      leftSection={<ClassIcon item={item} size={16} framed={false} />}
                    >
                      {item.label}
                    </Badge>
                  );
                })}
              </Group>
            </div>
            <div className="guild-war-member-detail__power">
              <BoltIcon size={16} aria-hidden="true" />
              <Text component="strong" className="tabular-nums">
                {activeDetail.power.toLocaleString()}
              </Text>
            </div>
          </div>

          <div className="guild-war-member-detail__schedule">
            <section className="guild-war-member-detail__panel">
              <Text component="h3" size="sm" fw={700}>
                {t("memberDetail.availability")}
              </Text>
              {availabilityRows.length > 0 ? (
                <dl className="guild-war-member-detail__availability-list">
                  {availabilityRows.map((row) => (
                    <div key={row.day} className="guild-war-member-detail__availability-row">
                      <Text component="dt" size="xs" c="dimmed">
                        {t(`memberDetail.day.${row.day}`)}
                      </Text>
                      <Text component="dd" size="sm" className="tabular-nums">
                        {row.ranges}
                      </Text>
                    </div>
                  ))}
                </dl>
              ) : (
                <Text size="sm" c="dimmed" mt="xs">{t("memberDetail.notAvailable")}</Text>
              )}
              {activeDetail.availability ? (
                <Stack gap={2} mt="sm">
                  {/* 两行都要有：上面一行说明这些时刻按谁的表读，下面一行是成员自己报的
                      时区。只留成员时区，看的人会以为时刻也是那个时区的。 */}
                  <Text size="xs" c="dimmed">
                    {t("memberDetail.viewerTimezone", { timezone: viewerTimezone })}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t("memberDetail.profileTimezone", {
                      timezone: activeDetail.availability.timezone,
                    })}
                  </Text>
                </Stack>
              ) : null}
            </section>

            <section className="guild-war-member-detail__panel">
              <Text component="h3" size="sm" fw={700}>
                {t("memberDetail.vacation")}
              </Text>
              <Text size="sm" c={vacationRange ? undefined : "dimmed"} mt="xs">
                {vacationRange ?? t("memberDetail.notAvailable")}
              </Text>
            </section>
          </div>

          {canViewNotes ? (
            <section className="guild-war-member-detail__panel">
              <Text component="h3" size="sm" fw={700}>
                {t("memberDetail.note")}
              </Text>
              <Text
                size="sm"
                c={activeDetail.notes?.trim() ? undefined : "dimmed"}
                mt="xs"
                className="guild-war-member-detail__note"
              >
                {activeDetail.notes?.trim() || t("memberDetail.notAvailable")}
              </Text>
            </section>
          ) : null}
        </Stack>
      ) : null}
    </Modal>
  );
}
