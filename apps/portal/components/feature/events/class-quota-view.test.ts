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
  const event = {
    class_quotas: [
      { class_id: "healer", required: 2 },
      { class_id: "tank", required: 1 },
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
      member("solo-healer", ["healer"]),
      member("solo-tank", ["tank"]),
      member("swing", ["healer", "tank"]),
      member("dps", ["dps"]),
    ];
    const summary = summarise(members);

    const groups = groupMembersByClassQuota(summary, members);

    // 每个配额组的人数必须等于筹码上的分子，否则弹窗里数出来的人跟卡片对不上。
    for (const group of groups) {
      if (group.kind === "quota") {
        expect(group.members).toHaveLength(group.slot.dedicated);
      }
    }
    expect(groups.map((group) => (group.kind === "quota" ? group.slot.key : group.kind)))
      .toEqual(["healer", "tank", "flexible", "unassigned"]);
    expect(groups[2]!.members.map((entry) => entry.user.id)).toEqual(["swing"]);
    expect(groups[3]!.members.map((entry) => entry.user.id)).toEqual(["dps"]);
  });

  it("keeps an empty quota group but drops the empty flex and no-quota groups", () => {
    const members = [member("solo-tank", ["tank"])];
    const summary = summarise(members);

    const groups = groupMembersByClassQuota(summary, members);

    // healer 一个人都没有恰恰是最该被看见的，留着；摇摆位和无配额为空则不说明任何事。
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ kind: "quota", members: [] });
    expect(groups[1]).toMatchObject({ kind: "quota" });
  });

  it("counts a member holding a duplicate class id once, not as a swing slot", () => {
    const members = [member("dupe", ["healer", "healer"])];
    const summary = summarise(members);

    const groups = groupMembersByClassQuota(summary, members);

    expect(summary.flexible).toBe(0);
    expect(groups.map((group) => (group.kind === "quota" ? group.slot.key : group.kind)))
      .toEqual(["healer", "tank"]);
    expect(groups[0]!.members.map((entry) => entry.user.id)).toEqual(["dupe"]);
  });
});
