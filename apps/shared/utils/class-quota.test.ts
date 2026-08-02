import { describe, expect, it } from "vitest";
import { summariseClassQuotas } from "./class-quota";

function member(user_id: string, ...class_ids: string[]) {
  return { user_id, class_ids };
}

describe("summariseClassQuotas", () => {
  it("returns an empty summary when no quotas are configured", () => {
    const summary = summariseClassQuotas([], [member("a", "tank"), member("b")]);
    expect(summary.slots).toEqual([]);
    expect(summary.requiredTotal).toBe(0);
    expect(summary.shortfall).toBe(0);
    expect(summary.flexible).toBe(0);
    // 没有配额时，所有人都算「不占任何格子」，而不是被悄悄算进某一格。
    expect(summary.unassigned).toBe(2);
  });

  it("counts single-class members as dedicated and multi-class members as flexible", () => {
    const summary = summariseClassQuotas(
      [{ class_id: "tank", required: 2 }, { class_id: "healer", required: 2 }],
      [member("a", "tank"), member("b", "tank", "healer"), member("c", "bard")],
    );
    expect(summary.slots[0]).toMatchObject({ class_id: "tank", dedicated: 1, eligible: 2 });
    expect(summary.slots[1]).toMatchObject({ class_id: "healer", dedicated: 0, eligible: 1 });
    expect(summary.flexible).toBe(1);
    // bard 不在配额里，所以既不是专属也不是摇摆。
    expect(summary.unassigned).toBe(1);
  });

  it("marks a class filled once its dedicated members reach the requirement", () => {
    const summary = summariseClassQuotas(
      [{ class_id: "tank", required: 2 }],
      [member("a", "tank"), member("b", "tank"), member("c", "tank")],
    );
    expect(summary.slots[0]?.status).toBe("filled");
    expect(summary.slots[0]?.dedicated).toBe(3);
    expect(summary.shortfall).toBe(0);
  });

  it("marks a class flex when a swing member can cover it", () => {
    // 一个人同时挂坦克和治疗，两格各要一个：分配得开，缺口为 0。
    const summary = summariseClassQuotas(
      [{ class_id: "tank", required: 1 }, { class_id: "healer", required: 1 }],
      [member("a", "tank"), member("b", "tank", "healer")],
    );
    expect(summary.shortfall).toBe(0);
    expect(summary.slots[0]?.status).toBe("filled");
    expect(summary.slots[1]?.status).toBe("flex");
    // 摇摆位不算进任何一格的分子，否则四格相加会超过实到人数。
    expect(summary.slots[1]?.dedicated).toBe(0);
  });

  it("marks the contested group short when the same people cannot cover both classes", () => {
    // 两格各要一个，却只有一个人能上——最大匹配只有 1，缺口 1。
    const summary = summariseClassQuotas(
      [{ class_id: "tank", required: 1 }, { class_id: "healer", required: 1 }],
      [member("a", "tank", "healer")],
    );
    expect(summary.matchedTotal).toBe(1);
    expect(summary.shortfall).toBe(1);
    expect(summary.slots.map((slot) => slot.status)).toEqual(["short", "short"]);
  });

  it("keeps a fully dedicated class out of the short group", () => {
    // 坦克有两个专属，谁也抢不走；缺的是治疗那一格。
    const summary = summariseClassQuotas(
      [{ class_id: "tank", required: 2 }, { class_id: "healer", required: 1 }],
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
      [
        { class_id: "tank", required: 1 },
        { class_id: "healer", required: 1 },
        { class_id: "dps", required: 1 },
      ],
      [member("a", "tank"), member("b", "tank", "healer"), member("c", "healer", "dps")],
    );
    expect(summary.matchedTotal).toBe(3);
    expect(summary.shortfall).toBe(0);
    expect(summary.slots.every((slot) => slot.status !== "short")).toBe(true);
  });

  it("ignores duplicate and non-positive requirements", () => {
    const summary = summariseClassQuotas(
      [
        { class_id: "tank", required: 1 },
        { class_id: "tank", required: 5 },
        { class_id: "healer", required: 0 },
      ],
      [member("a", "tank")],
    );
    expect(summary.slots).toHaveLength(1);
    expect(summary.slots[0]).toMatchObject({ class_id: "tank", required: 1, status: "filled" });
  });

  it("counts a member holding the same class twice only once", () => {
    const summary = summariseClassQuotas(
      [{ class_id: "tank", required: 2 }],
      [member("a", "tank", "tank")],
    );
    expect(summary.slots[0]?.eligible).toBe(1);
    expect(summary.slots[0]?.dedicated).toBe(1);
    expect(summary.shortfall).toBe(1);
  });
});
