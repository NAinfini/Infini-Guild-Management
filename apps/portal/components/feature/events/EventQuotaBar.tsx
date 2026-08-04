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

/*
 * 三态，且只有一态会改变进度条的颜色。
 *
 * 原先是 ready(绿) / short(红) / neutral(蓝) 三种色相并排：一条 6px 的细带上摆
 * 三个饱和色，谁也压不住谁；而且这三个色相说的不是同一件事——
 *   · 红色烧在「还没招满」上。报名进行中的大部分时间里每个岗位都还没招满，那是
 *     常态不是故障。红是站内「出事了，去处理」的颜色，用在常态上就等于教人无视它，
 *     还会跟同一张卡上真正的错误态撞车。
 *   · 蓝色只是因为「其他」是兜底那一格，是分类差异冒充状态差异。
 *   · 而「满了多少」这件事进度条的长度已经说过一遍了，颜色是在用另一套字母重说，
 *     还说得不一致：5/6 是红（快满了 = 报警），空着的 0/6 其他反倒是蓝（安静）。
 *
 * 现在：长度表示量，状态只在例外时说话，而色相被腾出来说另一件事——分类。
 *   filling —— 还在攒人，所有行的默认态。
 *   ready   —— 这一格够员了。条子色不变（100% 宽本身就是最强的信号），
 *              改由右上角计数变绿来点名。
 *   over    —— 人数超过容量。整条唯一会变红的情况，红在这条带子上从此只有一个意思。
 * 缺员在卡片上不再报警：卡片是概览，一排活动卡里每个没招满的岗位都亮红就是噪音。
 * 详情弹窗的名单仍然用红字标缺员——那里没有进度条，颜色是唯一的量的线索。
 *
 * 条子本身的色相由岗位在名单里的位次决定（data-quota-series，色值见 semantic.css
 * 的 --series-*），跟这三个状态无关：同一场活动里再怎么报名，颜色一个都不变。
 * 这跟上面「不许用色相冒充状态」是同一条规则的两面——色相被明确指派给分类之后，
 * 就不会再被误读成状态。规则由 EventQuotaBar.test.tsx 钉住。
 */
type QuotaVisualState = "ready" | "filling" | "over";

/*
 * 分类色序的长度，必须等于 semantic.css 里 --series-* 的位数。
 * 岗位多于四个就绕回第一位——相邻两格永远不同色，隔四格才会重复，
 * 而并排四格以上的活动本来就少见。
 */
const QUOTA_SERIES_LENGTH = 4;

function roleState(slot: ClassQuotaSlot): QuotaVisualState {
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
    const hasCapacity = capacity !== null;
    const counter = hasCapacity
      ? t("quota.generic.count", { current: participantCount, capacity })
      : t("quota.generic.unlimitedCount", { current: participantCount });
    const description = hasCapacity
      ? t("quota.generic.tooltip.capacity", { current: participantCount, capacity })
      : t("quota.generic.tooltip.unlimited", { current: participantCount });

    /* 无配额的报名条也认超员：容量是硬顶，报名人数越过它就是要处理的事。
       原先这里恒定一个颜色，12/10 和 8/10 长得一模一样。 */
    const overCapacity = hasCapacity && participantCount > capacity;

    return (
      <section className={rootClassName} aria-label={t("quota.generic.label")}>
        <div className="quota-bar__slots" role="list">
          <div
            className="quota-bar__slot"
            data-quota-state={overCapacity ? "over" : "filling"}
            role="listitem"
          >
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
    </section>
  );
}
