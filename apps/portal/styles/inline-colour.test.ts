import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const portalRoot = resolve(repoRoot, "apps/portal");

/** 内联样式里禁止出现的颜色属性。布局属性不在此列，它们留在内联是合理的。 */
const COLOUR_PROPS = /\b(color|background|backgroundColor|backgroundImage|borderColor|border|borderTop|borderBottom|borderLeft|borderRight|outlineColor|fill|stroke|boxShadow)\s*:/;

function listTsx(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "dist" || entry === "node_modules") continue;
      out.push(...listTsx(full));
      continue;
    }
    if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

/** 抽出每个 style={{ … }} 的内容。嵌套一层大括号足够覆盖实际写法。 */
function inlineStyleBlocks(source: string): string[] {
  return [...source.matchAll(/style=\{\{([^{}]|\{[^{}]*\})*\}\}/g)].map((m) => m[0]);
}

describe("inline styles carry no colour", () => {
  it("finds colour props in a sample block", () => {
    expect(COLOUR_PROPS.test('style={{ color: "#fff" }}')).toBe(true);
    expect(COLOUR_PROPS.test('style={{ gap: 8, width: "100%" }}')).toBe(false);
  });

  /* Task 8 批 C 已把批 B/C 的迁移工单全部处理完，取消 skip。跳过前跑出的
   * 完整清单（27 文件 / 63 处）见 task-8-report.md 的「A 批」一节。 */
  it("keeps colour out of every inline style in the portal", () => {
    const offenders: string[] = [];
    for (const file of listTsx(portalRoot)) {
      for (const block of inlineStyleBlocks(readFileSync(file, "utf8"))) {
        if (COLOUR_PROPS.test(block)) {
          offenders.push(`${relative(repoRoot, file).replace(/\\/g, "/")}: ${block.slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* ── .tsx 里不许出现裸 hex（task-8-addendum.md C 节） ──────────────────── */

/**
 * 把已经被上面那条断言管辖的 style={{ … }} 内容整段挖掉，剩下的裸 hex 才计入
 * 这条断言——两条断言的工单因此不重叠：同一处 hex 不会同时出现在两份清单里。
 */
function stripInlineStyleBlocks(source: string): string {
  return source.replace(/style=\{\{([^{}]|\{[^{}]*\})*\}\}/g, "");
}

/** style={{}} 之外的裸 hex。 */
const BARE_HEX = /#[0-9a-fA-F]{3,8}\b/g;

type BareHexExemption = {
  /** 定位这段值出处的常量名，或者（没有具名常量时）能唯一识别调用点的源码标记。 */
  source: string;
  /** 为什么它是数据而不是主题：这个值最终存到哪、被谁读。 */
  reason: string;
  /** 这个出处贡献的具体 hex 字面量（原始大小写，逐一列出，不用前缀匹配）。 */
  values: string[];
};

/**
 * rule 2 豁免表（task-8-addendum.md B 节类 1 / C 节）。这里的每一条都是用户在
 * 界面上点选出来的颜色数据，选中后要么被存进数据库（角色色、徽章色），要么被
 * 写进富文本 HTML 或工具页生成的 HTML 片段（文字色、高亮色、沙盒预览）。换成
 * var(--accent-fill) 之类的 token 后，这个字面值在别的模式/别的主色下会解析
 * 成完全不同的颜色，甚至在没有 CSS 变量上下文的落库/落文档场景里根本解析
 * 不出来——这是数据损坏，不是重构，一处都不许碰（同 theme-tokens.test.ts 的
 * RUNTIME_INJECTED_VARS 豁免表风格：每条都写清楚为什么它例外）。
 *
 * 豁免粒度按「文件 + 该文件内已核实过的具体 hex 值」授予，不是整文件豁免——
 * 整文件豁免太粗，日后这个文件如果混入类 2/3/4 的裸 hex 也会被放过；也不是按
 * 行号豁免——行号会漂。之所以不能再往下收紧到纯「按常量名」（本节以下每条的
 * `source` 字段本该是那个粒度），是因为 TitleSandboxModal.tsx 的取色器初值不是一个具
 * 名常量，而批 A 的范围只许新建这一个测试文件、不许改 .tsx 去给它起名字。
 * 已经在 task-8-report.md 的「A 批」一节按文件逐处核实过：下面五个文件里，
 * style={{}} 之外的裸 hex 清一色只有这些列出的值，没有混入其它类别——所以
 * 「文件 + 值」这个粒度在当前代码状态下等价于「按常量名」。批 B/C 如果在这些
 * 文件里新增裸 hex，这条豁免表不会自动放行，会照样报红，需要显式决定要不要
 * 扩表。
 */
const BARE_HEX_EXEMPTIONS: Record<string, BareHexExemption[]> = {
  "apps/portal/components/shared/TipTapEditorToolbar.tsx": [
    {
      source: "TEXT_COLORS",
      reason: "工具栏文字色板：editor.chain().focus().setColor(nextColor) 把选中值写进 TipTap 文档的 mark 属性，随文档一起落库为富文本 HTML。",
      values: ["#1f6feb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#ec4899", "#0891b2", "#334155"],
    },
    {
      source: "HIGHLIGHT_COLORS",
      reason: "工具栏高亮色板：editor.chain().focus().setHighlight({ color }) 同样写进 TipTap 文档 mark，落库为富文本 HTML。",
      values: ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecdd3", "#e9d5ff", "#fed7aa"],
    },
  ],
  "apps/portal/components/shared/TipTapEditorContextMenu.tsx": [
    {
      source: "TEXT_COLORS（与 TipTapEditorToolbar.tsx 重复的一份，右键菜单专用）",
      reason: "同上：写进 TipTap 文档 mark，落库为富文本 HTML。",
      values: ["#1f6feb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#ec4899", "#0891b2", "#334155"],
    },
    {
      source: "HIGHLIGHT_COLORS（与 TipTapEditorToolbar.tsx 重复的一份）",
      reason: "同上：写进 TipTap 文档 mark，落库为富文本 HTML。",
      values: ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecdd3", "#e9d5ff", "#fed7aa"],
    },
  ],
  "apps/portal/components/feature/tools/TitleSandboxModal.tsx": [
    {
      source: "PRESET_COLORS",
      reason: "沙盒工具的文字色预设：选中值经 rgbaColor 拼进生成的 HTML 片段（`color: rgba(...)`），用户复制这段 HTML 到站外使用，不是站内主题。",
      values: ["#1f6feb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#ec4899", "#0891b2", "#334155"],
    },
    {
      source: "useState(\"#1f6feb\")（取色器 color 状态的初值，与 PRESET_COLORS[0] 同值）",
      reason: "同上：是同一个沙盒文字色状态的初值，最终同样拼进生成的 HTML 片段。",
      values: ["#1f6feb"],
    },
  ],
  "apps/portal/components/feature/admin/AdminBadgesSection.tsx": [
    {
      source: "COLOR_PRESETS",
      reason: "徽章颜色预设：选中值写进 BadgeForm.color，经 controller 提交后落库为 MemberBadge.color。",
      values: ["#D4A843", "#ef4444", "#22c55e", "#f59e0b", "#8B7355", "#ec4899", "#C17F3E", "#f97316"],
    },
  ],
  "apps/portal/components/feature/admin/AdminRolesSection.tsx": [
    {
      source: "CSS_COLOR_TO_HEX",
      reason: "把历史上存进 AdminRole.color 的具名 CSS 颜色（如 \"blue\"）规整成 hex 供 <ColorInput> 回显，属于已落库数据的显示层适配，不是主题色。",
      values: ["#ef4444", "#D4A843", "#64748b", "#22c55e", "#f97316", "#eab308", "#14b8a6", "#a855f7", "#ec4899", "#6366f1"],
    },
    {
      source: "<ColorInput> 的 swatches（与 CSS_COLOR_TO_HEX 同一批值）",
      reason: "角色颜色选择器的色板：选中值写进 AdminRole.color，随角色一起落库。",
      values: ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#D4A843", "#6366f1", "#a855f7", "#ec4899", "#64748b"],
    },
  ],
};

/** 展开豁免表，得到「文件 → 允许出现的 hex 字面量列表（含重复次数）」。 */
function exemptedValues(repoPath: string): string[] {
  const entries = BARE_HEX_EXEMPTIONS[repoPath];
  if (!entries) return [];
  return entries.flatMap((entry) => entry.values);
}

/**
 * 找出一个文件里 style={{}} 之外、豁免表也没覆盖到的裸 hex。
 * 豁免按「值出现的次数」逐个消耗，而不是简单 filter：豁免表允许的是「这些值
 * 各出现这么多次」，如果同一个值在文件里意外多冒出一次，那多出来的一次不该
 * 被放过。
 */
function bareHexOffenders(repoPath: string, source: string): string[] {
  const withoutStyles = stripInlineStyleBlocks(source);
  const hits = withoutStyles.match(BARE_HEX) ?? [];
  const remainingAllowance = new Map<string, number>();
  for (const value of exemptedValues(repoPath)) {
    remainingAllowance.set(value, (remainingAllowance.get(value) ?? 0) + 1);
  }
  const offenders: string[] = [];
  for (const hex of hits) {
    const allowance = remainingAllowance.get(hex) ?? 0;
    if (allowance > 0) {
      remainingAllowance.set(hex, allowance - 1);
    } else {
      offenders.push(hex);
    }
  }
  return offenders;
}

describe(".tsx carries no bare hex outside the class-1 exemption table", () => {
  it("flags a bare hex literal outside style={{}}, ignores one inside style={{}} and one in the exemption table", () => {
    expect(bareHexOffenders("some/file.tsx", 'const x = "#123456";')).toEqual(["#123456"]);
    expect(bareHexOffenders("some/file.tsx", 'style={{ color: "#123456" }}')).toEqual([]);
    expect(
      bareHexOffenders(
        "apps/portal/components/feature/tools/TitleSandboxModal.tsx",
        'const PRESET_COLORS = ["#1f6feb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#ec4899", "#0891b2", "#334155"];',
      ),
    ).toEqual([]);
  });

  /* Task 8 批 C 已把类 2/3/4 的裸 hex 全部迁完，取消 skip。跳过前跑出的
   * 完整清单（18 文件 / 103 处，按类 1–4 归类）见 task-8-report.md 的
   * 「A 批」一节。 */
  it("no bare hex outside the class-1 exemption table", () => {
    const offenders: string[] = [];
    for (const file of listTsx(portalRoot)) {
      const repoPath = relative(repoRoot, file).replace(/\\/g, "/");
      const hits = bareHexOffenders(repoPath, readFileSync(file, "utf8"));
      if (hits.length > 0) offenders.push(`${repoPath}: ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});

/* ── .tsx 内联间距也必须走 token 或显式豁免（Task 1 / D5） ───────── */

const INLINE_SPACING_PROPS = [
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "paddingInline",
  "paddingBlock",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "marginInline",
  "marginBlock",
  "gap",
  "rowGap",
  "columnGap",
] as const;

/**
 * 现存的运行期几何例外按「文件 + property:value + 次数」登记。与裸 hex 表一样，
 * 每条 allowance 只消费一次；同文件后来再多写一处相同字面量仍会报错。
 */
const INLINE_SPACING_EXEMPTIONS: Record<string, string[]> = {
  /* 2px/4px optical icon alignment is intentionally below the 4px spacing tier. */
  "apps/portal/components/dashboard/LastWarCard.tsx": ["marginBottom:2"],
  "apps/portal/components/dashboard/MySignupsCard.tsx": ["marginTop:2"],
  "apps/portal/components/feature/admin/AdminApiDebugConsole.tsx": ["marginTop:2", "marginTop:2"],
  "apps/portal/components/feature/admin/AdminRolesSection.tsx": ["marginTop:2"],
  "apps/portal/components/feature/admin/AdminSiteConfigSection.tsx": ["marginTop:2"],
  "apps/portal/components/feature/admin/AdminSystemSection.tsx": ["marginTop:2", "marginTop:2"],
  "apps/portal/components/feature/announcements/AnnouncementListCard.tsx": ["marginTop:2"],
  "apps/portal/components/feature/events/EventCard.tsx": ["marginTop:2"],
  "apps/portal/components/feature/events/EventDetailModal.tsx": ["marginRight:4", "marginRight:4", "marginRight:4"],
  "apps/portal/components/feature/events/EventMonthView.tsx": ["marginTop:2"],
  "apps/portal/components/feature/events/RecurringTemplatesTab.tsx": ["marginTop:2", "marginTop:2"],
  "apps/portal/components/feature/gallery/GalleryFiltersCard.tsx": ["marginTop:2"],
  "apps/portal/components/feature/guild-war/GuildWarAnalyticsChartPanel.tsx": ["marginTop:2"],
  "apps/portal/components/feature/guild-war/GuildWarAnalyticsTab.tsx": ["marginTop:2"],
  "apps/portal/components/feature/guild-war/GuildWarDragBoardSections.tsx": ["marginTop:2"],
  "apps/portal/components/feature/guild-war/WarHistoryTable.tsx": ["marginTop:2"],
  "apps/portal/components/feature/wiki/WikiArticleListCard.tsx": ["marginTop:2", "marginTop:2"],
  "apps/portal/components/layout/NotificationPopover.tsx": ["marginTop:2"],
  "apps/portal/hooks/guild-war/useWarHistoryTabController.tsx": ["marginTop:2", "marginTop:2"],

  /* Local compound-layout geometry that cannot be replaced by one global token. */
  "apps/portal/components/feature/admin/AdminStatusTab.tsx": ["gap:6"],
  "apps/portal/components/feature/profile/ProfileProfileTab.tsx": ["gap:2", "marginTop:6"],
  "apps/portal/components/shared/AvailabilityGridEditor.tsx": ["paddingRight:6", "paddingTop:2"],
  "apps/portal/components/shared/ImageGridEditor.tsx": ["padding:0", "margin:0"],
  "apps/portal/components/shared/InfiniTable.tsx": ["marginLeft:4", "gap:4"],

  /* These render before the themed app/CSS is available, so CSS variables are unsafe. */
  "apps/portal/main.tsx": ["margin:0", "marginTop:8", "marginBottom:0"],
  "apps/portal/router.tsx": ["gap:12", "padding:24", "gap:12", "padding:24"],
};

function inlineSpacingOffenders(repoPath: string, source: string): string[] {
  const propertyPattern = INLINE_SPACING_PROPS.join("|");
  const pattern = new RegExp(`\\b(${propertyPattern})\\s*:\\s*(\\d+(?:\\.\\d+)?)\\b`, "g");
  const allowances = new Map<string, number>();
  for (const value of INLINE_SPACING_EXEMPTIONS[repoPath] ?? []) {
    allowances.set(value, (allowances.get(value) ?? 0) + 1);
  }

  const offenders: string[] = [];
  for (const block of inlineStyleBlocks(source)) {
    for (const match of block.matchAll(pattern)) {
      const value = `${match[1]}:${match[2]}`;
      const remaining = allowances.get(value) ?? 0;
      if (remaining > 0) allowances.set(value, remaining - 1);
      else offenders.push(value);
    }
  }
  return offenders;
}

describe(".tsx inline spacing uses tokens or the counted exemption table", () => {
  it("flags a literal, ignores a dynamic value, and consumes exemptions by count", () => {
    expect(inlineSpacingOffenders("sample.tsx", "style={{ gap: 8, padding: spacing }}")).toEqual(["gap:8"]);
  });

  it("has no unregistered inline spacing literals", () => {
    const offenders: string[] = [];
    for (const file of listTsx(portalRoot)) {
      const repoPath = relative(repoRoot, file).replace(/\\/g, "/");
      const hits = inlineSpacingOffenders(repoPath, readFileSync(file, "utf8"));
      if (hits.length > 0) offenders.push(`${repoPath}: ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
