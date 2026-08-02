import { Tooltip } from "@mantine/core";
import type { Event } from "@guild/shared";
import type { ClassQuotaSummary } from "@guild/shared/utils/class-quota";
import { ReplaceIcon } from "@portal/components/icons";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { resolveClassCatalogItem, useClassCatalogStore } from "@portal/stores/class-catalog";
import { useTranslation } from "react-i18next";
import "./EventClassQuotaChips.css";

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
 * 分子是「这次分配实际坐进这一格的人数」（matched），不是专属人数，也不是能胜任的
 * 人数。能胜任会重复计数——摇摆位同时挂在好几格上，几个分子加起来会超过实到人数；
 * 专属则在一格认一组职业之后大面积掉到 0，一套完全配得齐的阵容会显示成
 * `0/2 0/2 1/3`，看着像全线告急。matched 每人只坐一格，加起来正好是排上的人数，
 * 读起来就是「这一格现在有几个人」，也跟下面名单里那一组的人数对得上。
 * 代价是它依赖具体分配：新人报名可能让摇摆位挪窝，旁边格子的数字跟着跳。颜色不受
 * 影响——三档判定用的是严谨的缺口集合，跟摇摆位坐哪一格无关。
 *
 * 一格是一个职业标签，可能装着好几个职业，所以筹码上摆的是这一格接受的全部职业图标，
 * 名字只在提示里出现——卡片上塞不下「治疗」两个字加一串图标。
 */
type EventClassQuotaChipsProps = {
  summary: ClassQuotaSummary;
  /** 标签名字随活动一起返回，筹码不自己查标签表，避免两处解析对不上。 */
  event: Pick<Event, "class_quotas">;
  /** 额外的类名，让调用方处理自己的外边距，不必把布局塞进筹码行本身。 */
  className?: string;
};

export function EventClassQuotaChips({ summary, event, className }: EventClassQuotaChipsProps) {
  const { t } = useTranslation("events");
  const catalog = useClassCatalogStore((state) => state.items);
  const labelByTagId = new Map(event.class_quotas.map((quota) => [quota.tag_id, quota.label]));

  return (
    <div className={className ? `quota-chips ${className}` : "quota-chips"}>
      {summary.slots.map((slot) => {
        const label = labelByTagId.get(slot.key) ?? t("quota.editor.unknownTag");
        return (
          <Tooltip
            key={slot.key}
            label={t(`quota.status.${slot.status}`, {
              label,
              matched: slot.matched,
              dedicated: slot.dedicated,
              required: slot.required,
              eligible: slot.eligible,
            })}
          >
            <span className="quota-chips__chip" data-quota-status={slot.status}>
              {slot.class_ids.map((classId) => (
                <ClassIcon
                  key={classId}
                  item={resolveClassCatalogItem(classId, catalog)}
                  size={16}
                  framed={false}
                />
              ))}
              <span className="quota-chips__count">
                {slot.matched}/{slot.required}
              </span>
            </span>
          </Tooltip>
        );
      })}
      {/* 一个摇摆位都没有时这个筹码没有信息量，直接不渲染。 */}
      {summary.flexible > 0 ? (
        <Tooltip label={t("quota.flexible.hint", { count: summary.flexible })}>
          <span className="quota-chips__chip" data-quota-status="swing">
            <ReplaceIcon size={13} />
            <span className="quota-chips__count">{summary.flexible}</span>
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}
