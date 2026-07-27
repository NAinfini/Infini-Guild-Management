import { activeGame } from "@guild/shared/games";

/**
 * 活动类型 → Mantine 色阶名。派生自游戏配置，是唯一事实来源。
 *
 * 这张表此前在 EventCardsView / EventMonthView / dashboard/shared 里各推导了一份，
 * 三处的兜底值在改色时分叉成了 gray / gray / lime。收敛到这里，兜底只有一个取值。
 */
export const EVENT_TYPE_COLORS: Record<string, string> = Object.fromEntries(
  activeGame.eventTypes.map((et) => [et.id, et.color]),
);

/**
 * 配置里不存在的活动类型用的颜色。
 *
 * 刻意不用 `other` 那一档的 gray：`other` 是配置内的合法类型，未知类型是数据异常，
 * 两者渲染成同一个颜色会把异常伪装成正常值。lime 未被 eventTypes 占用。
 */
export const UNKNOWN_EVENT_TYPE_COLOR = "lime";
