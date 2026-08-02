/**
 * 职业配额的可行性判定。
 *
 * 活动可以为每个职业设定「需要几个」。报名时不要求成员声明自己以哪个职业出场——
 * 一个同时挂着坦克和治疗标签的人，两边都算得上，但两边都没锁定。这种人叫「摇摆位」。
 * 于是「还差几个」不是逐格相减能算出来的：摇摆位到底补哪一格，取决于整体怎么分配。
 *
 * 正确的模型是二分图最大匹配（职业侧带容量，即 b-matching）：
 *   报名者 —可胜任→ 职业格子
 * 最大匹配数 M 就是「最多能填满几个格子」，缺口 = 需求总数 − M。这个数是精确的，
 * 不受分配顺序影响。
 *
 * 单个职业的颜色不能只看它自己：
 *   - dedicated >= required  →「已配齐」。专属的人只能进这一格，谁也抢不走。
 *   - 在缺口集合里          →「真缺人」。这一组职业共同争抢同一批人，加起来不够，
 *                              必然有人补不上。
 *   - 其余                  →「摇摆位能补」。专属不够，但整体分配得开。
 *
 * 缺口集合用残量图可达性求出：从任何一个没填满的职业出发，沿「某个报名者能胜任
 * 这一格、但眼下占着另一格」的边回溯，走到的职业都属于同一个争抢组。可以证明该
 * 集合里的职业都不存在「还没被分配、又能胜任它」的人——否则最大匹配还能再加一。
 */

export type ClassQuotaRequirement = {
  class_id: string;
  required: number;
};

export type ClassQuotaParticipant = {
  user_id: string;
  class_ids: readonly string[];
};

/** filled = 专属已占满；flex = 专属不够但摇摆位补得上；short = 这一组人不够。 */
export type ClassQuotaStatus = "filled" | "flex" | "short";

export type ClassQuotaSlot = {
  class_id: string;
  required: number;
  /** 只能进这一格的报名者数量，也就是筹码上显示的分子。 */
  dedicated: number;
  /** 挂着这个职业的报名者总数，含摇摆位。 */
  eligible: number;
  status: ClassQuotaStatus;
};

export type ClassQuotaSummary = {
  slots: ClassQuotaSlot[];
  /** 同时能胜任两个及以上配额职业的报名者。 */
  flexible: number;
  /** 一个配额职业都不沾的报名者。 */
  unassigned: number;
  requiredTotal: number;
  /** 最大匹配数：最多能填满几个格子。 */
  matchedTotal: number;
  /** requiredTotal − matchedTotal。0 表示这套阵容分配得开。 */
  shortfall: number;
};

/** 丢掉重复项与非正数需求；顺序按传入顺序保留（调用方已按目录排序）。 */
function normaliseQuotas(quotas: readonly ClassQuotaRequirement[]): ClassQuotaRequirement[] {
  const seen = new Set<string>();
  const result: ClassQuotaRequirement[] = [];
  for (const quota of quotas) {
    const required = Math.floor(quota.required);
    if (!quota.class_id || seen.has(quota.class_id) || !Number.isFinite(required) || required <= 0) {
      continue;
    }
    seen.add(quota.class_id);
    result.push({ class_id: quota.class_id, required });
  }
  return result;
}

/**
 * Kuhn 增广：把 participant 塞进它能胜任的某个职业格子，必要时把已经占位的人挪到
 * 别处。visited 标在职业上，保证同一次增广里每个职业只试一遍，不会绕环。
 */
function augment(
  participantIndex: number,
  eligibleClasses: readonly number[][],
  occupants: number[][],
  required: readonly number[],
  visited: boolean[],
): boolean {
  for (const classIndex of eligibleClasses[participantIndex] ?? []) {
    if (visited[classIndex]) continue;
    visited[classIndex] = true;
    const seatedHere = occupants[classIndex]!;
    if (seatedHere.length < required[classIndex]!) {
      seatedHere.push(participantIndex);
      return true;
    }
    for (let seat = 0; seat < seatedHere.length; seat++) {
      const displaced = seatedHere[seat]!;
      seatedHere[seat] = participantIndex;
      if (augment(displaced, eligibleClasses, occupants, required, visited)) {
        return true;
      }
      seatedHere[seat] = displaced;
    }
  }
  return false;
}

export function summariseClassQuotas(
  quotas: readonly ClassQuotaRequirement[],
  participants: readonly ClassQuotaParticipant[],
): ClassQuotaSummary {
  const normalised = normaliseQuotas(quotas);
  const classIndexById = new Map(normalised.map((quota, index) => [quota.class_id, index]));
  const required = normalised.map((quota) => quota.required);
  const requiredTotal = required.reduce((total, value) => total + value, 0);

  const eligibleClasses: number[][] = [];
  const dedicated = normalised.map(() => 0);
  const eligibleCount = normalised.map(() => 0);
  let flexible = 0;
  let unassigned = 0;

  for (const participant of participants) {
    const indices: number[] = [];
    const seen = new Set<number>();
    for (const classId of participant.class_ids) {
      const index = classIndexById.get(classId);
      if (index === undefined || seen.has(index)) continue;
      seen.add(index);
      indices.push(index);
    }
    eligibleClasses.push(indices);
    for (const index of indices) {
      eligibleCount[index]! += 1;
    }
    if (indices.length === 0) {
      unassigned += 1;
    } else if (indices.length === 1) {
      dedicated[indices[0]!]! += 1;
    } else {
      flexible += 1;
    }
  }

  const occupants: number[][] = normalised.map(() => []);
  let matchedTotal = 0;
  for (let participantIndex = 0; participantIndex < eligibleClasses.length; participantIndex++) {
    if (eligibleClasses[participantIndex]!.length === 0) continue;
    if (augment(participantIndex, eligibleClasses, occupants, required, normalised.map(() => false))) {
      matchedTotal += 1;
    }
  }

  // 谁在占哪一格——回溯缺口集合时要反查。
  const seatOf = new Map<number, number>();
  for (let classIndex = 0; classIndex < occupants.length; classIndex++) {
    for (const participantIndex of occupants[classIndex]!) {
      seatOf.set(participantIndex, classIndex);
    }
  }

  const deficient = new Set<number>();
  const queue: number[] = [];
  for (let classIndex = 0; classIndex < occupants.length; classIndex++) {
    if (occupants[classIndex]!.length < required[classIndex]!) {
      deficient.add(classIndex);
      queue.push(classIndex);
    }
  }
  while (queue.length > 0) {
    const classIndex = queue.shift()!;
    for (let participantIndex = 0; participantIndex < eligibleClasses.length; participantIndex++) {
      if (!eligibleClasses[participantIndex]!.includes(classIndex)) continue;
      const seat = seatOf.get(participantIndex);
      if (seat === undefined || deficient.has(seat)) continue;
      deficient.add(seat);
      queue.push(seat);
    }
  }

  const slots: ClassQuotaSlot[] = normalised.map((quota, index) => ({
    class_id: quota.class_id,
    required: quota.required,
    dedicated: dedicated[index]!,
    eligible: eligibleCount[index]!,
    status: dedicated[index]! >= quota.required
      ? "filled"
      : deficient.has(index)
        ? "short"
        : "flex",
  }));

  return {
    slots,
    flexible,
    unassigned,
    requiredTotal,
    matchedTotal,
    shortfall: requiredTotal - matchedTotal,
  };
}
