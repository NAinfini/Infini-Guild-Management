import { CalendarRepeatIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import {
  formatLifecycleDate,
  type LifecyclePreview,
} from "./RecurringTemplateFormModal.helpers";

/*
 * 模板编辑器的预览：这一轮的三个时间点，画在「什么时候生成」正下方。
 *
 * 这里以前还有一张按表单实时拼出来的活动卡。它被拿掉了：模板编辑器里唯一说不准的
 * 是时间——生成时刻、开始、结束，都要靠重复规则和可见提前量算出来；标题、描述、
 * 配额这些是照抄表单，卡上再画一遍并不多告诉人什么，却占掉半个弹窗。
 */
type RecurringTemplateLifecycleProps = {
  lifecycle: LifecyclePreview | null;
  locale: string;
};

export function RecurringTemplateLifecycle({ lifecycle, locale }: RecurringTemplateLifecycleProps) {
  const { t } = useTranslation("events");

  return (
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
  );
}
