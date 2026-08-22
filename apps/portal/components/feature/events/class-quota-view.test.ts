// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Event, MemberProfile, User } from "@guild/shared";
import { groupMembersByClassQuota, summariseEventClassQuotas } from "./class-quota-view";

function member(id: string, classes: string[]): { user: User; profile: MemberProfile } {
  return {
    user: { id, username: id } as unknown as User,
    profile: { classes } as unknown as MemberProfile,
  };
}

describe("summariseEventClassQuotas", () => {
  it("returns null when the event has no quotas so the chip row is not rendered at all", () => {
    const event = { class_quotas: [] } as unknown as Pick<Event, "class_quotas">;

    expect(summariseEventClassQuotas(event, [member("a", ["healer"])])).toBeNull();
  });
});

describe("groupMembersByClassQuota", () => {
  /* 治疗这一格收两种职业，坦克那一格只收一种——一格一职业只是标签里刚好只有一个成员。 */
  const event = {
    class_quotas: [
      { tag_id: "healer", label: "治疗", class_ids: ["white-mage", "droid"], required: 2 },
      { tag_id: "tank", label: "坦克", class_ids: ["tank"], required: 1 },
    ],
  } as unknown as Pick<Event, "class_quotas">;

  /* 走 summariseEventClassQuotas 而不是直接调算法：配额行到格子的映射本身就是这个
     文件的职责，绕过去测就漏掉了它。 */
  function summarise(members: { user: User; profile: MemberProfile }[]) {
    const summary = summariseEventClassQuotas(event, members);
    if (!summary) throw new Error("fixture has quotas, so the summary must not be null");
    return summary;
  }

  it("splits members the same way the chips count them, so the numerators match the group sizes", () => {
    const members = [
      member("white-mage", ["white-mage"]),
      member("droid", ["droid"]),
      member("solo-tank", ["tank"]),
      member("swing", ["droid", "tank"]),
      member("dps", ["dps"]),
    ];
    const summary = summarise(members);

    const groups = groupMembersByClassQuota(summary, members);

    // 每个配额组的人数必须等于筹码上的分子，否则弹窗里数出来的人跟卡片对不上。
    for (const group of groups) {
      if (group.kind === "quota") {
        expect(group.members).toHaveLength(group.slot.matched);
      }
    }
    expect(groups.map((group) => (group.kind === "quota" ? group.slot.key : group.kind)))
      .toEqual(["healer", "tank", "other"]);
    // 两种治疗职业都进同一格，这正是标签存在的理由。
    expect(groups[0]!.members.map((entry) => entry.user.id)).toEqual(["white-mage", "droid"]);
    /* 格子满了没排上的、和一格都不沾的，合在「其他」里——都不是凭空消失。 */
    expect(groups[2]!.members.map((entry) => entry.user.id)).toEqual(["swing", "dps"]);
  });

  it("seats a member eligible for several groups in the one they were assigned to", () => {
    /* 兼职的人不再单列一组：单列的话「治疗这一格现在都有谁」就答不上来了。 */
    const members = [member("swing", ["droid", "tank"])];
    const summary = summarise(members);

    const groups = groupMembersByClassQuota(summary, members);

    expect(groups.map((group) => (group.kind === "quota" ? group.slot.key : group.kind)))
      .toEqual(["healer", "tank"]);
    expect(groups[0]!.members.map((entry) => entry.user.id)).toEqual(["swing"]);
    expect(groups[1]!.members).toEqual([]);
  });

  it("keeps an empty quota group but drops the empty other group", () => {
    const members = [member("solo-tank", ["tank"])];
    const summary = summarise(members);

    const groups = groupMembersByClassQuota(summary, members);

    // healer 一个人都没有恰恰是最该被看见的，留着；「其他」为空则不说明任何事。
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ kind: "quota", members: [] });
    expect(groups[1]).toMatchObject({ kind: "quota" });
  });

  it("counts a member holding a duplicate class id once, not as a shared member", () => {
    const members = [member("dupe", ["droid", "droid"])];
    const summary = summarise(members);

    const groups = groupMembersByClassQuota(summary, members);

    expect(summary.flexible).toBe(0);
    expect(groups.map((group) => (group.kind === "quota" ? group.slot.key : group.kind)))
      .toEqual(["healer", "tank"]);
    expect(groups[0]!.members.map((entry) => entry.user.id)).toEqual(["dupe"]);
  });

  it("does not count a member as shared when both their classes sit in the same group", () => {
    /* 两种治疗都会打，但只有治疗那一格收得下他——兼职说的是「够得着好几格」，
       不是「会好几个职业」。 */
    const members = [member("both-healers", ["white-mage", "droid"])];
    const summary = summarise(members);

    const groups = groupMembersByClassQuota(summary, members);

    expect(summary.flexible).toBe(0);
    expect(groups.map((group) => (group.kind === "quota" ? group.slot.key : group.kind)))
      .toEqual(["healer", "tank"]);
    expect(groups[0]!.members.map((entry) => entry.user.id)).toEqual(["both-healers"]);
  });
});
