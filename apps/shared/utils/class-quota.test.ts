import { describe, expect, it } from "vitest";
import { summariseClassQuotas } from "./class-quota";

function member(user_id: string, ...class_ids: string[]) {
  return { user_id, class_ids };
}

/** 只认一个职业的格子。格子的 key 直接借用职业 id，读起来跟旧用例一致。 */
function one(class_id: string, required: number) {
  return { key: class_id, class_ids: [class_id], required };
}

/** 认一组职业的格子，比如「治疗」同时收牵丝霖和破竹风。 */
function group(key: string, class_ids: string[], required: number) {
  return { key, class_ids, required };
}

describe("summariseClassQuotas", () => {
  it("returns an empty summary when no quotas are configured", () => {
    const summary = summariseClassQuotas([], [member("a", "tank"), member("b")]);
    expect(summary.slots).toEqual([]);
    expect(summary.requiredTotal).toBe(0);
    expect(summary.shortfall).toBe(0);
    expect(summary.flexible).toBe(0);
    // 没有配额时，所有人都算「不占任何格子」，而不是被悄悄算进某一格。
    expect(summary.unassigned).toEqual(["a", "b"]);
  });

  it("counts single-slot members as dedicated and multi-slot members as flexible", () => {
    const summary = summariseClassQuotas(
      [one("tank", 2), one("healer", 2)],
      [member("a", "tank"), member("b", "tank", "healer"), member("c", "bard")],
    );
    expect(summary.slots[0]).toMatchObject({ key: "tank", dedicated: 1, eligible: 2 });
    expect(summary.slots[1]).toMatchObject({ key: "healer", dedicated: 0, eligible: 1 });
    expect(summary.flexible).toBe(1);
    // bard 不在配额里，所以既不是专属也不是摇摆。
    expect(summary.unassigned).toEqual(["c"]);
  });

  it("marks a slot filled once its dedicated members reach the requirement", () => {
    const summary = summariseClassQuotas(
      [one("tank", 2)],
      [member("a", "tank"), member("b", "tank"), member("c", "tank")],
    );
    expect(summary.slots[0]?.status).toBe("filled");
    expect(summary.slots[0]?.dedicated).toBe(3);
    expect(summary.shortfall).toBe(0);
  });

  it("marks a slot flex when a swing member can cover it", () => {
    // 一个人同时挂坦克和治疗，两格各要一个：分配得开，缺口为 0。
    const summary = summariseClassQuotas(
      [one("tank", 1), one("healer", 1)],
      [member("a", "tank"), member("b", "tank", "healer")],
    );
    expect(summary.shortfall).toBe(0);
    expect(summary.slots[0]?.status).toBe("filled");
    expect(summary.slots[1]?.status).toBe("flex");
    // 专属数仍然是 0——摇摆位不属于任何一格。
    expect(summary.slots[1]?.dedicated).toBe(0);
    // 但分子看的是实际分配：b 被排进治疗，这一格显示 1 而不是 0。
    expect(summary.slots[1]?.matched).toBe(1);
    expect(summary.slots[1]?.member_ids).toEqual(["b"]);
  });

  it("marks the contested group short when the same people cannot cover both slots", () => {
    // 两格各要一个，却只有一个人能上——最大匹配只有 1，缺口 1。
    const summary = summariseClassQuotas(
      [one("tank", 1), one("healer", 1)],
      [member("a", "tank", "healer")],
    );
    expect(summary.matchedTotal).toBe(1);
    expect(summary.shortfall).toBe(1);
    expect(summary.slots.map((slot) => slot.status)).toEqual(["short", "short"]);
  });

  it("keeps a fully dedicated slot out of the short group", () => {
    // 坦克有两个专属，谁也抢不走；缺的是治疗那一格。
    const summary = summariseClassQuotas(
      [one("tank", 2), one("healer", 1)],
      [member("a", "tank"), member("b", "tank")],
    );
    expect(summary.shortfall).toBe(1);
    expect(summary.slots[0]?.status).toBe("filled");
    expect(summary.slots[1]?.status).toBe("short");
  });

  it("resolves a chain where a swing member must be displaced", () => {
    /*
     * a 只能打坦克，b 坦克/治疗，c 治疗/输出，输出需要一个但没人只会输出。
     * 贪心地让 b 占坦克、c 占治疗就会漏掉输出；正确的分配是 a→坦克、b→治疗、
     * c→输出，三格全满。
     */
    const summary = summariseClassQuotas(
      [one("tank", 1), one("healer", 1), one("dps", 1)],
      [member("a", "tank"), member("b", "tank", "healer"), member("c", "healer", "dps")],
    );
    expect(summary.matchedTotal).toBe(3);
    expect(summary.shortfall).toBe(0);
    expect(summary.slots.every((slot) => slot.status !== "short")).toBe(true);
  });

  it("ignores duplicate keys and non-positive requirements", () => {
    const summary = summariseClassQuotas(
      [one("tank", 1), one("tank", 5), one("healer", 0)],
      [member("a", "tank")],
    );
    expect(summary.slots).toHaveLength(1);
    expect(summary.slots[0]).toMatchObject({ key: "tank", required: 1, status: "filled" });
  });

  it("counts a member holding the same class twice only once", () => {
    const summary = summariseClassQuotas([one("tank", 2)], [member("a", "tank", "tank")]);
    expect(summary.slots[0]?.eligible).toBe(1);
    expect(summary.slots[0]?.dedicated).toBe(1);
    expect(summary.shortfall).toBe(1);
  });

  it("treats every class in a group as covering that one slot", () => {
    /*
     * 「需要 2 个治疗，牵丝霖和破竹风都行」。两个人各挂一个职业，谁也不摇摆——
     * 他们只够格进治疗这一格，所以都算专属，这一格配齐。
     */
    const summary = summariseClassQuotas(
      [group("healer", ["牵丝霖", "破竹风"], 2)],
      [member("a", "牵丝霖"), member("b", "破竹风")],
    );
    expect(summary.slots[0]).toMatchObject({ dedicated: 2, eligible: 2, matched: 2, status: "filled" });
    expect(summary.shortfall).toBe(0);
    expect(summary.flexible).toBe(0);
  });

  it("makes a single-class member flexible when overlapping groups both accept the class", () => {
    /*
     * 标签之间允许任意重叠：破竹风既在治疗组也在输出组。只挂破竹风的人因此同时
     * 够格进两格——虽然他只有一个职业，算的仍然是摇摆位。这是标签化之后最反直觉
     * 的一点，用例把它钉住。
     */
    const summary = summariseClassQuotas(
      [group("healer", ["牵丝霖", "破竹风"], 1), group("dps", ["破竹风", "鸣金虹"], 1)],
      [member("a", "破竹风"), member("b", "鸣金虹")],
    );
    expect(summary.flexible).toBe(1);
    expect(summary.slots[0]?.dedicated).toBe(0);
    // 专属为 0，但两格实际都排上了人，缺口为 0——分子必须显示 1 而不是 0。
    expect(summary.shortfall).toBe(0);
    expect(summary.slots.map((slot) => slot.matched)).toEqual([1, 1]);
  });

  it("keeps an empty group permanently short", () => {
    // 空标签谁也收不进来，这一格必须一路红到底，不能被当成「没配过」悄悄跳过。
    const summary = summariseClassQuotas(
      [group("healer", [], 2)],
      [member("a", "牵丝霖"), member("b", "破竹风")],
    );
    expect(summary.slots).toHaveLength(1);
    expect(summary.slots[0]).toMatchObject({ matched: 0, eligible: 0, status: "short" });
    expect(summary.shortfall).toBe(2);
    expect(summary.unassigned).toEqual(["a", "b"]);
  });

  it("benches eligible members once every slot they fit is full", () => {
    // 三个人都只够格进治疗，但那一格只要 2 个：第三个人既不是无配额，也没排上。
    const summary = summariseClassQuotas(
      [group("healer", ["牵丝霖", "破竹风"], 2)],
      [member("a", "牵丝霖"), member("b", "破竹风"), member("c", "牵丝霖")],
    );
    expect(summary.slots[0]?.member_ids).toEqual(["a", "b"]);
    expect(summary.benched).toEqual(["c"]);
    expect(summary.unassigned).toEqual([]);
    expect(summary.shortfall).toBe(0);
  });
});
