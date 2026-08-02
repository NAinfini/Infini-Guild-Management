/**
 * 职业配额的可行性判定。
 *
 * 活动可以设若干个「格子」，每格写明需要几个人、以及哪些职业算数。一格可以只认一个
 * 职业，也可以认一组——「需要 2 个治疗，牵丝霖和破竹风都行」就是后者。报名时不要求
 * 成员声明自己以哪个职业出场：一个同时挂着坦克和治疗标签的人，两格都算得上，但两格
 * 都没锁定。这种人叫「兼职」，只够格一格的叫「专职」。于是「还差几个」不是逐格相减能
 * 算出来的：兼职的人到底补哪一格，取决于整体怎么分配。
 *
 * 正确的模型是二分图最大匹配（格子侧带容量，即 b-matching）：
 *   报名者 —可胜任→ 格子
 * 最大匹配数 M 就是「最多能填满几个格子」，缺口 = 需求总数 − M。这个数是精确的，
 * 不受分配顺序影响。
 *
 * 单个格子的颜色不能只看它自己：
 *   - dedicated >= required  →「已配齐」。专职的人只能进这一格，谁也抢不走。
 *   - 在缺口集合里          →「真缺人」。这一组格子共同争抢同一批人，加起来不够，
 *                              必然有人补不上。
 *   - 其余                  →「兼职能补」。专职不够，但整体分配得开。
 *
 * 缺口集合用残量图可达性求出：从任何一个没填满的格子出发，沿「某个报名者能胜任
 * 这一格、但眼下占着另一格」的边回溯，走到的格子都属于同一个争抢组。可以证明该
 * 集合里的格子都不存在「还没被分配、又能胜任它」的人——否则最大匹配还能再加一。
 *
 * 单个格子有几个人，这件事本身没有唯一答案。最大匹配的**总数**是唯一的，怎么分到各格
 * 不是：两个人都能坦能奶、坦 2 奶 2 时，(2,0)(1,1)(0,2) 全是最大匹配。所以对外给的
 * 不是一个数，是一段区间：
 *   floor   = min(required, dedicated) —— 任何排法下这一格都至少有这么多人。专属的人
 *             没有别的去处，最大匹配下他们必然坐这儿，否则还能再多匹配一个。
 *   ceiling = min(required, eligible)  —— 这一格最多坐得下几个人。
 * 两个都是直接数出来的，不跑匹配，也不随报名顺序抖动。floor == ceiling 时展示层写一个
 * 数，不同才写区间。
 *
 * matched 保留，但只描述 member_ids 那一份具体名单有多长，不再当展示分子——它是多解里
 * 的任意一个，印在卡片上就是把随机结果说成事实。
 */

export type ClassQuotaRequirement = {
  /** 这一格的稳定标识。目录标签用标签 id，一次性标签用活动内的行 id。 */
  key: string;
  /** 这一格接受哪些职业。目录标签由调用方实时解析好再传进来。 */
  class_ids: readonly string[];
  required: number;
};

export type ClassQuotaParticipant = {
  user_id: string;
  class_ids: readonly string[];
};

/** filled = 专属已占满；flex = 专属不够但摇摆位补得上；short = 这一组人不够。 */
export type ClassQuotaStatus = "filled" | "flex" | "short";

export type ClassQuotaSlot = {
  key: string;
  class_ids: readonly string[];
  required: number;
  /** 这次分配实际坐进这一格的人数。只用来描述 member_ids 这一份名单，不作展示分子。 */
  matched: number;
  /** 只有这一格收得下的报名者数量。颜色判定用，不再当分子。 */
  dedicated: number;
  /** 够格进这一格的报名者总数，含兼职。 */
  eligible: number;
  /** 保底：任何一种排法下这一格都至少有这么多人 = min(required, dedicated)。 */
  floor: number;
  /** 上限：这一格最多坐得下这么多人 = min(required, eligible)。 */
  ceiling: number;
  status: ClassQuotaStatus;
  /** 实际坐进这一格的报名者 id，顺序同传入的报名名单。 */
  member_ids: string[];
};

export type ClassQuotaSummary = {
  slots: ClassQuotaSlot[];
  /** 至少够格进一格、但这次分配没排上的报名者（格子已满）。 */
  benched: string[];
  /** 一个格子都不沾的报名者。 */
  unassigned: string[];
  /** 同时能胜任两格及以上的报名者数量。 */
  flexible: number;
  requiredTotal: number;
  /** 最大匹配数：最多能填满几个格子。 */
  matchedTotal: number;
  /** requiredTotal − matchedTotal。0 表示这套阵容分配得开。 */
  shortfall: number;
};

/**
 * 丢掉重复的格子与非正数需求，并对每格的职业列表去重；顺序按传入顺序保留
 * （调用方已按目录排序）。职业列表为空的格子**保留**：空标签意味着谁也进不来，
 * 这一格会一路红到底，那正是管理员需要看见的事，不该悄悄消失。
 */
function normaliseQuotas(quotas: readonly ClassQuotaRequirement[]): ClassQuotaRequirement[] {
  const seen = new Set<string>();
  const result: ClassQuotaRequirement[] = [];
  for (const quota of quotas) {
    const required = Math.floor(quota.required);
    if (!quota.key || seen.has(quota.key) || !Number.isFinite(required) || required <= 0) {
      continue;
    }
    seen.add(quota.key);
    result.push({
      key: quota.key,
      class_ids: [...new Set(quota.class_ids.filter(Boolean))],
      required,
    });
  }
  return result;
}

/**
 * Kuhn 增广：把 participant 塞进它能胜任的某个格子，必要时把已经占位的人挪到
 * 别处。visited 标在格子上，保证同一次增广里每个格子只试一遍，不会绕环。
 */
function augment(
  participantIndex: number,
  eligibleSlots: readonly number[][],
  occupants: number[][],
  required: readonly number[],
  visited: boolean[],
): boolean {
  for (const slotIndex of eligibleSlots[participantIndex] ?? []) {
    if (visited[slotIndex]) continue;
    visited[slotIndex] = true;
    const seatedHere = occupants[slotIndex]!;
    if (seatedHere.length < required[slotIndex]!) {
      seatedHere.push(participantIndex);
      return true;
    }
    for (let seat = 0; seat < seatedHere.length; seat++) {
      const displaced = seatedHere[seat]!;
      seatedHere[seat] = participantIndex;
      if (augment(displaced, eligibleSlots, occupants, required, visited)) {
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
  const required = normalised.map((quota) => quota.required);
  const requiredTotal = required.reduce((total, value) => total + value, 0);

  /*
   * 一个职业可以出现在多个格子里（标签之间允许任意重叠），所以这里是一对多。
   * 这是「一格＝一职业」变成「一格＝一组职业」之后唯一需要改的地方：下面的增广、
   * 缺口回溯、三档判定操作的都是格子下标，跟职业怎么归组无关。
   */
  const slotIndexesByClassId = new Map<string, number[]>();
  normalised.forEach((quota, slotIndex) => {
    for (const classId of quota.class_ids) {
      const bucket = slotIndexesByClassId.get(classId);
      if (bucket) {
        bucket.push(slotIndex);
      } else {
        slotIndexesByClassId.set(classId, [slotIndex]);
      }
    }
  });

  const eligibleSlots: number[][] = [];
  const dedicated = normalised.map(() => 0);
  const eligibleCount = normalised.map(() => 0);
  const unassigned: string[] = [];
  let flexible = 0;

  for (const participant of participants) {
    const indices: number[] = [];
    const seen = new Set<number>();
    for (const classId of participant.class_ids) {
      for (const slotIndex of slotIndexesByClassId.get(classId) ?? []) {
        if (seen.has(slotIndex)) continue;
        seen.add(slotIndex);
        indices.push(slotIndex);
      }
    }
    eligibleSlots.push(indices);
    for (const index of indices) {
      eligibleCount[index]! += 1;
    }
    if (indices.length === 0) {
      unassigned.push(participant.user_id);
    } else if (indices.length === 1) {
      dedicated[indices[0]!]! += 1;
    } else {
      flexible += 1;
    }
  }

  const occupants: number[][] = normalised.map(() => []);
  let matchedTotal = 0;
  for (let participantIndex = 0; participantIndex < eligibleSlots.length; participantIndex++) {
    if (eligibleSlots[participantIndex]!.length === 0) continue;
    if (augment(participantIndex, eligibleSlots, occupants, required, normalised.map(() => false))) {
      matchedTotal += 1;
    }
  }

  // 谁在占哪一格——回溯缺口集合、以及算 benched 时都要反查。
  const seatOf = new Map<number, number>();
  for (let slotIndex = 0; slotIndex < occupants.length; slotIndex++) {
    for (const participantIndex of occupants[slotIndex]!) {
      seatOf.set(participantIndex, slotIndex);
    }
  }

  const benched: string[] = [];
  for (let participantIndex = 0; participantIndex < eligibleSlots.length; participantIndex++) {
    if (eligibleSlots[participantIndex]!.length === 0) continue;
    if (!seatOf.has(participantIndex)) {
      benched.push(participants[participantIndex]!.user_id);
    }
  }

  const deficient = new Set<number>();
  const queue: number[] = [];
  for (let slotIndex = 0; slotIndex < occupants.length; slotIndex++) {
    if (occupants[slotIndex]!.length < required[slotIndex]!) {
      deficient.add(slotIndex);
      queue.push(slotIndex);
    }
  }
  while (queue.length > 0) {
    const slotIndex = queue.shift()!;
    for (let participantIndex = 0; participantIndex < eligibleSlots.length; participantIndex++) {
      if (!eligibleSlots[participantIndex]!.includes(slotIndex)) continue;
      const seat = seatOf.get(participantIndex);
      if (seat === undefined || deficient.has(seat)) continue;
      deficient.add(seat);
      queue.push(seat);
    }
  }

  const slots: ClassQuotaSlot[] = normalised.map((quota, index) => ({
    key: quota.key,
    class_ids: quota.class_ids,
    required: quota.required,
    matched: occupants[index]!.length,
    dedicated: dedicated[index]!,
    eligible: eligibleCount[index]!,
    floor: Math.min(quota.required, dedicated[index]!),
    ceiling: Math.min(quota.required, eligibleCount[index]!),
    status: dedicated[index]! >= quota.required
      ? "filled"
      : deficient.has(index)
        ? "short"
        : "flex",
    // 占位表里存的是报名者下标，对外一律换成 user_id，顺序保持报名名单的顺序。
    member_ids: [...occupants[index]!]
      .sort((left, right) => left - right)
      .map((participantIndex) => participants[participantIndex]!.user_id),
  }));

  return {
    slots,
    benched,
    unassigned,
    flexible,
    requiredTotal,
    matchedTotal,
    shortfall: requiredTotal - matchedTotal,
  };
}
