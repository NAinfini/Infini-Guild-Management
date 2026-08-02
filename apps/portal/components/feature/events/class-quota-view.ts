import type { Event, MemberProfile, User } from "@guild/shared";
import { summariseClassQuotas, type ClassQuotaSlot, type ClassQuotaSummary } from "@guild/shared/utils/class-quota";

type MemberEntry = { user: User; profile: MemberProfile };

/* 概览只用得上 id 和职业。仪表盘的报名人是从活动条的精简载荷拼出来的，没有完整的
   User/MemberProfile，卡这么宽只会逼调用方造假数据填字段。分组那边要把整条成员原样
   还给名单，所以它继续收完整的 MemberEntry。 */
type QuotaMemberEntry = { user: Pick<User, "id">; profile: Pick<MemberProfile, "classes"> };

/**
 * 把一个活动和它的报名名单折成配额概览。没配额就返回 null，让调用方整行不渲染
 * ——A-2 的筹码行「常驻」指的是配额存在时常驻，没配过配额的活动不该多出一条空占位。
 *
 * 投票和抽奖在服务端就存不进配额，这里不再判一次类型：真出现了带配额的投票活动，
 * 那是服务端的 bug，让它显出来，别在展示层悄悄吞掉。
 */
export function summariseEventClassQuotas(
  event: Pick<Event, "class_quotas">,
  members: readonly QuotaMemberEntry[],
): ClassQuotaSummary | null {
  if (event.class_quotas.length === 0) {
    return null;
  }
  return summariseClassQuotas(
    /* 标签成员由服务端随活动一起返回，这里不再自己查标签表——两边各解析一次的话，
       缓存不同步时筹码会跟名单对不上。 */
    event.class_quotas.map((quota) => ({
      key: quota.tag_id,
      class_ids: quota.class_ids,
      required: quota.required,
    })),
    members.map((member) => ({ user_id: member.user.id, class_ids: member.profile.classes })),
  );
}

export type ClassQuotaMemberGroup =
  | { kind: "quota"; slot: ClassQuotaSlot; members: MemberEntry[] }
  | { kind: "flexible" | "unassigned"; members: MemberEntry[] };

/**
 * 把名单按配额分组，供活动详情弹窗使用。
 *
 * 分组规则跟 summariseClassQuotas 的计数规则必须是同一条，否则弹窗里数出来的人头
 * 会跟筹码上的分子对不上：只沾一个配额职业的人进那一格（就是筹码的分子），沾两个
 * 及以上的人进「摇摆位」，一个都不沾的人进「无配额职业」。
 *
 * 空组也保留——「这一格一个人都没有」正是最需要被看见的情况。摇摆位和无配额两组
 * 为空时不返回，它们没有「应有几人」的期望值，空着不说明任何事。
 */
export function groupMembersByClassQuota(
  summary: ClassQuotaSummary,
  members: readonly MemberEntry[],
): ClassQuotaMemberGroup[] {
  /* 一个职业可以同时属于好几个标签，所以这里是「职业 → 它够得着的所有格子」。 */
  const slotIndexesByClassId = new Map<string, number[]>();
  summary.slots.forEach((slot, index) => {
    for (const classId of slot.class_ids) {
      const bucket = slotIndexesByClassId.get(classId);
      if (bucket) {
        bucket.push(index);
      } else {
        slotIndexesByClassId.set(classId, [index]);
      }
    }
  });
  const buckets: MemberEntry[][] = summary.slots.map(() => []);
  const flexible: MemberEntry[] = [];
  const unassigned: MemberEntry[] = [];

  for (const member of members) {
    const indices = new Set<number>();
    for (const classId of member.profile.classes) {
      for (const index of slotIndexesByClassId.get(classId) ?? []) {
        indices.add(index);
      }
    }
    if (indices.size === 0) {
      unassigned.push(member);
    } else if (indices.size === 1) {
      buckets[[...indices][0]!]!.push(member);
    } else {
      flexible.push(member);
    }
  }

  const groups: ClassQuotaMemberGroup[] = summary.slots.map((slot, index) => ({
    kind: "quota" as const,
    slot,
    members: buckets[index]!,
  }));
  if (flexible.length > 0) {
    groups.push({ kind: "flexible", members: flexible });
  }
  if (unassigned.length > 0) {
    groups.push({ kind: "unassigned", members: unassigned });
  }
  return groups;
}
