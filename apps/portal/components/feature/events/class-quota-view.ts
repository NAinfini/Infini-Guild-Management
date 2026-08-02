import type { ClassTag, Event, EventClassQuotaInput, MemberProfile, User } from "@guild/shared";
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

/**
 * 把读回来的配额折成表单要提交的写法。
 *
 * 目录标签只留 tag_id 和数量：名字和成员归标签自己管，表单里存一份就会跟目录漂。
 * 一次性组反过来必须把名字和成员整个带上——它的 tag_id 指的是一行**属于这个活动的**
 * 私有标签，每次保存都整组重建，把旧 id 回传给服务端会被当成不存在的标签直接 400
 * （见 worker 的 findUnknownTagIds）。所以它在表单里是「一份内容」，不是「一个引用」。
 */
export function toClassQuotaInputs(
  quotas: Event["class_quotas"],
): EventClassQuotaInput[] {
  return quotas.map((quota) => (
    quota.one_time
      ? { tag: { label: quota.label ?? "", class_ids: [...quota.class_ids] }, required: quota.required }
      : { tag_id: quota.tag_id, required: quota.required }
  ));
}

/**
 * toClassQuotaInputs 的逆向：把表单里的配额还原成活动上的配额，供预览用。
 *
 * 目录标签在表单里只剩一个 tag_id，而筹码要画图标、要写名字，两样都得从标签表补回来。
 * 补不回来的标签**保留**成一格空的：它在编辑器那一行已经显示成「未知标签」了，预览
 * 里再悄悄少一格，只会让人以为自己配少了。一次性组自带内容，直接搬。
 *
 * tag_id 在这里只当分组的键用——预览不落库，不会被当成真的标签引用回传服务端。
 */
export function fromClassQuotaInputs(
  inputs: readonly EventClassQuotaInput[],
  tags: readonly ClassTag[],
): Event["class_quotas"] {
  return inputs.map((input, index) => {
    if ("tag_id" in input) {
      const tag = tags.find((entry) => entry.id === input.tag_id);
      return {
        tag_id: input.tag_id,
        label: tag?.label ?? null,
        class_ids: tag ? [...tag.class_ids] : [],
        required: input.required,
        one_time: false,
      };
    }
    return {
      tag_id: `one-time-${index}`,
      label: input.tag.label,
      class_ids: [...input.tag.class_ids],
      required: input.required,
      one_time: true,
    };
  });
}

/** swing 表示这个人同时够格进两格及以上，只是这次被排在了当前这一组。 */
export type ClassQuotaRosterMember = MemberEntry & { swing: boolean };

export type ClassQuotaMemberGroup =
  | { kind: "quota"; slot: ClassQuotaSlot; members: ClassQuotaRosterMember[] }
  | { kind: "benched" | "unassigned"; members: ClassQuotaRosterMember[] };

/**
 * 把名单按配额分组，供活动详情弹窗使用。
 *
 * 分组直接用算法给出的分配结果（slot.member_ids），所以每组的人数**就是**筹码上的
 * 分子——两边同源，不可能对不上。这也是唯一能做到这一点的分法：摇摆位坐哪一格是分配
 * 算出来的，展示层自己按职业重新归组只会得出另一套答案。
 *
 * 摇摆位不再单列一组。单列的话，一个能打治疗也能打坦克的人会从两组里同时消失，
 * 「治疗这一组现在都有谁」这个问题反而答不上来。他现在就坐在被分到的那一格里，
 * 挂个 swing 标记说明他随时可以挪走。
 *
 * benched 是够格但没排上的人（格子已经满了），unassigned 是一格都不沾的人。
 * 空组保留——「这一格一个人都没有」正是最需要被看见的情况；后两组为空时不返回，
 * 它们没有「应有几人」的期望值，空着不说明任何事。
 */
export function groupMembersByClassQuota(
  summary: ClassQuotaSummary,
  members: readonly MemberEntry[],
): ClassQuotaMemberGroup[] {
  const byUserId = new Map(members.map((member) => [member.user.id, member]));
  const swingUserIds = findSwingUserIds(summary, members);
  const decorate = (userId: string): ClassQuotaRosterMember[] => {
    const member = byUserId.get(userId);
    return member ? [{ ...member, swing: swingUserIds.has(userId) }] : [];
  };

  const groups: ClassQuotaMemberGroup[] = summary.slots.map((slot) => ({
    kind: "quota" as const,
    slot,
    members: slot.member_ids.flatMap(decorate),
  }));
  const benched = summary.benched.flatMap(decorate);
  if (benched.length > 0) {
    groups.push({ kind: "benched", members: benched });
  }
  const unassigned = summary.unassigned.flatMap(decorate);
  if (unassigned.length > 0) {
    groups.push({ kind: "unassigned", members: unassigned });
  }
  return groups;
}

/**
 * 谁是摇摆位。summary 只给了摇摆位的**数量**，标记要挂到具体的人身上，只能在这里
 * 按同一条规则再判一次：够格进两格及以上就是摇摆位。
 */
function findSwingUserIds(
  summary: ClassQuotaSummary,
  members: readonly MemberEntry[],
): Set<string> {
  /* 一个职业可以同时属于好几个标签，所以这里是「职业 → 它够得着的所有格子」。 */
  const slotKeysByClassId = new Map<string, string[]>();
  for (const slot of summary.slots) {
    for (const classId of slot.class_ids) {
      const bucket = slotKeysByClassId.get(classId);
      if (bucket) {
        bucket.push(slot.key);
      } else {
        slotKeysByClassId.set(classId, [slot.key]);
      }
    }
  }
  const swing = new Set<string>();
  for (const member of members) {
    const keys = new Set<string>();
    for (const classId of member.profile.classes) {
      for (const key of slotKeysByClassId.get(classId) ?? []) {
        keys.add(key);
      }
    }
    if (keys.size > 1) {
      swing.add(member.user.id);
    }
  }
  return swing;
}
