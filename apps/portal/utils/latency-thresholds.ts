/**
 * 系统状态面板的响应延迟分档阈值。
 *
 * 此前 `AdminSystemSection.tsx` 和 `AdminStatusTab.tsx` 各自写了一份 200ms/400ms
 * 的判断——是同一套语义边界的两份拷贝。参照 `event-colors.ts` 的先例收敛成一份，
 * 两处都改成从这里 import，不再各自维护一份数值（the inline-style migration contract B 节）。
 *
 * 三档语义（边界值归入更差的一档，区间左闭右开、首尾相接、无缝隙）：
 * - good：      ms < 200                —— 响应迅速，几乎无感知延迟
 * - warn： 200 <= ms < 400               —— 有可感知延迟，但仍可接受
 * - bad：  400 <= ms                     —— 延迟明显，需要关注
 */
export type LatencyBand = "good" | "warn" | "bad";

/** warn 档的下界（毫秒）。低于这个值判定为 good，达到即判定为 warn。 */
export const LATENCY_WARN_THRESHOLD_MS = 200;

/** bad 档的下界（毫秒）。达到或超过这个值判定为 bad。 */
export const LATENCY_BAD_THRESHOLD_MS = 400;

export function latencyBand(ms: number): LatencyBand {
  if (ms < LATENCY_WARN_THRESHOLD_MS) return "good";
  if (ms < LATENCY_BAD_THRESHOLD_MS) return "warn";
  return "bad";
}

/**
 * 延迟条 / 延迟环画到满格对应的毫秒数：500ms 及以上一律满格。
 *
 * 这个 500 此前在 `AdminSystemSection.tsx` 的 latencyPercent() 和
 * `AdminStatusTab.tsx` 的 barWidth 里各写了一遍，是同一条标尺的两份拷贝——
 * 改一处不改另一处，环和条就会对同一个数字画出不同的长度。
 * 和上面两个阈值一样收敛到这里。
 */
export const LATENCY_FULL_SCALE_MS = 500;

/** 把毫秒换算成 0-100 的长度百分比，超过满格刻度就停在 100。 */
export function latencyScalePercent(ms: number): number {
  return Math.min(100, (ms / LATENCY_FULL_SCALE_MS) * 100);
}
