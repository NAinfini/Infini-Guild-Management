import type { Event, MemberProfile, User } from "@guild/shared";
import { summariseClassQuotas, type ClassQuotaSummary } from "@guild/shared/utils/class-quota";

type MemberEntry = { user: User; profile: MemberProfile };

/**
 * 把一个活动和它的报名名单折成配额概览。没配额就返回 null，让调用方整行不渲染
 * ——A-2 的筹码行「常驻」指的是配额存在时常驻，没配过配额的活动不该多出一条空占位。
 *
 * 投票和抽奖在服务端就存不进配额，这里不再判一次类型：真出现了带配额的投票活动，
 * 那是服务端的 bug，让它显出来，别在展示层悄悄吞掉。
 */
export function summariseEventClassQuotas(
  event: Pick<Event, "class_quotas">,
  members: readonly MemberEntry[],
): ClassQuotaSummary | null {
  if (event.class_quotas.length === 0) {
    return null;
  }
  return summariseClassQuotas(
    event.class_quotas,
    members.map((member) => ({ user_id: member.user.id, class_ids: member.profile.classes })),
  );
}
