import { DEFAULT_GAME_RULES, EVENT_TYPES, type EventClassQuotaInput, type EventType } from "@guild/shared";
import { Button } from "@portal/components/ui/button";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { Switch } from "@portal/components/ui/switch";
import { Textarea } from "@portal/components/ui/textarea";
import {
  CalendarEventIcon,
  ClockIcon,
  FileTextIcon,
  PhotoIcon,
  PlusIcon,
  SaveIcon,
  SettingsIcon,
  UsersIcon,
  XIcon,
} from "@portal/components/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ClassQuotaEditor } from "./ClassQuotaEditor";
import { ImageGridEditor } from "@portal/components/shared/ImageGridEditor";
import { NativeDateTimeInput } from "@portal/components/shared/NativeDateTimeInput";
import type { ImageGridEditorItem } from "@portal/types/media";
import "./EventFormContent.css";
import { eventHasBehavior, getEventTypeLabel } from "@portal/utils/game-rules";

const WEEKDAY_KEYS = ["weekday.sun", "weekday.mon", "weekday.tue", "weekday.wed", "weekday.thu", "weekday.fri", "weekday.sat"] as const;

export type EventFormContentProps = {
  mode: "create" | "edit";
  canManage: boolean;
  title: string;
  onTitleChange: (value: string) => void;
  eventType: EventType | "";
  onEventTypeChange: (value: EventType | "") => void;
  startAt: string;
  onStartAtChange: (value: string) => void;
  endAt: string;
  onEndAtChange: (value: string) => void;
  capacity: string;
  onCapacityChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  autoArchive: boolean;
  onAutoArchiveChange: (value: boolean) => void;
  pollOptions?: string[];
  onPollOptionsChange?: (value: string[]) => void;
  pollResultsVisibility?: "always" | "after_vote" | "after_close";
  onPollResultsVisibilityChange?: (value: "always" | "after_vote" | "after_close") => void;
  pollShowVoterNames?: boolean;
  onPollShowVoterNamesChange?: (value: boolean) => void;
  winnerCount?: string;
  onWinnerCountChange?: (value: string) => void;
  classQuotas: EventClassQuotaInput[];
  onClassQuotasChange: (value: EventClassQuotaInput[]) => void;
  attachmentItems: ImageGridEditorItem[];
  onAttachmentsChange: (items: ImageGridEditorItem[]) => void;
  onFilesSelected: (files: File[]) => void;
  onAttachmentDelete: (item: ImageGridEditorItem) => void;
  availabilityDaysWithAny: Set<number>;
  availabilityMaxCount: number;
  availabilityMemberCount: number;
  confirmLoading: boolean;
  onCancel: () => void;
  onSave: () => void;
  stickyActions?: boolean;
};

export function EventFormContent({
  mode,
  canManage,
  title,
  onTitleChange,
  eventType,
  onEventTypeChange,
  startAt,
  onStartAtChange,
  endAt,
  onEndAtChange,
  capacity,
  onCapacityChange,
  description,
  onDescriptionChange,
  autoArchive,
  onAutoArchiveChange,
  pollOptions = ["", ""],
  onPollOptionsChange,
  pollResultsVisibility = "after_vote",
  onPollResultsVisibilityChange,
  pollShowVoterNames = false,
  onPollShowVoterNamesChange,
  winnerCount = "",
  onWinnerCountChange,
  classQuotas,
  onClassQuotasChange,
  attachmentItems,
  onAttachmentsChange,
  onFilesSelected,
  onAttachmentDelete,
  availabilityDaysWithAny,
  availabilityMaxCount,
  availabilityMemberCount,
  confirmLoading,
  onCancel,
  onSave,
  stickyActions = false,
}: EventFormContentProps) {
  const { t } = useTranslation("events");
  const gameRules = DEFAULT_GAME_RULES;
  const [titleTouched, setTitleTouched] = useState(false);

  const titleError = titleTouched && !title.trim() ? t("message.titleRequired") : undefined;
  const dateError = startAt && endAt && endAt < startAt ? t("field.endBeforeStart") : undefined;
  const isPoll = eventHasBehavior(eventType, "poll");
  const isRaffle = eventHasBehavior(eventType, "raffle");
  const eventTypeOptions = gameRules.events.types
    .filter((definition) => definition.enabled)
    .map((definition) => ({
      value: definition.id,
      label: getEventTypeLabel(definition.id),
    }));
  const pollOptionCount = pollOptions.map((option) => option.trim()).filter(Boolean).length;
  const pollError = isPoll && pollOptionCount < 2 ? t("poll.field.optionsInvalid") : undefined;
  const raffleWinnerCountNum = Number.parseInt(winnerCount, 10);
  const raffleError = isRaffle && (!Number.isFinite(raffleWinnerCountNum) || raffleWinnerCountNum < 1);
  // Keep the first blocking condition so the footer can explain a disabled save.
  const blockingReasonKey = !title.trim()
    ? "form.missing.title"
    : !eventType
      ? "form.missing.type"
      : dateError
        ? "field.endBeforeStart"
        : (isPoll || isRaffle) && !endAt
          ? "form.missing.endAt"
          : isPoll && pollError
            ? "poll.field.optionsInvalid"
            : isRaffle && raffleError
              ? "raffle.field.winnerCountInvalid"
              : null;
  const isSaveDisabled = blockingReasonKey !== null;

  return (
    <div className="event-form">
      <div className="event-form__layout">
        <section className="event-form__panel event-form__panel--main">
          <div className="event-form__section">
            <div className="event-form__section-heading">
              <CalendarEventIcon size={18} />
              <h2>{t("form.section.basics")}</h2>
            </div>
            <div className="event-form__field-stack">
              <div className="event-form__field">
              <Label htmlFor="event-form-title">{t("field.title")}</Label>
              <Input
                id="event-form-title"
                value={title}
                onChange={(event) => {
                  setTitleTouched(true);
                  onTitleChange(event.currentTarget.value);
                }}
                onBlur={() => setTitleTouched(true)}
                placeholder={t("field.title")}
                aria-invalid={Boolean(titleError)}
                data-autofocus
              />
              {titleError ? <p className="event-form__error" role="alert">{titleError}</p> : null}
              </div>
              <div className="event-form__field">
              <Label htmlFor="event-form-type">{t("filter.type")}</Label>
              <select
                id="event-form-type"
                className="event-form__select"
                value={eventType}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  const nextType = value && EVENT_TYPES.includes(value as EventType)
                    ? value as EventType
                    : "";
                  onEventTypeChange(nextType);
                }}
              >
                <option value="">{t("field.selectType")}</option>
                {eventTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              </div>
            </div>
          </div>

          <div className="event-form__divider" aria-hidden />

          <div className="event-form__section">
            <div className="event-form__section-heading">
              <ClockIcon size={18} />
              <h2>{t("form.section.schedule")}</h2>
            </div>
            <div className="event-form__schedule-grid">
              <NativeDateTimeInput
                label={t("field.start")}
                type="datetime-local"
                value={startAt}
                onChange={(event) => onStartAtChange(event.currentTarget.value)}
              />
              <NativeDateTimeInput
                label={t("field.end")}
                type="datetime-local"
                value={endAt}
                onChange={(event) => onEndAtChange(event.currentTarget.value)}
                error={dateError}
              />
            </div>
          </div>

          <div className="event-form__divider" aria-hidden />

          <div className="event-form__section">
            <div className="event-form__section-heading">
              <FileTextIcon size={18} />
              <h2>{t("field.description")}</h2>
            </div>
            <Textarea
              value={description}
              onChange={(event) => onDescriptionChange(event.currentTarget.value)}
              rows={5}
              placeholder={t("field.description")}
              aria-label={t("field.description")}
            />
          </div>

          <div className="event-form__divider" aria-hidden />

          <div className="event-form__section">
            <div className="event-form__section-heading event-form__section-heading--split">
              <div className="event-form__section-heading">
                <PhotoIcon size={18} />
                <h2>{t("form.section.media")}</h2>
              </div>
              <span className="event-form__muted">
                {t("field.attachmentsCount", { current: attachmentItems.length, max: 5 })}
              </span>
            </div>
            <ImageGridEditor
              items={attachmentItems}
              onReorder={onAttachmentsChange}
              onDelete={canManage ? onAttachmentDelete : undefined}
              onFilesSelected={canManage ? onFilesSelected : undefined}
              maxImages={5}
              disabled={!canManage}
            />
          </div>
        </section>

        <aside className="event-form__panel event-form__panel--settings">
          <div className="event-form__section">
            <div className="event-form__section-heading">
              <UsersIcon size={18} />
              <h2>{t("form.section.participation")}</h2>
            </div>
            <div className="event-form__field-stack">
              {!isPoll ? (
                <div className="event-form__field">
                  <Label htmlFor="event-form-capacity">{t("field.capacity")}</Label>
                <Input
                  id="event-form-capacity"
                  type="number"
                  min={1}
                  max={9999}
                  value={capacity}
                  onChange={(event) => onCapacityChange(event.currentTarget.value)}
                  placeholder={t("field.unlimited")}
                />
                </div>
              ) : null}
              <Label className="event-form__switch-field"><Switch checked={autoArchive} onCheckedChange={onAutoArchiveChange} /><span><strong>{t("field.autoArchive")}</strong><small>{t("field.autoArchiveHint")}</small></span></Label>
              {availabilityMaxCount > 0 ? (
                <p className="event-form__availability">
                  {t("availability.label")}{" "}
                  {Array.from(availabilityDaysWithAny)
                    .sort((left, right) => left - right)
                    .map((day) => t(WEEKDAY_KEYS[day] ?? "weekday.sun"))
                    .join(", ") || t("availability.none")}{" "}
                  · {t("availability.peak")} {availabilityMaxCount}/{availabilityMemberCount} {t("availability.members")}
                </p>
              ) : null}
            </div>
          </div>

          <div className="event-form__divider" aria-hidden />

          <div className="event-form__section event-form__type-block">
            <div className="event-form__section-heading">
              <SettingsIcon size={18} />
              <h2>
                {eventType ? getEventTypeLabel(eventType) : t("form.section.typeSettings")}
              </h2>
            </div>

            {!eventType ? (
              <p className="event-form__muted">{t("form.typeHint")}</p>
            ) : isPoll ? (
              <div className="event-form__field-stack">
                <strong>{t("poll.field.options")}</strong>
                {pollOptions.map((option, index) => (
                  <div key={index} className="event-form__poll-option-row">
                    <Input
                      value={option}
                      onChange={(event) => {
                        const next = [...pollOptions];
                        next[index] = event.currentTarget.value;
                        onPollOptionsChange?.(next);
                      }}
                      placeholder={t("poll.field.optionPlaceholder", { index: index + 1 })}
                      aria-invalid={Boolean(index === pollOptions.length - 1 && pollError)}
                    />
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      aria-label={t("poll.field.removeOption")}
                      disabled={pollOptions.length <= 2}
                      onClick={() => onPollOptionsChange?.(pollOptions.filter((_, optionIndex) => optionIndex !== index))}
                    >
                      <XIcon size={16} />
                    </Button>
                  </div>
                ))}
                {pollError ? <p className="event-form__error" role="alert">{pollError}</p> : null}
                <Button
                  variant="secondary"
                  size="xs"
                  disabled={pollOptions.length >= 10}
                  onClick={() => onPollOptionsChange?.([...pollOptions, ""])}
                >
                  <PlusIcon size={14} />
                  {t("poll.field.addOption")}
                </Button>
                <div className="event-form__field"><Label htmlFor="event-form-poll-visibility">{t("poll.field.resultsVisibility")}</Label><select id="event-form-poll-visibility" className="event-form__select" value={pollResultsVisibility} onChange={(event) => onPollResultsVisibilityChange?.(event.currentTarget.value as "always" | "after_vote" | "after_close")}><option value="always">{t("poll.visibility.always")}</option><option value="after_vote">{t("poll.visibility.afterVote")}</option><option value="after_close">{t("poll.visibility.afterClose")}</option></select></div>
                <Label className="event-form__switch-field"><Switch checked={pollShowVoterNames} onCheckedChange={onPollShowVoterNamesChange} /><span><strong>{t("poll.field.showVoterNames")}</strong></span></Label>
              </div>
            ) : isRaffle ? (
              <div className="event-form__field"><Label htmlFor="event-form-winner-count">{t("raffle.field.winnerCount")}</Label><Input
                id="event-form-winner-count"
                type="number"
                min={1}
                value={winnerCount}
                onChange={(event) => onWinnerCountChange?.(event.currentTarget.value)}
                placeholder="1"
                aria-invalid={raffleError}
              />{raffleError ? <p className="event-form__error" role="alert">{t("raffle.field.winnerCountInvalid")}</p> : null}</div>
            ) : (
              <ClassQuotaEditor value={classQuotas} onChange={onClassQuotasChange} disabled={!canManage} />
            )}
          </div>
        </aside>
      </div>

      <div
        className={`event-form__actions${stickyActions ? " event-form__actions--sticky" : ""}`}
      >
        <span className="event-form__blocked" aria-live="polite">
          {blockingReasonKey ? t("form.blockedBy", { reason: t(blockingReasonKey) }) : ""}
        </span>
        <div className="event-form__actions-buttons">
          <Button variant="outline" onClick={onCancel}>
            <XIcon size={16} />
            {t("button.cancel")}
          </Button>
          <Button
            onClick={onSave}
            loading={confirmLoading}
            disabled={isSaveDisabled}
          >
            {mode === "create" ? <PlusIcon size={16} /> : <SaveIcon size={16} />}
            {mode === "create" ? t("button.create") : t("button.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
