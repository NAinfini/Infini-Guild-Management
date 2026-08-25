// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveGuildWarAbsenceWindow } from "./GuildWarActiveTab";

function guildWarStylesheet(): string {
  return readFileSync(resolve(process.cwd(), "apps/portal/components/pages/GuildWarPage.css"), "utf8");
}

/** 按整条选择器建索引，而不是子串匹配：同一个类名会同时出现在自己的规则和共同声明里。 */
function cssRules(source: string): Map<string, string> {
  const rules = new Map<string, string>();
  for (const [, selector, body] of source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.set((selector ?? "").trim().replace(/\s+/g, " "), body ?? "");
  }
  return rules;
}

describe("resolveGuildWarAbsenceWindow", () => {
  it("waits for the selected event date instead of falling back to today", () => {
    expect(resolveGuildWarAbsenceWindow(undefined)).toBeNull();
    expect(resolveGuildWarAbsenceWindow(null)).toBeNull();
  });

  it("queries absences for the selected event day", () => {
    expect(resolveGuildWarAbsenceWindow("2026-08-14T20:00:00.000Z")).toEqual({
      from: "2026-08-14",
      to: "2026-08-14",
    });
  });

  it("sizes the roster to its headcount and keeps rows on the plate they sit on", () => {
    const styles = guildWarStylesheet();
    const rules = cssRules(styles);
    const rowRule = rules.get(".guild-war-member-card") ?? "";
    const headRule = rules.get(".guild-war-column-head") ?? "";
    const rowTokenRule = rules.get(".guild-war-column-head, .guild-war-member-card") ?? "";

    // 名册高度跟着人数走。写死的「5 行 × 64px」会让四个人的队伍下面空掉半张卡，
    // 而人满时又要在卡内再滚一层。
    expect(styles).not.toContain("--guild-war-member-visible-rows");
    expect(rowRule).not.toMatch(/^\s*block-size:/m);
    expect(rowRule).toContain("min-block-size: var(--guild-war-row-height)");

    // 栅格和行高声明必须挂在用它的元素自己身上。挂到外层卡上时，被 DragOverlay 传送到
    // body 底下的拖拽影子继承不到，grid-template-columns 整条作废，格子退回一列竖着摞。
    expect(rowTokenRule).toContain("--guild-war-row-columns:");
    expect(rowTokenRule).toContain("--guild-war-row-height: 44px");

    // 列头与行共用一套栅格，标签才会正好压在它标注的那一格上。
    expect(rowRule).toContain("grid-template-columns: var(--guild-war-row-columns)");
    expect(headRule).toContain("grid-template-columns: var(--guild-war-row-columns)");

    // 行长在它所在的板子上：自带底色就等于比板子低一级，看上去像板子上挖出来的槽。
    expect(rowRule).toContain("background: transparent");
  });

  it("hands the remaining height down to the board and keeps one scroller in the teams group", () => {
    const styles = guildWarStylesheet();
    // 只看断点之外那一段：窄屏那几条会重写同名选择器，混在一起读出来的是手机上的值。
    const rules = cssRules(styles.slice(0, styles.indexOf("@media")));

    // 剩余高度靠一条不断的链子往下传。中间任何一环漏掉 min-block-size: 0，flex 项会退回
    // 自动最小尺寸，链子断在那儿，作战板缩回内容高度，页面反倒多出一根滚动条。
    const fillChain = [
      rules.get(".guild-war-active-shell, .guild-war-desktop-flow") ?? "",
      rules.get(".guild-war-dnd-split") ?? "",
    ];
    for (const rule of fillChain) {
      expect(rule).toContain("flex: 1 1 auto");
      expect(rule).toContain("min-block-size: 0");
    }
    expect(rules.get(".guild-war-dnd-split")).toContain("grid-template-rows: minmax(0, 1fr)");

    // 队伍区整组滚，滚动条只有外面这一根：队伍卡里再滚一层就成了滚动条套滚动条。
    expect(rules.get(".guild-war-dnd-teams-wrap")).toContain("overflow-y: auto");
    expect(rules.get(".guild-war-dnd-teams .guild-war-column-stack")).toContain("overflow-y: visible");

    // 候补池不进那个滚动组：拖拽的来源要一直在眼前，这才是把高度撑满的意义。
    expect(rules.get(".guild-war-dnd-pool .guild-war-column-stack")).toContain("flex: 1 1 auto");

    // 撑满高度的名册要把行钉在顶上。网格默认把自动行拉开填满容器，池子里只剩一个人时
    // 那一行会被抻成整块高度：职业色条从头拉到尾，名字浮在正中间。
    expect(rules.get(".guild-war-column-stack")).toContain("align-content: start");
  });

  it("hands the tablet single-column flow back to the shared page workspace", () => {
    const styles = guildWarStylesheet();

    expect(styles).toMatch(
      /@media \(min-width: 768px\) and \(max-width: 991px\)[\s\S]*?\.page-layout\.guild-war-page\[data-workspace-mode="contained"\] \.page-layout__workspace\s*\{[\s\S]*?display:\s*block[\s\S]*?overflow-y:\s*auto/,
    );
  });
});
