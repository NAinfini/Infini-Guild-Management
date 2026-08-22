/*
 * 公平性敏感的抽取（抽奖选人）必须用 CSPRNG：Math.random 状态可被外推，
 * 参与者可据此预测中奖序列。返回值保持与 Math.random 相同的 [0,1) 53 位
 * 精度契约，测试仍可注入确定性替身。
 */
export function secureRandom(): number {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return ((words[0]! >>> 11) * 2 ** 32 + words[1]!) / 2 ** 53;
}
