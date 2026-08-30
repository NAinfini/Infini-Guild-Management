import type { RecurringTemplate } from "@guild/shared";
import { Button } from "@portal/components/ui/button";
import { PlayerPauseIcon, PlayerPlayIcon, PhotoIcon, SaveIcon, PlusIcon, TrashIcon, XIcon } from "@portal/components/icons";
import { ImageGridEditor } from "@portal/components/shared/ImageGridEditor";
import type { ImageGridEditorItem } from "@portal/types/media";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { eventHasBehavior } from "@portal/utils/game-rules";
import { notifyError } from "../../../utils/notifications";
import {
  RecurringTemplateProducesFields,
  RecurringTemplateTimingFields,
} from "./RecurringTemplateFormFields";
import { RecurringTemplateLifecycle } from "./RecurringTemplatePreview";
import {
  buildFormState,
  buildRecurrenceRule,
  computeNextLifecyclePreview,
  localClockAnchorIso,
  localClockToUtcAt,
  templateScheduleAnchor,
  type RecurringTemplateFormPayload,
  type RecurringTemplateFormState,
} from "./RecurringTemplateForm.helpers";
import "./RecurringTemplateFormContent.css";

export type { RecurringTemplateFormPayload } from "./RecurringTemplateForm.helpers";

export type RecurringTemplateFormContentProps = {
  mode: "create" | "edit";
  template: RecurringTemplate | null;
  confirmLoading: boolean;
  onCancel: () => void;
  onSave: (payload: RecurringTemplateFormPayload) => void;
  onPause?: (id: string) => Promise<unknown>;
  onResume?: (id: string) => Promise<unknown>;
  onDelete?: (id: string) => Promise<void>;
  attachmentItems: ImageGridEditorItem[];
  onAttachmentsChange: (items: ImageGridEditorItem[]) => void;
  onFilesSelected: (files: File[]) => void;
  onAttachmentDelete: (item: ImageGridEditorItem) => void;
  onDirtyChange?: (dirty: boolean) => void;
  stickyActions?: boolean;
};

// The two columns separate generated event content from recurrence timing.
export function RecurringTemplateFormContent({
  mode,
  template,
  confirmLoading,
  onCancel,
  onSave,
  onPause,
  onResume,
  onDelete,
  attachmentItems,
  onAttachmentsChange,
  onFilesSelected,
  onAttachmentDelete,
  onDirtyChange,
  stickyActions = false,
}: RecurringTemplateFormContentProps) {
  const { t, i18n } = useTranslation("events");
  const [formState, setFormState] = useState<RecurringTemplateFormState>(() => buildFormState(template));
  const [baseline, setBaseline] = useState(() => JSON.stringify(buildFormState(template)));
  const formIdentity = `${mode}:${template?.id ?? "new"}`;
  const initializedIdentityRef = useRef(formIdentity);

  useEffect(() => {
    if (initializedIdentityRef.current === formIdentity) return;
    const nextState = buildFormState(template);
    setFormState(nextState);
    setBaseline(JSON.stringify(nextState));
    initializedIdentityRef.current = formIdentity;
  }, [formIdentity, template]);

  useEffect(() => {
    onDirtyChange?.(JSON.stringify(formState) !== baseline);
  }, [baseline, formState, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const handleSave = useCallback(() => {
    const {
      title, eventType, description, startTime, durationValue, durationUnit, capacity, classQuotas,
      recurrenceFreq, recurrenceDays,
      visibilityOffsetDays, visibilityOffsetHours, visibilityOffsetMinutes, autoArchive,
    } = formState;

    if (!startTime || !title.trim() || !eventType || (recurrenceFreq === "weekly" && recurrenceDays.length === 0)) {
      notifyError(t("recurring.message.validationFailed"));
      return;
    }

    const durationMinutes = durationValue > 0
      ? durationValue * (durationUnit === "hours" ? 60 : 1)
      : mode === "edit" ? null : undefined;

    const recurrenceReference = template ? templateScheduleAnchor(template) ?? new Date() : new Date();
    const anchorIso = localClockAnchorIso(startTime, recurrenceReference);

    const offsetD = typeof visibilityOffsetDays === "number" ? visibilityOffsetDays : 0;
    const offsetH = typeof visibilityOffsetHours === "number" ? visibilityOffsetHours : 0;
    const offsetM = typeof visibilityOffsetMinutes === "number" ? visibilityOffsetMinutes : 0;
    const totalOffsetMinutes = offsetD * 1440 + offsetH * 60 + offsetM;

    onSave({
      type: eventType,
      title: title.trim(),
      description: description.trim() || (mode === "edit" ? null : ""),
      start_time: localClockToUtcAt(startTime, recurrenceReference),
      duration_minutes: durationMinutes,
      capacity: capacity.trim() ? Math.max(1, Number.parseInt(capacity, 10)) : mode === "edit" ? null : undefined,
      recurrence_rule: buildRecurrenceRule(formState, anchorIso),
      visibility_offset_minutes: totalOffsetMinutes,
      auto_archive: autoArchive,
      /* 切成投票/抽奖时控件只是藏了，状态还在；这两种类型带着配额会被服务端整个拒收。 */
      class_quotas: eventHasBehavior(eventType, "poll") || eventHasBehavior(eventType, "raffle") ? [] : classQuotas,
    });
  }, [formState, onSave, t]);

  const lifecycle = useMemo(
    () => computeNextLifecyclePreview(formState, template, mode),
    [formState, template, mode],
  );

  const locale = i18n?.language ?? "en";
  const isSaveDisabled = !formState.title.trim() || !formState.startTime || !formState.eventType;
  const handlePauseResume = useCallback(async () => {
    if (!template) return;
    const action = template.paused ? onResume : onPause;
    if (!action) return;
    try {
      await action(template.id);
    } catch {
      // The mutation owner reports failures; keep the editor page open for correction.
      return;
    }
    onCancel();
  }, [onCancel, onPause, onResume, template]);
  const handleDelete = useCallback(async () => {
    if (!template || !onDelete) return;
    try {
      await onDelete(template.id);
    } catch {
      // The mutation owner reports failures; keep the editor page open for correction.
    }
  }, [onDelete, template]);

  return (
    <div className="rtf-form">
        <div className="rtf-columns">
          <div className="rtf-col">
            <RecurringTemplateProducesFields formState={formState} setFormState={setFormState} />
            <section className="rtf-media" aria-labelledby="recurring-template-media-title">
              <div className="rtf-divider">
                <PhotoIcon size={16} aria-hidden />
                <span id="recurring-template-media-title" className="rtf-divider__label">
                  {t("recurring.section.media")}
                </span>
              </div>
              <div className="rtf-section rtf-media__content">
                <div className="rtf-media__heading">
                  <p>{t("recurring.field.mediaHint")}</p>
                  <span>{t("field.attachmentsCount", { current: attachmentItems.length, max: 5 })}</span>
                </div>
                <ImageGridEditor
                  items={attachmentItems}
                  onReorder={onAttachmentsChange}
                  onDelete={onAttachmentDelete}
                  onFilesSelected={onFilesSelected}
                  maxImages={5}
                  aria-label={t("recurring.media.ariaLabel")}
                />
              </div>
            </section>
          </div>
          <div className="rtf-col">
            <RecurringTemplateTimingFields formState={formState} setFormState={setFormState} />
            <RecurringTemplateLifecycle lifecycle={lifecycle} locale={locale} />
          </div>
        </div>

        <div className="rtf-actions-divider" />
        <div className={`rtf-actions${stickyActions ? " rtf-actions--sticky" : ""}`} data-edit={mode === "edit" || undefined}>
          {mode === "edit" && template && (
            <div className="rtf-actions__lifecycle">
              {template.paused ? (
                <Button
                  variant="secondary"
                  onClick={() => { void handlePauseResume(); }}
                >
                  <PlayerPlayIcon size={16} />
                  {t("recurring.resume")}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => { void handlePauseResume(); }}
                >
                  <PlayerPauseIcon size={16} />
                  {t("recurring.pause")}
                </Button>
              )}
              <Button
                variant="destructive"
                onClick={() => { void handleDelete(); }}
              >
                <TrashIcon size={16} />
                {t("recurring.delete")}
              </Button>
            </div>
          )}
          <div className="rtf-actions__primary">
            <Button variant="outline" onClick={onCancel}>
              <XIcon size={16} />
              {t("button.cancel")}
            </Button>
            <Button
              onClick={handleSave}
              loading={confirmLoading}
              disabled={isSaveDisabled}
            >
              {mode === "create" ? <PlusIcon size={16} /> : <SaveIcon size={16} />}
              {mode === "create" ? t("recurring.create") : t("button.save")}
            </Button>
          </div>
        </div>
    </div>
  );
}
