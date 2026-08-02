import { Tooltip } from "@mantine/core";
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
  return slot.eligible >= slot.required ? "ready" : "short";
}

function progressWidth(current: number, maximum: number): string {
  const safeMaximum = Math.max(maximum, 1);
  const safeCurrent = Math.max(0, Math.min(current, safeMaximum));
  return String(safeCurrent / safeMaximum * 100) + "%";
}

/**
 * A role row describes availability only: everyone who can play that role counts once, including
 * multi-role members. The lineup status above it uses maximum matching, so it alone answers
 * whether those members can fill every seat at the same time without being counted twice.
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
    const tooltip = hasCapacity
      ? t("quota.generic.tooltip.capacity", { current: participantCount, capacity })
      : t("quota.generic.tooltip.unlimited", { current: participantCount });

    return (
      <section className={rootClassName} aria-label={t("quota.generic.label")}>
        <div className="quota-bar__overall" data-quota-state="neutral">
          <div className="quota-bar__overall-primary">
            <span className="quota-bar__state-dot" aria-hidden="true" />
            <span className="quota-bar__overall-label">{t("quota.generic.label")}</span>
          </div>
          <span className="quota-bar__overall-count">{counter}</span>
        </div>
        <Tooltip label={tooltip}>
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
                  aria-valuetext={tooltip}
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
              <span className="quota-bar__slot-status">
                {hasCapacity
                  ? t("quota.generic.capacitySet", { capacity })
                  : t("quota.generic.unlimited")}
              </span>
            </div>
          </div>
        </Tooltip>
      </section>
    );
  }

  const labelFor = (slot: ClassQuotaSlot) =>
    labelByTagId.get(slot.key) ?? t("quota.editor.unknownTag");
  const lineupState: QuotaVisualState = summary.shortfall === 0 ? "ready" : "short";
  const lineupTooltip = t("quota.lineup." + lineupState + "Hint", {
    count: summary.shortfall,
  });
  const slotGridStyle = {
    "--quota-slot-count": summary.slots.length,
  } as CSSProperties;

  return (
    <section className={rootClassName} aria-label={t("quota.lineup.label")}>
      <Tooltip label={lineupTooltip}>
        <div className="quota-bar__overall" data-quota-state={lineupState}>
          <div className="quota-bar__overall-primary">
            <span className="quota-bar__state-dot" aria-hidden="true" />
            <span className="quota-bar__overall-label">
              {t("quota.lineup." + lineupState, { count: summary.shortfall })}
            </span>
          </div>
          <span className="quota-bar__overall-count">
            {t("quota.lineup.count", {
              matched: summary.matchedTotal,
              required: summary.requiredTotal,
            })}
          </span>
        </div>
      </Tooltip>

      <div className="quota-bar__slots" role="list" style={slotGridStyle}>
        {summary.slots.map((slot) => {
          const state = roleState(slot);
          const label = labelFor(slot);
          const covered = Math.min(slot.eligible, slot.required);
          const shortfall = Math.max(slot.required - slot.eligible, 0);
          const tooltip = t("quota.role.tooltip." + state, {
            label,
            available: slot.eligible,
            required: slot.required,
            count: shortfall,
          });

          return (
            <Tooltip key={slot.key} label={tooltip}>
              <div className="quota-bar__slot" data-quota-state={state} role="listitem">
                <div className="quota-bar__slot-header">
                  <span className="quota-bar__role-name">{label}</span>
                  <span className="quota-bar__role-count">{slot.eligible} / {slot.required}</span>
                </div>
                <div
                  className="quota-bar__progress"
                  role="progressbar"
                  aria-label={label}
                  aria-valuemin={0}
                  aria-valuemax={slot.required}
                  aria-valuenow={covered}
                  aria-valuetext={tooltip}
                >
                  <span
                    className="quota-bar__progress-fill"
                    style={{ width: progressWidth(covered, slot.required) }}
                  />
                </div>
                <span className="quota-bar__slot-status">
                  {state === "ready"
                    ? t("quota.role.ready")
                    : t("quota.role.short", { count: shortfall })}
                </span>
              </div>
            </Tooltip>
          );
        })}
      </div>
    </section>
  );
}
