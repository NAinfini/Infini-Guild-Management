import { CalendarRepeatIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import {
  formatLifecycleDate,
  type LifecyclePreview,
} from "./RecurringTemplateFormModal.helpers";

/** Preview the generated instance lifecycle derived from recurrence rules. */
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
