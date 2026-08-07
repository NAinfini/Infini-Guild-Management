import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { functionalColourHits, keywordColourHits } from "./colour-literal-detectors";

const repoRoot = process.cwd();
const portalRoot = resolve(repoRoot, "apps/portal");

/** Every portal stylesheet governed by the token-layer contract. */
const TOKENIZED_CSS_FILES: string[] = [
  "apps/portal/styles/tokens.css",
  "apps/portal/styles/semantic.css",
  "apps/portal/styles/scale.css",
  "apps/portal/styles.css",
  "apps/portal/providers/ThemeProvider.module.css",
  "apps/portal/components/layout/AppShell.css",
  "apps/portal/components/layout/CmdKSearch.module.css",
  "apps/portal/components/layout/NotificationPopover.module.css",
  "apps/portal/components/layout/PageLayout.css",
  "apps/portal/components/pages/GuildWarPage.css",
  "apps/portal/components/pages/StoragePage.css",
  "apps/portal/components/pages/AuthPages.css",
  "apps/portal/components/pages/AdminPage.css",
  "apps/portal/components/pages/DashboardPage.css",
  "apps/portal/components/pages/ToolsPage.css",
  "apps/portal/components/pages/AnnouncementsPage.css",
  "apps/portal/components/pages/EventsPage.css",
  "apps/portal/components/pages/GalleryPage.css",
  "apps/portal/components/pages/MyProfilePage.css",
  "apps/portal/components/pages/RosterPage.css",
  "apps/portal/components/pages/SettingsPage.css",
  "apps/portal/components/pages/WikiPage.css",
  "apps/portal/components/feature/admin/AdminApiTest.css",
  "apps/portal/components/shared/tiptap-editor.css",
  "apps/portal/components/feature/events/RecurringTemplateFormModal.css",
  "apps/portal/components/feature/events/EventCardsView.css",
  "apps/portal/components/feature/admin/AuditLogViewer.css",
  "apps/portal/components/feature/events/EventDetailModal.css",
  "apps/portal/components/feature/admin/AdminSystemSection.css",
  "apps/portal/components/shared/MemberCard.css",
  "apps/portal/components/feature/admin/AdminBadgesSection.css",
  "apps/portal/components/feature/admin/AdminClassesSection.css",
  "apps/portal/components/shared/media-gallery.css",
  "apps/portal/components/feature/events/EventMonthView.css",
  "apps/portal/components/shared/ProfileModal.module.css",
  "apps/portal/components/feature/admin/AdminMemberDetailModal.module.css",
  /* Shared controls consume only L2/L3 variables. */
  "apps/portal/components/shared/SectionHeader.css",
  "apps/portal/components/shared/TitleField.css",
  "apps/portal/components/shared/NativeDateTimeInput.css",
  "apps/portal/components/shared/ContentFilterToolbar.css",
  "apps/portal/components/shared/ClassIcon.css",
  "apps/portal/components/shared/ImageGridEditor.css",
  /* 行内样式片段编辑器（称号与徽章标签共用）。样式当初随组件从 ToolsPage.css
     拆出来时是原样搬运，没有引入新的字面值。 */
  "apps/portal/components/shared/LabelStyleModal.css",
  /* 后台状态页签的外壳（Batch 4）。从建立起就只用 L2/L3 变量：
     卡片走 --surface-base / --border-subtle / --radius-surface，
     把手走 --text-secondary / --brand-text / --transition-normal。 */
  "apps/portal/components/feature/admin/AdminStatusTab.css",
  /* 职业配额条只有一个填充色相（活动域色），超员时转危险色，够员靠计数变成功色；
     全部使用语义 token。 */
  "apps/portal/components/feature/events/EventQuotaBar.css",
  "apps/portal/components/feature/events/ClassQuotaEditor.css",
  "apps/portal/components/feature/events/EventFormModal.css",
  /* 叠放头像组，活动卡和仪表盘活动条共用。走 --surface-raised / --text-primary。 */
  "apps/portal/components/shared/MemberAvatarStack.css",
  /* 后台职业标签页的编辑器内部。选中态与 AdminClassesSection.css 的图标格同一套
     --brand-fill / --surface-raised 写法。 */
  "apps/portal/components/feature/admin/AdminClassTagsSection.css",
  /* 勾选清单的共用外观。行与分隔线是从 AdminBadgesSection.css 和
     AdminClassTagsSection.css 搬过来的，用的还是那两处的 --surface-* / --border-*；
     选中态那条色条走 --brand-fill。 */
  "apps/portal/components/shared/PickList.css",
  /* 成员概览条，资料页与后台成员详情共用。样式从 MyProfilePage.css 原样搬来，
     用的还是那里的 --surface-* / --status-* / --overview-accent。 */
  "apps/portal/components/shared/ProfileOverviewCard.css",
];

/** 唯一允许出现 hex 的文件。 */
const PALETTE_FILE = "apps/portal/styles/tokens.css";
/** L2 语义层：所有 --accent-* / --text-* 的分模式、分主色定义处。 */
const SEMANTIC_FILE = "apps/portal/styles/semantic.css";
/** L3 标度层：尺寸标度，不表达颜色语义，但同样是「token 文件」本身，
 * 不是组件层，豁免 rule 6。 */
const SCALE_FILE = "apps/portal/styles/scale.css";
/** 全局样式入口；Mantine 主题桥接位于 ThemeProvider。 */
const ENTRY_FILE = "apps/portal/styles.css";
const THEME_PROVIDER_FILE = "apps/portal/providers/ThemeProvider.tsx";
const PORTAL_HTML_FILE = "apps/portal/index.html";
const ACCENT_CONSUMER_ALLOWLIST = new Set([
  SEMANTIC_FILE,
  "apps/portal/components/layout/AppShell.css",
  "apps/portal/components/pages/SettingsPage.css",
  "apps/portal/components/shared/MemberCard.css",
]);
const DISPLAY_FONT_FILES = [
  "apps/portal/public/fonts/saira-semi-condensed-latin-700.woff2",
  "apps/portal/public/fonts/saira-semi-condensed-latin-ext-700.woff2",
] as const;

/**
 * rule 5 豁免表。这里的每一条在源码里都没有 `^\s*--name\s*:` 形式的定义 ——
 * 它们的值是运行期由某处 JS/库写进 style 的。没有出处的名字不许进这张表。
 */
const RUNTIME_INJECTED_VARS: string[] = [
  /* Mantine AppShell 组件在运行期写入（@mantine/core 的
   * esm/components/AppShell/AppShellMediaStyles/assign-header-variables/
   * assign-header-variables.mjs:33-37，assignHeaderVariables()）。 */
  "--app-shell-header-offset",
  /* Mantine Alert 组件在运行期写入（@mantine/core 的
   * esm/components/Alert/Alert.mjs:35）。 */
  "--alert-color",
  /* PageLayout.tsx:82-87，PageLayout 组件在根元素 style 上内联注入。 */
  "--page-layout-cols-xs",
  "--page-layout-cols-sm",
  "--page-layout-cols-md",
  "--page-layout-cols-lg",
  "--page-layout-cols-xl",
  "--page-layout-grid-gap",
  /* GalleryGrid.tsx:114，每张卡片的 style 上内联注入，用来错开入场动画延迟。 */
  "--stagger-index",
  /* LastWarCard.tsx:138，结果徽章的 style 上内联注入。 */
  "--war-result-color",
  /* MantineProvider injects this outside the --mantine-color-* namespace. */
  "--mantine-font-family-monospace",
  /* MemberAvatarStack injects its constant size on the stack root. */
  "--member-avatar-stack-size",
  /* --badge-color：管理员自选的任意色号，运行期由 MemberCard.tsx:24 的
   * MemberBadge 在内联 style 上无条件写入（后台不再渲染药丸，标签的样子只在
   * LabelStyleModal 里）。消费值经 apps/shared/schemas/admin.ts 的 colorSchema
   * 校验（min(1)，保证非空）。 */
  "--badge-color",
  /* --class-color：管理员在职业目录中配置的任意十六进制色号。ClassIcon、
   * MemberCard 与职业管理预览都在同一元素上无条件注入该值。 */
  "--class-color",
  /* --swatch-color：色板/取色按钮各自的色号，来自 TipTapEditorToolbar.tsx /
   * TipTapEditorContextMenu.tsx 的 TEXT_COLORS / HIGHLIGHT_COLORS，
   * 以及 LabelStyleModal.tsx 的
   * recentColors（localStorage 持久化的用户历史取色，等同 class-1 数据），
   * 运行期由这些色板/色点按钮无条件内联写入。 */
  "--swatch-color",
  /* --signup-dot-color：MySignupsCard.tsx 按事件类型拼出的 Mantine 色号字符串
   * （`var(--mantine-color-X-5, var(--accent-fill))`，X 来自 eventTypeTagColor()），
   * 随事件类型变化，运行期由该文件的色点 span 无条件内联写入。 */
  "--signup-dot-color",
];
/** --mantine-color-* 系列由 Mantine 的 CSS 变量解析器批量写入运行期
 * （@mantine/core 的 MantineCssVariables），逐个列名不现实，按前缀豁免。 */
const MANTINE_COLOR_PREFIX = "--mantine-color-";

/* CSS and TSX literal-color scans share one detector implementation. */

type LiteralColourExemption = {
  /** 定位这条豁免对应的选择器/规则块，方便回查源码。 */
  source: string;
  /** 为什么这个字面量是与模式无关的固定值，而不是被漏迁的主题色。 */
  reason: string;
  /** 这个出处贡献的具体字面量，逐次出现都要列出（同一值出现几次就写几次）。 */
  values: string[];
};

/**
 * rule 2 豁免表。结构与 inline-colour.test.ts 的 BARE_HEX_EXEMPTIONS 一致：
 * 按文件索引，每条都写清楚
 * 选择器出处与理由，按值计次消耗，不是整文件豁免。
 *
 * 为什么豁免表在这里、而不是「找源码里挨着的说明注释」：rule 2 沿用现有的
 * 「先剥注释再扫」（这是为了不让 EventDetailModal.css 那种在注释里纯讲解历史
 * rgb() 数值的说明文字被误当成命中——剥注释前会先加进命中列表）。但先剥注释
 * 就意味着扫描函数看不到注释里写的豁免理由，没法用「附近有没有说明注释」当
 * 判据；所以豁免机制使用这张按文件+值索引的表，并要求每条都记录来源与理由。
 */
const LITERAL_COLOUR_EXEMPTIONS: Record<string, LiteralColourExemption[]> = {
  "apps/portal/components/feature/events/EventCardsView.css": [
    {
      source: ".event-card__raffle-winners-badge",
      reason: "徽章底色/文字已固定吃 --mantine-color-pink-5 / --mantine-color-white，不随 [data-theme] 变化，投影延续同一条设计决定保持固定，避免固定配色配一圈会变化的阴影。",
      values: ["rgba(0, 0, 0, 0.2)"],
    },
  ],
  "apps/portal/components/pages/GalleryPage.css": [
    {
      source: ".gallery-video-thumb 与其 :hover 变体（已有注释）",
      reason: "占位背景固定吃 Mantine 的 --mantine-color-dark-6，不随 [data-theme] 变化，图标色跟着保持固定白色透明度。",
      values: ["rgba(255, 255, 255, 0.55)", "rgba(255, 255, 255, 0.85)"],
    },
    {
      source: ".gallery-preview-uploader（已有注释）",
      reason: "上传者姓名条压在任意照片/视频帧之上，不是主题表面，文字固定白、底色固定黑（半透明，让照片透出来），才能在任意图片上保持可读。",
      values: ["rgb(255 255 255)", "black"],
    },
    {
      source: ".gallery-lb-overlay（已有注释）",
      reason: "全屏灯箱遮罩恒为近黑，与 [data-theme] 无关，是下面所有白色控件的固定背景基准。",
      values: ["rgba(0, 0, 0, 0.92)"],
    },
    {
      source: ".gallery-lb__close 与其 :hover（已有注释）",
      reason: "关闭按钮坐在上面固定近黑的遮罩上，不是主题表面，玻璃底色与图标色都保持固定白色透明度。",
      values: ["rgba(255, 255, 255, 0.1)", "rgba(255, 255, 255, 0.8)", "rgba(255, 255, 255, 0.2)", "rgb(255 255 255)"],
    },
    {
      source: ".gallery-lb__nav 与其 :hover（已有注释）",
      reason: "理由同 .gallery-lb__close：固定近黑遮罩上的固定白色玻璃控件。",
      values: ["rgba(255, 255, 255, 0.08)", "rgba(255, 255, 255, 0.7)", "rgba(255, 255, 255, 0.18)", "rgb(255 255 255)"],
    },
    {
      source: ".gallery-lb__caption / __uploader / __date / __count",
      reason: "灯箱信息条文字，与 .gallery-lb__close/.gallery-lb__nav 同一先例：遮罩恒为近黑，文字保持固定白色透明度而非表面/文字 token。次要三行（uploader/date/count）统一到同一档透明度。",
      values: ["rgba(255, 255, 255, 0.95)", "rgba(255, 255, 255, 0.72)", "rgba(255, 255, 255, 0.72)", "rgba(255, 255, 255, 0.72)"],
    },
  ],
  "apps/portal/components/shared/LabelStyleModal.css": [
    {
      source: ".sandbox__recent-dot",
      reason: "给下面任意色号的 --swatch-color 描一圈固定轮廓，理由同 --swatch-color 本身（用户数据色，不随主题变化）。",
      values: ["rgba(0, 0, 0, 0.1)"],
    },
  ],
  "apps/portal/components/shared/media-gallery.css": [
    {
      source: ".infini-media-gallery-native-video / .infini-media-gallery-thumb-video（已有注释）",
      reason: "视频播放器/缩略图的信箱底色传统上恒为黑色，与 [data-theme] 无关。",
      values: ["rgb(0 0 0)", "rgb(0 0 0)"],
    },
    {
      source: ".infini-media-gallery-thumb-play 的图标描边投影（已有注释）",
      reason: "播放图标固定用 Mantine 白，投影同理固定：给白色图标描一圈暗晕，保证压在任意亮度的缩略图上都看得清。",
      values: ["rgba(0,0,0,0.5)"],
    },
  ],
  "apps/portal/components/shared/tiptap-editor.css": [
    {
      source: ".infini-tiptap-link-dialog-backdrop（已有注释）",
      reason: "浮层对话框背后的全屏遮罩使用固定冷色调（slate-900，rgb(15, 23, 42)），深浅两模式都不反色。",
      values: ["rgba(15, 23, 42, 0.48)"],
    },
    {
      source: ".infini-tiptap-find-replace 的投影（已有注释，理由同上）",
      reason: "查找替换面板的投影，同一个冷色调（slate-900），不是纯黑，理由同 link-dialog。",
      values: ["rgba(15, 23, 42, 0.18)"],
    },
  ],
  "apps/portal/styles/semantic.css": [
    {
      source: "[data-theme=\"light\"] 块的 --edge-top / --shadow-overlay",
      reason: "浅色模式唯一两档层级：表面顶边与浮层投影。它们是模式语义 token 的固定中性色值。",
      values: [
        "rgb(255 255 255 / 0.90)",
        "rgb(10 10 15 / 0.06)",
        "rgb(10 10 15 / 0.18)",
      ],
    },
    {
      source: "[data-theme=\"dark\"] 块的 --edge-top / --shadow-overlay",
      reason: "深色模式对应的两档层级值。",
      values: [
        "rgb(255 255 255 / 0.06)",
        "rgb(0 0 0 / 0.20)",
        "rgb(0 0 0 / 0.42)",
      ],
    },
  ],
};

function exemptedLiteralValues(path: string): string[] {
  const entries = LITERAL_COLOUR_EXEMPTIONS[path];
  if (!entries) return [];
  return entries.flatMap((entry) => entry.values);
}

/**
 * 找出一个文件里剥掉注释之后、豁免表也没盖住的字面功能色/关键字色。
 * 豁免按「值出现的次数」逐个消耗（同 inline-colour.test.ts 的
 * bareHexOffenders），不是简单 filter：同一个值在文件里意外多冒出一次，
 * 那多出来的一次不该被放过。
 *
 * 光是「命中 ≤ 额度」还不够——那只防得住多出来的字面量，防不住
 * 豁免表本身失真的另一半：源码里那处站点被删掉/改值之后，表里对应的额度会
 * 静默留下一张没人用的免费票，日后随便一个新字面量凑巧撞上这个值就能白嫖
 * 通过。所以额度消耗完之后，剩下没被任何命中消耗掉的非零额度也要报错——
 * 用不同的文案前缀区分两类问题：「未登记的字面量」是命中没有豁免可用，
 * 「已失效的豁免」是豁免表登记的次数比源码实际出现的次数多。
 */
function literalColourOffenders(path: string, withoutComments: string): string[] {
  const hits = [...functionalColourHits(withoutComments), ...keywordColourHits(withoutComments)];
  const remainingAllowance = new Map<string, number>();
  for (const value of exemptedLiteralValues(path)) {
    remainingAllowance.set(value, (remainingAllowance.get(value) ?? 0) + 1);
  }
  const offenders: string[] = [];
  for (const hit of hits) {
    const allowance = remainingAllowance.get(hit) ?? 0;
    if (allowance > 0) {
      remainingAllowance.set(hit, allowance - 1);
    } else {
      offenders.push(`未登记的字面量 ${hit}`);
    }
  }
  for (const [value, count] of remainingAllowance) {
    if (count > 0) offenders.push(`已失效的豁免 ${value}（豁免表多登记了 ${count} 次，源码里已经没有这么多处）`);
  }
  return offenders;
}

export function listCssFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      if (entry === ".artifacts" || entry === "dist" || entry === "node_modules") continue;
      out.push(...listCssFiles(full));
      continue;
    }
    if (entry.endsWith(".css")) out.push(full);
  }
  return out;
}

function toRepoPath(absolute: string): string {
  return relative(repoRoot, absolute).replace(/\\/g, "/");
}

function readTokenizedCss(): Array<{ path: string; source: string }> {
  return TOKENIZED_CSS_FILES.map((path) => ({ path, source: readFileSync(resolve(repoRoot, path), "utf8") }));
}

export function bareButtonHeightOffenders(path: string, source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const offenders: string[] = [];

  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!.trim();
    const body = match[2]!;
    const targetsButton = /\bbutton\b|(?:^|[._-])(?:btn|button)(?:[_-]|$)|ActionIcon/i.test(selector);
    if (!targetsButton) continue;

    for (const height of body.matchAll(/(?:^|;)\s*height\s*:\s*(\d+(?:\.\d+)?)px\b/g)) {
      offenders.push(`${path}: ${selector} -> height: ${height[1]}px`);
    }
  }

  return offenders;
}

/* ── 硬规则 1–5 ───────────────────────────────────────────── */

describe("theme token hard rules", () => {
  it("rule 1: no var() fallback values", () => {
    const offenders: string[] = [];
    for (const { path, source } of readTokenizedCss()) {
      const hits = source.match(/var\(--[^,)]*,/g);
      if (hits) offenders.push(`${path}: ${hits.length} × ${hits[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  /* Literal exceptions are value-scoped so semantic.css remains fully scanned. */
  it("rule 2: no bare hex, literal colour function, or literal named colour outside the palette file", () => {
    const offenders: string[] = [];
    for (const { path, source } of readTokenizedCss()) {
      if (path === PALETTE_FILE) continue;
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");

      const hexHits = withoutComments.match(/#[0-9a-fA-F]{3,8}\b/g);
      if (hexHits) offenders.push(`${path}: ${[...new Set(hexHits)].join(", ")}`);

      const literalHits = literalColourOffenders(path, withoutComments);
      if (literalHits.length > 0) offenders.push(`${path}: ${literalHits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("rule 3: no !important outside prefers-reduced-motion overrides", () => {
    const offenders: string[] = [];
    for (const { path, source } of readTokenizedCss()) {
      /* 无障碍覆盖必须压过一切，是 !important 的正当用法。
       * 只挖掉 reduced-motion 块本身，块外的 !important 仍然报错。 */
      const outside = source.replace(
        /@media[^{]*prefers-reduced-motion[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,
        "",
      );
      const hits = outside.match(/!important/g);
      if (hits) offenders.push(`${path}: ${hits.length}`);
    }
    expect(offenders).toEqual([]);
  });

  it("rule 4: [data-theme] is the only mode signal", () => {
    const offenders: string[] = [];
    for (const { path, source } of readTokenizedCss()) {
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
      if (/(^|[\s,>+~(])\.dark\b/.test(withoutComments)) offenders.push(`${path}: .dark selector`);
      if (withoutComments.includes("data-mantine-color-scheme")) offenders.push(`${path}: data-mantine-color-scheme selector`);
    }
    expect(offenders).toEqual([]);
  });

  it("rule 5: every var() in tokenized CSS resolves to a definition", () => {
    const files = readTokenizedCss();

    /* Definitions may appear at line start or immediately after a block/statement delimiter. */
    const defined = new Set<string>();
    for (const { source } of files) {
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of withoutComments.matchAll(/(?:^|[{;])\s*(--[a-zA-Z0-9-]+)\s*:/gm)) {
        defined.add(match[1]!);
      }
    }

    const offenders: string[] = [];
    for (const { path, source } of files) {
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
      const used = new Set([...withoutComments.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map((match) => match[1]!));
      const missing = [...used].filter(
        (name) => !defined.has(name) && !RUNTIME_INJECTED_VARS.includes(name) && !name.startsWith(MANTINE_COLOR_PREFIX),
      );
      if (missing.length > 0) offenders.push(`${path}: ${missing.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("rule 6: component layer only consumes L2/L3 — no direct var(--palette-*) or var(--accent-<digit>)", () => {
    /* Rule 5 checks existence; this rule separately enforces layer ownership.
     *
     * 只拦纯数字档位的 --accent-<digit>（--accent-50/600/900 这类），不拦
     * --accent-fill / --accent-text / --accent-tint / --accent-on-fill /
     * --accent-on-fill-hover / --accent-border / --accent-fill-hover 这些
     * L2 语义名——它们名字里同样带 "accent"，但不是纯数字后缀。 */
    const offenders: string[] = [];
    for (const { path, source } of readTokenizedCss()) {
      if (path === PALETTE_FILE || path === SEMANTIC_FILE || path === SCALE_FILE || path === ENTRY_FILE) continue;
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
      const hits = [...withoutComments.matchAll(/var\((--[a-zA-Z0-9-]+)\)/g)]
        .map((match) => match[1]!)
        .filter((name) => name.startsWith("--palette-") || /^--accent-\d+$/.test(name));
      if (hits.length > 0) offenders.push(`${path}: ${[...new Set(hits)].join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("rule 7: personal accent tokens stay inside the approved identity surfaces", () => {
    const offenders = readTokenizedCss()
      .filter(({ path }) => !ACCENT_CONSUMER_ALLOWLIST.has(path))
      .filter(({ source }) => {
        const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
        return withoutComments.includes("var(--accent-");
      })
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});

describe("control sizing scale", () => {
  const scale = readFileSync(resolve(repoRoot, SCALE_FILE), "utf8");
  const themeStyles = readFileSync(
    resolve(repoRoot, "apps/portal/providers/ThemeProvider.module.css"),
    "utf8",
  );
  const tipTap = readFileSync(
    resolve(repoRoot, "apps/portal/components/shared/tiptap-editor.css"),
    "utf8",
  );

  it("defines compact, regular, large, icon, and 44px hit-area tokens", () => {
    expect(scale).toMatch(/--control-height-compact:\s*32px\b/);
    expect(scale).toMatch(/--control-height-regular:\s*36px\b/);
    expect(scale).toMatch(/--control-height-large:\s*52px\b/);
    expect(scale).toMatch(/--control-icon-size-compact:\s*22px\b/);
    expect(scale).toMatch(/--control-icon-size-regular:\s*28px\b/);
    expect(scale).toMatch(/--control-icon-size-large:\s*40px\b/);
    expect(scale).toMatch(/--control-hit-area:\s*44px\b/);
  });

  /*
   * regular 这一档在细指针下是 36px，靶面靠粗指针的整档回退补回来。这条回退
   * 一旦被顺手删掉，触屏上所有按钮、输入框和标签页会一起缩到 36px，而且不会
   * 有任何用例报警——36px 本身在 WCAG AA 里是合法的，坏掉的是 AAA 那一档，
   * 只有在真机上才摸得出来。所以它需要一条自己的断言，而不是一条注释。
   */
  it("restores the 44px touch target on coarse pointers", () => {
    const coarseBlock = scale.match(/@media \(pointer: coarse\)\s*\{[\s\S]*?\n\}/);
    expect(coarseBlock).not.toBeNull();
    expect(coarseBlock?.[0]).toMatch(/--control-height-regular:\s*44px\b/);
  });

  /*
   * 上面那条只问主指针。带触摸的 Windows 笔记本把触摸报成主指针，插着鼠标也一样，
   * 于是一台鼠标设备被整档判成触屏：输入框、按钮、页签各高 8px，累积起来把管理
   * 后台和公会战历史的工作区顶出视口，多出一条整页滚动条。细指针复位块负责把这
   * 类设备拉回 36px，它必须排在粗指针块之后（同为 :root，靠源序决胜），删掉或
   * 挪到前面都不会有别的用例报警。
   */
  it("falls back to the compact 36px control on any device that has a mouse", () => {
    const coarseAt = scale.search(/@media \(pointer: coarse\)/);
    const fineAt = scale.search(/@media \(any-pointer: fine\)/);
    expect(fineAt).toBeGreaterThan(-1);
    expect(fineAt).toBeGreaterThan(coarseAt);
    expect(scale.slice(fineAt).match(/@media \(any-pointer: fine\)\s*\{[\s\S]*?\n\}/)?.[0])
      .toMatch(/--control-height-regular:\s*36px\b/);
  });

  it("bridges Mantine Button, Input, ActionIcon, and Tabs onto the scale", () => {
    expect(themeStyles).toContain("--button-height-xs: var(--control-height-compact)");
    expect(themeStyles).toContain("--button-height-sm: var(--control-height-regular)");
    expect(themeStyles).toContain("--input-height-sm: var(--control-height-regular)");
    expect(themeStyles).toContain("--input-height-xs: var(--control-height-compact)");
    expect(themeStyles).toContain("--ai-size-input-xs: var(--control-height-compact)");
    expect(themeStyles).toContain("--ai-size-sm: var(--control-icon-size-compact)");
    expect(themeStyles).toContain("--ai-size-md: var(--control-icon-size-regular)");
    expect(themeStyles).toMatch(/\.tabsTab[\s\S]*?min-height:\s*var\(--control-height-regular\)/);
    expect(themeStyles).toMatch(/\.tabsTab[\s\S]*?padding-inline:\s*var\(--space-lg\)/);
  });

  it("uses a transparent pseudo-element for controls smaller than the hit-area token", () => {
    expect(themeStyles).toMatch(/\.actionIconRoot::before\s*\{[\s\S]*?width:\s*max\(var\(--control-hit-area\)/);
    expect(themeStyles).toMatch(/\.actionIconRoot::before\s*\{[\s\S]*?height:\s*max\(var\(--control-hit-area\)/);
    expect(themeStyles).toMatch(/\.actionIconRoot::before\s*\{[\s\S]*?background:\s*transparent/);
  });

  it("keeps the protected Roster audio control spacing", () => {
    const entry = readFileSync(resolve(repoRoot, ENTRY_FILE), "utf8");
    expect(entry).toMatch(
      /\.roster-audio-popover\.roster-audio-popover\s*\{[^}]*gap:\s*var\(--control-icon-size-compact\)/,
    );
    expect(tipTap).toMatch(
      /\.infini-tiptap-toolbar\s*\{[^}]*gap:\s*var\(--control-icon-size-compact\)/,
    );
    expect(tipTap).toMatch(
      /\.infini-tiptap-toolbar__group\s*\{[^}]*gap:\s*var\(--control-icon-size-compact\)/,
    );
  });

  it("flags bare pixel heights on button selectors", () => {
    expect(bareButtonHeightOffenders("sample.css", ".save-button { height: 38px; }")).toEqual([
      "sample.css: .save-button -> height: 38px",
    ]);
    expect(bareButtonHeightOffenders("sample.css", ".save-button { min-height: 38px; }")).toEqual([]);
    expect(bareButtonHeightOffenders("sample.css", ".status-dot { height: 8px; }")).toEqual([]);
  });

  it("component CSS has no bare pixel height applied to a button", () => {
    const offenders = listCssFiles(portalRoot).flatMap((file) => {
      const path = toRepoPath(file);
      return bareButtonHeightOffenders(path, readFileSync(file, "utf8"));
    });
    expect(offenders).toEqual([]);
  });
});

describe("Forged Material shape and elevation scale", () => {
  const scale = readFileSync(resolve(repoRoot, SCALE_FILE), "utf8");
  const semantic = readFileSync(resolve(repoRoot, SEMANTIC_FILE), "utf8");
  const provider = readFileSync(resolve(repoRoot, THEME_PROVIDER_FILE), "utf8");

  it("defines exactly three general radius tokens", () => {
    const definitions = [...scale.matchAll(/^\s*(--radius-[a-z0-9-]+):/gm)]
      .map((match) => match[1])
      .sort();

    expect(definitions).toEqual([
      "--radius-control",
      "--radius-overlay",
      "--radius-surface",
    ]);
  });

  it("defines exactly two generic elevation tokens in each theme", () => {
    const definitions = [...semantic.matchAll(/^\s*(--(?:edge|shadow)-[a-z0-9-]+):/gm)]
      .map((match) => match[1]);

    expect(definitions).toEqual([
      "--edge-top",
      "--shadow-overlay",
      "--edge-top",
      "--shadow-overlay",
    ]);
  });

  it("maps Mantine radii and shadows onto the shared scale", () => {
    expect(provider).toContain('xs: "var(--radius-control)"');
    expect(provider).toContain('lg: "var(--radius-surface)"');
    expect(provider).toContain('xl: "var(--radius-overlay)"');
    expect(provider).toContain('xs: "var(--edge-top)"');
    expect(provider).toContain('xl: "var(--shadow-overlay)"');
  });
});

/* ── 对比度 ───────────────────────────────────────────────── */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const n = hex.replace("#", "");
  const r = Number.parseInt(n.slice(0, 2), 16);
  const g = Number.parseInt(n.slice(2, 4), 16);
  const b = Number.parseInt(n.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Parse palette values from tokens.css so tests do not create a second source of truth. */
function palette(): Record<string, string> {
  const source = readFileSync(resolve(repoRoot, PALETTE_FILE), "utf8");
  const map: Record<string, string> = {};
  for (const [, name, value] of source.matchAll(/(--palette-[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)) {
    map[name!] = value!;
  }
  return map;
}

/**
 * 取色板里的一个 token，取不到就显式报出 token 名。
 * repo 的 tsconfig 开了 noUncheckedIndexedAccess，裸用 `map[name]!`
 * 只会在 token 被改名/删掉时炸出一个指向 relativeLuminance 里
 * `.replace` 的通用 TypeError，看不出到底是哪个 token 没了。
 */
function token(map: Record<string, string>, name: string): string {
  const value = map[name];
  if (value === undefined) throw new Error(`missing palette token ${name}`);
  return value;
}

const AA_TEXT = 4.5;
const ACCENTS = ["teal", "indigo", "violet", "orange"] as const;

/* 浅色模式三个表面 --surface-sunken / --surface-base / --surface-raised
 * 全部覆盖：sunken = neutral-50（三者中最暗）是最不利的文字底，
 * base = neutral-25、raised = neutral-0 依次更亮、更宽松。
 * 深色模式最不利 = 最亮的表面 --surface-raised。
 * 在模块作用域，因为下面的 Mantine 桥接那组断言用的是同一批表面 —— 抄第二份
 * 就会出现「改了一处、另一处还在测旧表面」。 */
const LIGHT_GROUND = "--palette-neutral-25";
const SUNKEN_GROUND = "--palette-neutral-50";
const DARK_GROUND = "--palette-neutral-850";

describe("accent contrast across all 6 theme × accent combinations", () => {
  const p = palette();

  for (const accent of ACCENTS) {
    it(`${accent}: light-mode accent text clears AA on paper`, () => {
      const ratio = contrastRatio(token(p, `--palette-${accent}-700`), token(p, LIGHT_GROUND));
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it(`${accent}: light-mode accent text clears AA on white cards`, () => {
      const ratio = contrastRatio(token(p, `--palette-${accent}-700`), token(p, "--palette-neutral-0"));
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it(`${accent}: light-mode accent text clears AA on the sunken surface (worst case)`, () => {
      const ratio = contrastRatio(token(p, `--palette-${accent}-700`), token(p, SUNKEN_GROUND));
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it(`${accent}: dark-mode accent text clears AA on the lightest dark surface`, () => {
      const ratio = contrastRatio(token(p, `--palette-${accent}-500`), token(p, DARK_GROUND));
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it(`${accent}: on-fill ink clears AA on the accent fill`, () => {
      const ratio = contrastRatio(token(p, `--palette-${accent}-900`), token(p, `--palette-${accent}-500`));
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it(`${accent}: on-fill ink does NOT clear AA on the darker hover fill`, () => {
      /* --accent-on-fill（900 墨）落在 --accent-fill-hover（600）上只有
       * 3.16–3.50，不过 AA。反向断言把这个
       * 事实钉住——如果哪天有人把 --accent-on-fill 直接压回 hover 态的填充上
       * （不经过 --accent-on-fill-hover），这条会先炸，而不是等人眼发现按钮
       * hover 时文字看不清。 */
      const ratio = contrastRatio(token(p, `--palette-${accent}-900`), token(p, `--palette-${accent}-600`));
      expect(ratio).toBeLessThan(AA_TEXT);
    });

    it(`${accent}: hover-only on-fill ink (--accent-on-fill-hover) clears AA on the darker hover fill`, () => {
      /* 上面那条反向断言证明了问题；这条证明修复有效。--accent-fill-hover
       * 必须仍然比 --accent-fill 深一档（hover 加深反馈，不能为了凑文字
       * 对比度调浅），三个 accent 各自的 900 墨也不够深、不能无差别加深（会
       * 破坏它在 --accent-fill 上已经过 AA 的非 hover 场景，见上一条断言）。
       * 所以 hover 态换一个与 accent 无关的纯黑墨（tokens.css 的
       * --palette-ink-black，经 semantic.css 的 --accent-on-fill-hover 转发），
       * 三个 accent 都要在这个新墨色上过 AA。复用 :299 那条断言的 token() /
       * contrastRatio() 辅助函数，不另写一份。 */
      const ratio = contrastRatio(token(p, "--palette-ink-black"), token(p, `--palette-${accent}-600`));
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it(`${accent}: mid stop is decorative only — it must NOT be used as text on white`, () => {
      /* 反向断言：500 档作为白底文字是不合格的，这正是它需要 700 档存在的理由。
       * 如果哪天有人把 --accent-500 直接当浅色模式文字用，这条会提醒他为什么不行。 */
      const ratio = contrastRatio(token(p, `--palette-${accent}-500`), token(p, "--palette-neutral-0"));
      expect(ratio).toBeLessThan(AA_TEXT);
    });
  }

  it("body text clears AA in both modes", () => {
    expect(contrastRatio(token(p, "--palette-neutral-800"), token(p, "--palette-neutral-25"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(token(p, "--palette-ink-warm"), token(p, "--palette-neutral-850"))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("body text clears AA on the sunken surface (worst case light ground)", () => {
    expect(contrastRatio(token(p, "--palette-neutral-800"), token(p, SUNKEN_GROUND))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("muted text clears AA in both modes", () => {
    expect(contrastRatio(token(p, "--palette-neutral-500"), token(p, "--palette-neutral-25"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(token(p, "--palette-neutral-400"), token(p, "--palette-neutral-850"))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("muted text clears AA on the sunken surface (worst case light ground)", () => {
    expect(contrastRatio(token(p, "--palette-neutral-500"), token(p, SUNKEN_GROUND))).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

/* ── Mantine light-variant text contrast ─────────── */

/**
 * Portal actions use one fixed brand ramp. These assertions resolve the values
 * from the actual Mantine bridge so the test cannot drift into a second token
 * source of truth.
 */

/**
 * Mantine 浅色模式的 primaryShade。light variant 的填充与文字都取这一档：
 * @mantine/core 的 get-css-color-variables.mjs 里
 *   --mantine-color-X-light:       alpha(colors[X][primaryShade], 0.1)
 *   --mantine-color-X-light-color: var(--mantine-color-X-{primaryShade})
 *   --mantine-color-X-text:        var(--mantine-color-X-filled) → 同一档
 */
const MANTINE_LIGHT_PRIMARY_SHADE = 6;
/** 同上，light variant 填充的不透明度。 */
const MANTINE_LIGHT_FILL_ALPHA = 0.1;

/** 在选择器含 needle 的块里找 `property: var(--x)` 的目标，找不到返回 undefined。
 * 属性名前加 `(?:^|[\s;{])` 左边界锚定：不加的话 `--accent-700:` 这样的 needle
 * 会误命中 `--foo-accent-700:`（H-2c）。 */
function scopedForward(source: string, needle: string, property: string): string | undefined {
  for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selector?.includes(needle)) continue;
    const hit = body?.match(new RegExp(`(?:^|[\\s;{])${property}:\\s*var\\((--[a-z0-9-]+)\\)`));
    if (hit?.[1]) return hit[1];
  }
  return undefined;
}

/** Resolve a token forward within one exact selector so specificity is part of the contract. */
function forwardTarget(source: string, selector: string, property: string, where: string): string {
  const hit = scopedForward(source, selector, property);
  if (hit === undefined) {
    throw new Error(`${where}: 找不到 ${property} 的 var() 转发目标 —— 这条桥接缺失，或者没走 var() 转发。`);
  }
  return hit;
}

/**
 * H-2a 补充断言：Mantine 后注入的 `:root[data-mantine-color-scheme="light"]`
 * 覆盖是 (0,2,0)。要稳赢就必须比它多一段选择器组件，凑到 (0,3,0) ——
 * `:root[data-theme="light"][data-theme="light"]` 靠属性选择器重复自身达到
 * 三段。这条断言钉住「选择器字面量必须是三段」这件事本身，不经过
 * forwardTarget/scopedForward 的解析，避免和上面两个断言共用同一个可能失灵的
 * 检测路径。 */
const PORTAL_BRAND_SELECTOR = ":root[data-theme][data-theme]";

/** 把一个语义名一路解析到 L1 色板名：先查浅色模式块，再查该主色块。 */
function resolveToPalette(semantic: string, accent: string, start: string): string {
  let name = start;
  for (let hop = 0; hop < 4; hop += 1) {
    if (name.startsWith("--palette-")) return name;
    const next = scopedForward(semantic, '[data-theme="light"]', name)
      ?? scopedForward(semantic, `[data-accent="${accent}"]`, name)
      /* 与模式无关的 accent 派生（--accent-fill 等）住在 semantic.css 的 :root 里。 */
      ?? scopedForward(semantic, ":root", name);
    if (next === undefined) throw new Error(`${SEMANTIC_FILE}: ${name} 在主色 ${accent} 下解不到 L1 色板。`);
    name = next;
  }
  throw new Error(`${SEMANTIC_FILE}: ${start} 的转发链超过 4 跳，疑似成环。`);
}

/** ThemeProvider 里 portal-brand 色阶的第 index 档。不在测试里抄一份，有人重排要跟着变。 */
function brandRampStep(index: number): string {
  const source = readFileSync(resolve(repoRoot, THEME_PROVIDER_FILE), "utf8");
  const marker = '"portal-brand": [';
  const open = source.indexOf(marker);
  if (open === -1) throw new Error(`${THEME_PROVIDER_FILE}: 找不到 portal-brand 色阶 —— 被改名或挪走了，请同步改这个测试。`);
  const steps = [...source.slice(open + marker.length, source.indexOf("]", open)).matchAll(/var\((--brand-[a-z0-9-]+)\)/g)]
    .map((match) => match[1]!);
  if (steps.length !== 10) throw new Error(`${THEME_PROVIDER_FILE}: Mantine 色阶必须正好 10 档，实际 ${steps.length} 档。`);
  const step = steps[index];
  if (step === undefined) throw new Error(`${THEME_PROVIDER_FILE}: portal-brand 取不到第 ${index} 档。`);
  return step;
}

/** 把 fg 以 ratio 的不透明度压在 bg 上，得到实际渲染出来的底色。 */
function over(fg: string, bg: string, ratio: number): string {
  const a = fg.replace("#", "");
  const b = bg.replace("#", "");
  let out = "#";
  for (let i = 0; i < 6; i += 2) {
    const blended = Number.parseInt(a.slice(i, i + 2), 16) * ratio + Number.parseInt(b.slice(i, i + 2), 16) * (1 - ratio);
    out += Math.round(blended).toString(16).padStart(2, "0");
  }
  return out;
}

describe("Mantine light variant 的文字色在浅色模式下过 AA", () => {
  const p = palette();
  const entry = readFileSync(resolve(repoRoot, ENTRY_FILE), "utf8");
  const semantic = readFileSync(resolve(repoRoot, SEMANTIC_FILE), "utf8");

  /* 浅色三层表面全覆盖，sunken 最暗、是最不利的底。 */
  const LIGHT_SURFACES = ["--palette-neutral-0", LIGHT_GROUND, SUNKEN_GROUND];

  for (const accent of ACCENTS) {
    it(`${accent}: light variant 的文字在三种浅色表面的淡色填充上都过 AA`, () => {
      const text = token(p, resolveToPalette(semantic, accent, forwardTarget(entry, PORTAL_BRAND_SELECTOR, "--mantine-color-portal-brand-light-color", ENTRY_FILE)));
      const fill = token(p, resolveToPalette(semantic, accent, brandRampStep(MANTINE_LIGHT_PRIMARY_SHADE)));
      const failures = LIGHT_SURFACES
        .map((surface) => ({ surface, ratio: contrastRatio(text, over(fill, token(p, surface), MANTINE_LIGHT_FILL_ALPHA)) }))
        .filter(({ ratio }) => ratio < AA_TEXT)
        .map(({ surface, ratio }) => `${surface}: ${ratio.toFixed(2)}`);
      expect(
        failures,
        `--mantine-color-portal-brand-light-color 指向的档位在这些表面上不过 ${AA_TEXT}:1：\n${failures.join("\n")}`,
      ).toEqual([]);
    });

    it(`${accent}: subtle / transparent 与 <Text c> 的文字在三种浅色表面上都过 AA`, () => {
      /* --mantine-color-X-text 是 variant="subtle" / "transparent" 与 <Text c="…">
       * 取的那一档，直接画在表面上、没有淡色填充垫底。 */
      const text = token(p, resolveToPalette(semantic, accent, forwardTarget(entry, PORTAL_BRAND_SELECTOR, "--mantine-color-portal-brand-text", ENTRY_FILE)));
      const failures = LIGHT_SURFACES
        .map((surface) => ({ surface, ratio: contrastRatio(text, token(p, surface)) }))
        .filter(({ ratio }) => ratio < AA_TEXT)
        .map(({ surface, ratio }) => `${surface}: ${ratio.toFixed(2)}`);
      expect(
        failures,
        `--mantine-color-portal-brand-text 指向的档位在这些表面上不过 ${AA_TEXT}:1：\n${failures.join("\n")}`,
      ).toEqual([]);
    });
  }

  it("styles.css keeps the three-part brand bridge selector above Mantine specificity", () => {
    /* 必须是三段：Mantine 自己那条 `:root[data-mantine-color-scheme="light"]`
     * 覆盖是 (0,2,0) 且注入在本文件之后，打平会赢。属性选择器自我重复
     * （[data-theme="light"][data-theme="light"]）把这条覆盖抬到 (0,3,0)，
     * 稳赢而不必依赖感叹号优先级。削回单段 [data-theme="light"]（0,1,0）会让
     * 这场特异性之争静默输掉——上面两个断言靠 forwardTarget 的选择器定位能
     * 拦住这个坑，这一条独立钉住选择器字面量本身，防止两者共用的解析路径
     * 同时失灵。 */
    expect(entry.includes(PORTAL_BRAND_SELECTOR)).toBe(true);
  });
});

/* ── primaryShade 护栏（H-2b） ────────────────────────────── */

/**
 * MANTINE_LIGHT_PRIMARY_SHADE = 6 是 @mantine/core 库常量（浅色模式默认
 * primaryShade）的第二份拷贝，本文件没有办法从库里读出这个值来核对。
 * 只要有人在 createTheme 里加一行 `primaryShade: { light: 5, dark: 8 }`，
 * Mantine 就会改取第 5 档，而上面两条 AA 断言仍按第 6 档算——静默测错档位。
 * 这条断言不核对数值是否同步（做不到），只保证「没有人动过这个开关」：
 * createTheme 的实参里不出现 primaryShade。 */
/** Extract a balanced call expression after the requested source marker. */
function extractBalancedCall(source: string, marker: string, description: string): string {
  const open = source.indexOf(marker);
  if (open === -1) {
    throw new Error(`${THEME_PROVIDER_FILE}: 找不到 ${marker} —— ${description}被挪走或改名了，请同步改这个测试。`);
  }
  let depth = 0;
  for (let i = open + marker.length - 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`${THEME_PROVIDER_FILE}: ${marker} 的括号没有配平，无法切出配置对象。`);
}

/** 取 `createTheme(` 之后到括号配平为止的那段源码。 */
function createThemeArgument(source: string): string {
  return extractBalancedCall(source, "createTheme(", "Mantine 主题配置");
}

describe("primaryShade 未被覆盖（H-2b）", () => {
  it("createTheme 的实参里不出现 primaryShade", () => {
    const argument = createThemeArgument(readFileSync(resolve(repoRoot, THEME_PROVIDER_FILE), "utf8"));
    const hasPrimaryShade = /(^|[\s{,])primaryShade\s*:/.test(argument);
    expect(
      hasPrimaryShade,
      `${THEME_PROVIDER_FILE} 的 createTheme 里出现了 primaryShade —— 这会让 Mantine 改取另一档，` +
        `而 theme-tokens.test.ts 里的 MANTINE_LIGHT_PRIMARY_SHADE 常量不会跟着变，AA 断言将静默测错档位。` +
        `请同步更新该常量后再移除这条守卫，或撤回 primaryShade 覆盖。`,
    ).toBe(false);
  });
});

/* ── Menu single-source guard ────────────────────────── */

/** JS-side Mantine configuration is outside the CSS token rules and needs its own guard. */
/** 取 `Menu.extend(` 之后到括号配平为止的那段源码。 */
function menuExtendArgument(source: string): string {
  return extractBalancedCall(source, "Menu.extend(", "菜单的 Mantine 配置");
}

describe("menu single source of truth", () => {
  it("Menu.extend 里没有 styles —— 菜单外观不得在 JS 侧重新长出第二个真相", () => {
    const argument = menuExtendArgument(readFileSync(resolve(repoRoot, THEME_PROVIDER_FILE), "utf8"));
    const hasStyles = /(^|[\s{,])styles\s*:/.test(argument);
    expect(
      hasStyles,
      `${THEME_PROVIDER_FILE} 的 Menu.extend 里出现了 styles —— Mantine 的 styles prop 生成内联样式，` +
        `会无条件压过 ${ENTRY_FILE} 的菜单区块。菜单外观请写在那个区块里。实际内容：\n${argument}`,
    ).toBe(false);
  });
});

describe("token file coverage", () => {
  it("every tokenized path exists on disk", () => {
    const onDisk = new Set(listCssFiles(portalRoot).map(toRepoPath));
    const missing = TOKENIZED_CSS_FILES.filter((path) => !onDisk.has(path));
    expect(missing).toEqual([]);
  });

  it("the token contract covers every CSS file on disk", () => {
    const onDisk = listCssFiles(portalRoot).map(toRepoPath).sort();
    const tokenized = [...TOKENIZED_CSS_FILES].sort();

    /* New stylesheets must enter the token contract explicitly. */
    expect(tokenized).toEqual(onDisk);
  });
});

describe("display font delivery", () => {
  it("self-hosts the 700 Latin and Latin-Ext subsets within the 30 KiB budget", () => {
    const totalBytes = DISPLAY_FONT_FILES.reduce(
      (total, path) => total + statSync(resolve(repoRoot, path)).size,
      0,
    );

    expect(totalBytes).toBeLessThanOrEqual(30 * 1024);
  });

  it("uses swap, metric adjustment, unicode ranges, and preloads only the primary Latin subset", () => {
    const scale = readFileSync(resolve(repoRoot, SCALE_FILE), "utf8");
    const html = readFileSync(resolve(repoRoot, PORTAL_HTML_FILE), "utf8");

    expect(scale.match(/@font-face/g)).toHaveLength(2);
    expect(scale.match(/font-display:\s*swap/g)).toHaveLength(2);
    expect(scale.match(/size-adjust:\s*98%/g)).toHaveLength(2);
    expect(scale.match(/unicode-range:/g)).toHaveLength(2);
    expect(html).toContain('href="/fonts/saira-semi-condensed-latin-700.woff2"');
    expect(html).not.toContain('href="/fonts/saira-semi-condensed-latin-ext-700.woff2"');
  });

  it("uses the display family only for Latin route titles, brand marks, and KPI numerals", () => {
    const scale = readFileSync(resolve(repoRoot, SCALE_FILE), "utf8");
    const appShell = readFileSync(
      resolve(repoRoot, "apps/portal/components/layout/AppShell.css"),
      "utf8",
    );
    const numberTicker = readFileSync(
      resolve(repoRoot, "apps/portal/components/effects/NumberTicker.tsx"),
      "utf8",
    );

    expect(appShell).toMatch(
      /\[data-locale="en"\] \.app-header__page-title,[\s\S]*?\[data-locale="en"\] \.app-brand-mark\s*\{[\s\S]*?font-family:\s*var\(--font-display\)/,
    );
    expect(appShell).not.toMatch(/\[data-locale="zh"\][^{]*\{[^}]*var\(--font-display\)/);
    expect(scale).toMatch(
      /\.portal-kpi-value\s*\{[\s\S]*?font-family:\s*var\(--font-display\)[\s\S]*?font-variant-numeric:\s*tabular-nums/,
    );
    expect(numberTicker).toContain('"portal-kpi-value"');
    expect(numberTicker).not.toContain("fontVariantNumeric");
  });

  it("keeps the document body on the app field when Mantine base styles load later", () => {
    const entry = readFileSync(resolve(repoRoot, ENTRY_FILE), "utf8");

    expect(entry).toMatch(
      /html\s+body\s*\{[\s\S]*?background:\s*var\(--surface-sunken\)/,
    );
  });
});
