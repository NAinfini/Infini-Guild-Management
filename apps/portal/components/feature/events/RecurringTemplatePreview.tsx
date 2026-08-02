import type { Event } from "@guild/shared";
import { CalendarRepeatIcon } from "@portal/components/icons";
import { useClassTagStore } from "@portal/stores/class-tag";
import { Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { EventCardView } from "./EventCardView";
import { fromClassQuotaInputs } from "./class-quota-view";
import {
  formatLifecycleDate,
  type LifecyclePreview,
  type RecurringTemplateFormState,
} from "./RecurringTemplateFormModal.helpers";

/*
 * 模板编辑器右栏：这个模板下一次会生成的那张活动卡，外加它的三个时间点。
 *
 * 卡片是真的——跟活动页列表用的是同一个 EventCardView，不是照着画的一份仿制品。
 * 仿制品的问题不在于费事，而在于它会慢慢跟真卡分叉，到那时候预览就在骗人了。
 *
 * 报名人固定是空的：这场活动还不存在，没人能报。所以头像位空着、人数是 0/容量、
 * 配额筹码全线告急——这不是告警，是「新生成的活动就是这个样子」。
 */
type RecurringTemplatePreviewProps = {
  formState: RecurringTemplateFormState;
  lifecycle: LifecyclePreview | null;
  locale: string;
};

export function RecurringTemplatePreview({ formState, lifecycle, locale }: RecurringTemplatePreviewProps) {
  const { t } = useTranslation("events");
  const tags = useClassTagStore((state) => state.tags);

  /* 类型没选就画不出卡：类型决定色带、图标和徽章文字，硬画只会得到一张空壳。 */
  const previewEvent: Event | null = formState.eventType && lifecycle
    ? buildPreviewEvent(formState, lifecycle, tags, t("recurring.preview.untitled"))
    : null;

  return (
    <div className="rtf-preview">
      <div className="rtf-divider">
        <span className="rtf-divider__label">{t("recurring.preview.title")}</span>
      </div>

      {previewEvent ? (
        <EventCardView event={previewEvent} now={new Date()} members={[]} />
      ) : (
        <div className="rtf-preview__empty">
          <Text size="xs" c="dimmed">{t("recurring.preview.empty")}</Text>
        </div>
      )}

      <div className={`rtf-lifecycle${lifecycle ? "" : " rtf-lifecycle--empty"}`}>
        <div className="rtf-lifecycle__title">
          <CalendarRepeatIcon size={16} className="rtf-lifecycle__title-icon" />
          <span>{t("recurring.lifecycle.title")}</span>
        </div>
        {lifecycle ? (
          <div className="rtf-lifecycle__steps">
            <div className="rtf-lifecycle__step">
              <span className="rtf-lifecycle__step-label">{t("recurring.lifecycle.creation")}</span>
              <span className="rtf-lifecycle__step-value">{formatLifecycleDate(lifecycle.creationTime, locale)}</span>
            </div>
            <div className="rtf-lifecycle__step">
              <span className="rtf-lifecycle__step-label">{t("recurring.lifecycle.start")}</span>
              <span className="rtf-lifecycle__step-value">{formatLifecycleDate(lifecycle.startTime, locale)}</span>
            </div>
            {lifecycle.endTime && (
              <div className="rtf-lifecycle__step">
                <span className="rtf-lifecycle__step-label">{t("recurring.lifecycle.end")}</span>
                <span className="rtf-lifecycle__step-value">{formatLifecycleDate(lifecycle.endTime, locale)}</span>
              </div>
            )}
          </div>
        ) : (
          <span className="rtf-lifecycle__empty-text">{t("recurring.lifecycle.empty")}</span>
        )}
      </div>
    </div>
  );
}

/*
 * 把表单状态拼成一条活动。三个时间点直接取自生命周期计算，跟下面那条时间轴同源，
 * 不可能对不上。series_id 给了个非空值，卡上那个「周期生成」图标才会亮——生成出来的
 * 活动本来就带 series_id。
 */
function buildPreviewEvent(
  formState: RecurringTemplateFormState,
  lifecycle: LifecyclePreview,
  tags: ReturnType<typeof useClassTagStore.getState>["tags"],
  untitledLabel: string,
): Event {
  const capacity = formState.capacity.trim() ? Number.parseInt(formState.capacity, 10) : Number.NaN;
  const isQuotaType = formState.eventType !== "poll" && formState.eventType !== "raffle";
  const createdAt = lifecycle.creationTime.toISOString();

  return {
    id: "recurring-template-preview",
    type: formState.eventType,
    title: formState.title.trim() || untitledLabel,
    description: formState.description.trim() || null,
    start_at: lifecycle.startTime.toISOString(),
    end_at: lifecycle.endTime?.toISOString() ?? null,
    capacity: Number.isFinite(capacity) ? Math.max(1, capacity) : null,
    pinned: false,
    signup_locked: false,
    auto_archive: formState.autoArchive,
    auto_archived: false,
    visible_at: createdAt,
    archived_at: null,
    created_by: "",
    updated_by: null,
    attachments: [],
    /* 保存时也是这么剔的（见 handleSave）：投票和抽奖带着配额会被服务端整个拒收。 */
    class_quotas: isQuotaType ? fromClassQuotaInputs(formState.classQuotas, tags) : [],
    series_id: "recurring-template-preview",
    instance_date: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}
