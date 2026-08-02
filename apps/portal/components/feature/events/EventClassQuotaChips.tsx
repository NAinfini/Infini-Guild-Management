import { Tooltip } from "@mantine/core";
import type { ClassQuotaSummary } from "@guild/shared/utils/class-quota";
import { ReplaceIcon } from "@portal/components/icons";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { resolveClassCatalogItem, useClassCatalogStore } from "@portal/stores/class-catalog";
import { useTranslation } from "react-i18next";

/*
 * 活动卡上的职业配额筹码行。
 *
 * 颜色分三档，这是这一行存在的全部意义：
 *   绿 filled —— 只能打这个职业的人已经够了，谁也抢不走，不用管。
 *   琥珀 flex —— 专属的人不够，但摇摆位分配得开，凑得齐，只是没冗余。
 *   红  short —— 这一组职业在抢同一批人，加起来就是不够，必须去拉人。
 * 只分红绿两档的话，「摇摆位到底补不补得上」这个计算就白算了：所有没占满的格子
 * 都会一律标红，管理员根本分不出哪一格是真缺人。
 *
 * 分子是「专属」人数而不是「能胜任」人数：摇摆位同时挂在好几格上，要是每格都算
 * 进分子，几个分子加起来会超过实到人数。摇摆位单独由行尾那个筹码报数。
 */
type EventClassQuotaChipsProps = {
  summary: ClassQuotaSummary;
};

export function EventClassQuotaChips({ summary }: EventClassQuotaChipsProps) {
  const { t } = useTranslation("events");
  const catalog = useClassCatalogStore((state) => state.items);

  return (
    <div className="event-card__quota-row">
      {summary.slots.map((slot) => {
        const item = resolveClassCatalogItem(slot.class_id, catalog);
        return (
          <Tooltip
            key={slot.class_id}
            label={t(`quota.status.${slot.status}`, {
              label: item.label,
              dedicated: slot.dedicated,
              required: slot.required,
              eligible: slot.eligible,
            })}
          >
            <span className="event-card__quota-chip" data-quota-status={slot.status}>
              <ClassIcon item={item} size={16} framed={false} />
              <span className="event-card__quota-count">
                {slot.dedicated}/{slot.required}
              </span>
            </span>
          </Tooltip>
        );
      })}
      {/* 一个摇摆位都没有时这个筹码没有信息量，直接不渲染。 */}
      {summary.flexible > 0 ? (
        <Tooltip label={t("quota.flexible.hint", { count: summary.flexible })}>
          <span className="event-card__quota-chip" data-quota-status="swing">
            <ReplaceIcon size={13} />
            <span className="event-card__quota-count">{summary.flexible}</span>
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}
