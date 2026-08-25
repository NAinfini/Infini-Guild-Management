import type { Event } from "@guild/shared";
import type { ClassQuotaSlot } from "@guild/shared/utils/class-quota";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import "./EventQuotaBar.css";

type EventQuotaBarProps = {
  /** null means this event has no role/tag requirements, so show signup progress instead. */
  summary: EventQuotaBarSummary | null;
  event: Pick<Event, "class_quotas" | "capacity">;
  participantCount: number;
  className?: string;
};

export type EventQuotaBarSummary = Readonly<{
  slots: readonly Readonly<Pick<ClassQuotaSlot, "key" | "required" | "matched" | "eligible">>[];
  requiredTotal: number;
  matchedTotal: number;
}>;

/*
 * Bar length represents quantity and series hue represents role category.
 * Filling is neutral, ready is confirmed by its count, and only over-capacity
 * changes the bar to danger styling.
 */
type QuotaVisualState = "ready" | "filling" | "over";

// Must match the number of --series-* tokens in semantic.css.
const QUOTA_SERIES_LENGTH = 4;

function roleState(slot: EventQuotaBarSummary["slots"][number]): QuotaVisualState {
  return slot.matched >= slot.required ? "ready" : "filling";
}

function progressWidth(current: number, maximum: number): string {
  const safeMaximum = Math.max(maximum, 1);
  const safeCurrent = Math.max(0, Math.min(current, safeMaximum));
  return String(safeCurrent / safeMaximum * 100) + "%";
}

/**
 * Role rows show mutually exclusive matched seat assignments, so their counts add up against the
 * event capacity. Eligible member counts stay in accessible descriptions to explain multi-role
 * coverage.
 */
export function EventQuotaBar({ summary, event, participantCount, className }: EventQuotaBarProps) {
  const { t } = useTranslation("events");
  const labelByTagId = new Map(event.class_quotas.map((quota) => [quota.tag_id, quota.label]));
  const rootClassName = className ? "quota-bar " + className : "quota-bar";

  if (!summary) {
    const capacity = event.capacity;
    if (capacity === null) {
      return (
        <div className={rootClassName} role="group" aria-label={t("quota.generic.label")}>
          <div className="quota-bar__unlimited-state">
            <span className="quota-bar__unlimited-label">
              {t("quota.generic.unlimited")}
            </span>
          </div>
        </div>
      );
    }

    const description = t("quota.generic.tooltip.capacity", {
      current: participantCount,
      capacity,
    });
    const overCapacity = participantCount > capacity;

    return (
      <div className={rootClassName} role="group" aria-label={t("quota.generic.label")}>
        <div
          className="quota-bar__generic"
          data-quota-state={overCapacity ? "over" : "filling"}
        >
          <div className="quota-bar__slot-header">
            <span className="quota-bar__generic-label">{t("quota.generic.label")}</span>
            <span className="quota-bar__role-count">{participantCount} / {capacity}</span>
          </div>
          <div
            className="quota-bar__progress"
            role="progressbar"
            aria-label={t("quota.generic.label")}
            aria-valuemin={0}
            aria-valuemax={capacity}
            aria-valuenow={Math.max(0, Math.min(participantCount, capacity))}
            aria-valuetext={description}
          >
            <span
              className="quota-bar__progress-fill"
              style={{ width: progressWidth(participantCount, capacity) }}
            />
          </div>
        </div>
      </div>
    );
  }

  const labelFor = (slot: EventQuotaBarSummary["slots"][number]) =>
    labelByTagId.get(slot.key) ?? t("quota.editor.unknownTag");
  const capacity = event.capacity;
  const otherCapacity = capacity === null
    ? 0
    : Math.max(capacity - summary.requiredTotal, 0);
  const hasOtherCapacity = otherCapacity > 0;
  const countedParticipants = capacity === null
    ? participantCount
    : Math.min(participantCount, capacity);
  const unassignedParticipants = Math.max(participantCount - summary.matchedTotal, 0);
  const otherAssigned = Math.max(countedParticipants - summary.matchedTotal, 0);
  const otherOverflow = Math.max(otherAssigned - otherCapacity, 0);
  const eventOverflow = capacity === null ? 0 : Math.max(participantCount - capacity, 0);
  const capacityConflict = capacity !== null && capacity < summary.requiredTotal;
  const capacityConflictText = capacityConflict
    ? t("quota.capacityConflict", {
        capacity,
        required: summary.requiredTotal,
      })
    : undefined;
  const slotGridStyle = {
    "--quota-slot-count": summary.slots.length + (hasOtherCapacity ? 1 : 0),
  } as CSSProperties;

  return (
    <div
      className={rootClassName}
      role="group"
      aria-label={t("quota.roles.label")}
    >
      <div className="quota-bar__slots" role="list" style={slotGridStyle}>
        {summary.slots.map((slot, index) => {
          const state = roleState(slot);
          const label = labelFor(slot);
          const covered = Math.min(slot.matched, slot.required);
          const shortfall = Math.max(slot.required - slot.matched, 0);
          const description = t("quota.role.tooltip." + state, {
            label,
            available: slot.eligible,
            assigned: slot.matched,
            required: slot.required,
            count: shortfall,
          });

          return (
            <div
              key={slot.key}
              className="quota-bar__slot"
              data-quota-state={state}
              /* 位次而不是状态：同一场活动里这个值不随报名人数变化。
                 用 index 而不是 slot.key 的哈希，是为了让相邻两格必定异色。 */
              data-quota-series={index % QUOTA_SERIES_LENGTH}
              role="listitem"
            >
              <div className="quota-bar__slot-header">
                <span className="quota-bar__role-name">{label}</span>
                <span className="quota-bar__role-count">{slot.matched} / {slot.required}</span>
              </div>
              <div
                className="quota-bar__progress"
                role="progressbar"
                aria-label={label}
                aria-valuemin={0}
                aria-valuemax={slot.required}
                aria-valuenow={covered}
                aria-valuetext={description}
              >
                <span
                  className="quota-bar__progress-fill"
                  style={{ width: progressWidth(covered, slot.required) }}
                />
              </div>
            </div>
          );
        })}

        {hasOtherCapacity ? (
          <div
            className="quota-bar__slot"
            /* 「其他」是容量的上限而不是要凑满的下限，所以它没有 ready 态：
               装不下了才是要处理的事。 */
            data-quota-state={otherOverflow > 0 || eventOverflow > 0 ? "over" : "filling"}
            /* 「其他」不占分类色序里的位次：它是剩余容量，不是第 N 个岗位。 */
            data-quota-series="other"
            role="listitem"
          >
            <div className="quota-bar__slot-header">
              <span className="quota-bar__role-name">{t("quota.role.other")}</span>
              <span className="quota-bar__role-count">{otherAssigned} / {otherCapacity}</span>
            </div>
            <div
              className="quota-bar__progress"
              role="progressbar"
              aria-label={t("quota.role.other")}
              aria-valuemin={0}
              aria-valuemax={otherCapacity}
              aria-valuenow={Math.min(otherAssigned, otherCapacity)}
              aria-valuetext={t("quota.role.tooltip.other", {
                assigned: otherAssigned,
                required: otherCapacity,
                unassigned: unassignedParticipants,
              })}
            >
              <span
                className="quota-bar__progress-fill"
                style={{ width: progressWidth(otherAssigned, otherCapacity) }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* 容量小于岗位需求总和是活动自己的配置错，按这套设置永远凑不齐人。
          这种事不能只挂在悬停上：鼠标不停在这儿的人、用键盘的人都读不到。 */}
      {capacityConflictText ? (
        <p className="quota-bar__conflict">{capacityConflictText}</p>
      ) : null}
    </div>
  );
}
