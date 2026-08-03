import type { Event } from "@guild/shared";
import type { ClassQuotaSlot, ClassQuotaSummary } from "@guild/shared/utils/class-quota";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import "./EventQuotaBar.css";

type EventQuotaBarProps = {
  /** null means this event has no role/tag requirements, so show signup progress instead. */
  summary: ClassQuotaSummary | null;
  event: Pick<Event, "class_quotas" | "capacity">;
  participantCount: number;
  className?: string;
};

type QuotaVisualState = "ready" | "short";

function roleState(slot: ClassQuotaSlot): QuotaVisualState {
  return slot.matched >= slot.required ? "ready" : "short";
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
    const hasCapacity = capacity !== null;
    const counter = hasCapacity
      ? t("quota.generic.count", { current: participantCount, capacity })
      : t("quota.generic.unlimitedCount", { current: participantCount });
    const description = hasCapacity
      ? t("quota.generic.tooltip.capacity", { current: participantCount, capacity })
      : t("quota.generic.tooltip.unlimited", { current: participantCount });

    return (
      <section className={rootClassName} aria-label={t("quota.generic.label")}>
        <div className="quota-bar__slots" role="list">
          <div className="quota-bar__slot" data-quota-state="neutral" role="listitem">
            <div className="quota-bar__slot-header">
              <span className="quota-bar__role-name">{t("quota.generic.allMembers")}</span>
              <span className="quota-bar__role-count">{counter}</span>
            </div>
            {hasCapacity ? (
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
            ) : (
              <div
                className="quota-bar__progress quota-bar__progress--unlimited"
                aria-hidden="true"
              />
            )}
          </div>
        </div>
      </section>
    );
  }

  const labelFor = (slot: ClassQuotaSlot) =>
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
    <section
      className={rootClassName}
      aria-label={capacityConflictText
        ? `${t("quota.roles.label")}. ${capacityConflictText}`
        : t("quota.roles.label")}
      title={capacityConflictText}
      data-capacity-conflict={capacityConflict || undefined}
    >
      <div className="quota-bar__slots" role="list" style={slotGridStyle}>
        {summary.slots.map((slot) => {
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
            data-quota-state={otherOverflow > 0 || eventOverflow > 0 ? "short" : "neutral"}
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
    </section>
  );
}
