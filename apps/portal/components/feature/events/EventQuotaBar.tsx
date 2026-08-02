import { Tooltip } from "@mantine/core";
import type { Event } from "@guild/shared";
import type { ClassQuotaSlot, ClassQuotaSummary } from "@guild/shared/utils/class-quota";
import { useTranslation } from "react-i18next";
import "./EventQuotaBar.css";

/*
 * 活动卡与活动详情弹窗上的职业配额条。
 *
 * 一条横条按各组的 required 等比分段，所以整条的宽高跟配额组数无关——两组和六组占的
 * 位置一样大，卡片高度不会因为配额多而长高。这是它取代原来那排筹码的直接原因：筹码
 * 行的宽度随组数增长，多几组就换行，卡片跟着高一截。
 *
 * 每段里三截：
 *   实心   floor          任何排法下都跑不掉的人（专职）
 *   半透明 ceiling-floor  这一格最多还能坐下几个，得靠兼职的人过来
 *   空     required-ceil  够格的人本来就不够，怎么排都填不满
 * 空的那截是原来的筹码完全表达不了的信息：「还没报满」和「报满也填不满」是两回事。
 *
 * 颜色仍是三档，判定沿用算法给的 status（严谨的缺口集合），跟这里画的区间无关：
 *   绿 filled —— 专职就已经占满，谁也抢不走。
 *   黄 flex   —— 专职不够，但整体分配得开，凑得齐。
 *   红 short  —— 这一组格子在抢同一批人，加起来就是不够，必须去拉人。
 *
 * 组名和数字排在各自那一段的正下方，用同一组 flex 比例，所以标签和段永远对齐，也不会
 * 因为组多而折行。
 */
type EventQuotaBarProps = {
  summary: ClassQuotaSummary;
  /** 标签名字随活动一起返回，这里不自己查标签表，避免两处解析对不上。 */
  event: Pick<Event, "class_quotas">;
  /** 额外的类名，让调用方处理自己的外边距，不必把布局塞进条本身。 */
  className?: string;
};

/*
 * 分子写 floor（保底），不写区间。
 *
 * 「1–2/2」看着像在问读的人「到底是 1 还是 2」，而这一格实际有几个人本来就没有唯一答案
 * ——两个人都能坦能奶时，坦克这一格可以是 0、1 或 2，取决于另一格怎么排。区间说的是实话，
 * 但它把一个二义性直接甩给了读的人。
 *
 * floor 是一句没有歧义的话：这么多人跑不掉，谁也抢不走。够不够得着 required 由颜色回答，
 * 「最多能到几」由条上那截半透明和提示回答。三者各说一件事，不互相打架。
 */
function formatFloor(slot: ClassQuotaSlot): string {
  return `${slot.floor}/${slot.required}`;
}

export function EventQuotaBar({ summary, event, className }: EventQuotaBarProps) {
  const { t } = useTranslation("events");
  const labelByTagId = new Map(event.class_quotas.map((quota) => [quota.tag_id, quota.label]));

  /* 解析不出名字的标签**保留**并显示成「未知标签」：悄悄少一段只会让人以为自己配少了。 */
  const labelFor = (slot: ClassQuotaSlot) =>
    labelByTagId.get(slot.key) ?? t("quota.editor.unknownTag");

  const tooltipFor = (slot: ClassQuotaSlot) =>
    t(`quota.status.${slot.status}`, {
      label: labelFor(slot),
      floor: slot.floor,
      ceiling: slot.ceiling,
      required: slot.required,
      eligible: slot.eligible,
    });

  return (
    <div className={className ? `quota-bar ${className}` : "quota-bar"}>
      <div className="quota-bar__track">
        {summary.slots.map((slot) => (
          <Tooltip key={slot.key} label={tooltipFor(slot)}>
            <div
              className="quota-bar__segment"
              data-quota-status={slot.status}
              style={{ flexGrow: slot.required }}
            >
              <span className="quota-bar__floor" style={{ flexGrow: slot.floor }} />
              <span className="quota-bar__reach" style={{ flexGrow: slot.ceiling - slot.floor }} />
            </div>
          </Tooltip>
        ))}
      </div>

      <div className="quota-bar__labels">
        {summary.slots.map((slot) => (
          <Tooltip key={slot.key} label={tooltipFor(slot)}>
            <div
              className="quota-bar__label"
              data-quota-status={slot.status}
              style={{ flexGrow: slot.required }}
            >
              {/*
                写标签名，不画职业图标。一格可以认好几个职业，摆一串图标既挤掉数字，
                又答不上「这是哪一组」——「坦克」两个字才是人认得出来的东西。名字放不下
                时省略号截断，数字不参与收缩：段再窄也得看得见缺没缺。
              */}
              <span className="quota-bar__name">{labelFor(slot)}</span>
              <span className="quota-bar__count">{formatFloor(slot)}</span>
            </div>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
