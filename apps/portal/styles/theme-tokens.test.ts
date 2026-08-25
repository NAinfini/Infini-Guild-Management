// @vitest-environment node
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
  "apps/portal/styles/shadcn.css",
  "apps/portal/components/layout/AppShell.css",
  "apps/portal/components/layout/CmdKSearch.module.css",
  "apps/portal/components/layout/ImportantNoticeGate.module.css",
  "apps/portal/components/layout/NotificationPopover.module.css",
  "apps/portal/components/layout/PageLayout.css",
  "apps/portal/components/layout/PublicSiteHeader.css",
  "apps/portal/components/pages/GuildWarPage.css",
  "apps/portal/components/pages/StoragePage.css",
  "apps/portal/components/pages/AuthPages.css",
  "apps/portal/components/pages/AdminPage.css",
  "apps/portal/components/pages/DashboardPage.css",
  "apps/portal/components/pages/LandingPage.css",
  "apps/portal/components/pages/ToolsPage.css",
  "apps/portal/components/pages/AnnouncementsPage.css",
  "apps/portal/components/pages/EventsPage.css",
  "apps/portal/components/pages/GalleryPage.css",
  "apps/portal/components/pages/MyProfilePage.css",
  "apps/portal/components/pages/RosterPage.css",
  "apps/portal/components/pages/SettingsPage.css",
  "apps/portal/components/pages/SystemStatusPage.css",
  "apps/portal/components/pages/WikiPage.css",
  "apps/portal/components/feature/admin/AdminApiTest.css",
  "apps/portal/components/shared/tiptap-editor.css",
  "apps/portal/components/feature/events/RecurringTemplateFormContent.css",
  "apps/portal/components/feature/events/EventCardsView.css",
  "apps/portal/components/feature/admin/AuditLogViewer.css",
  "apps/portal/components/feature/events/EventDetailContent.css",
  "apps/portal/components/feature/admin/AdminSystemSection.css",
  "apps/portal/components/shared/MemberCard.css",
  "apps/portal/components/shared/ExperienceControls.css",
  "apps/portal/components/feature/admin/AdminBadgesSection.css",
  "apps/portal/components/feature/admin/AdminClassesSection.css",
  "apps/portal/components/feature/admin/AdminImportantNoticesSection.css",
  "apps/portal/components/shared/media-gallery.css",
  "apps/portal/components/feature/events/EventMonthView.css",
  "apps/portal/components/shared/ProfileModal.module.css",
  "apps/portal/components/feature/admin/AdminMemberDetailInspector.module.css",
  /* Shared controls consume only L2/L3 variables. */
  "apps/portal/components/shared/SectionHeader.css",
  "apps/portal/components/shared/TitleField.css",
  "apps/portal/components/shared/NativeDateTimeInput.css",
  "apps/portal/components/shared/ContentFilterToolbar.css",
  "apps/portal/components/shared/VisualThemeArtwork.css",
  "apps/portal/components/shared/PageSubnav.css",
  "apps/portal/components/shared/EntityNavigator.css",
  "apps/portal/components/shared/ClassIcon.css",
  "apps/portal/components/shared/ImageGridEditor.css",
  /* 行内样式片段编辑器（称号与徽章标签共用）。样式当初随组件从 ToolsPage.css
     拆出来时是原样搬运，没有引入新的字面值。 */
  "apps/portal/components/shared/LabelStyleModal.css",
  "apps/portal/components/feature/admin/AdminOperationsTab.css",
  "apps/portal/components/feature/admin/AdminDiagnosticsTab.css",
  "apps/portal/components/feature/admin/AdminDataIntegrityTool.css",
  /* 职业配额条只有一个填充色相（活动域色），超员时转危险色，够员靠计数变成功色；
     全部使用语义 token。 */
  "apps/portal/components/feature/events/EventQuotaBar.css",
  "apps/portal/components/feature/events/ClassQuotaEditor.css",
  "apps/portal/components/feature/events/EventFormContent.css",
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
  "apps/portal/components/feature/admin/AdminMemberMediaTab.css",
  "apps/portal/components/feature/admin/AdminUsersSection.css",
  "apps/portal/components/feature/admin/CreateMemberModal.css",
  "apps/portal/components/shared/AbsenceManagerCard.css",
  "apps/portal/components/shared/AvailabilityEditor.css",
  "apps/portal/components/shared/DataTableAdapter.css",
  "apps/portal/components/shared/DataTablePagination.css",
  "apps/portal/components/shared/MetricGridInput.css",
  "apps/portal/components/ui/route-progress.css",
];

/** 唯一允许出现 hex 的文件。 */
const PALETTE_FILE = "apps/portal/styles/tokens.css";
/** L2 语义层：所有 --accent-* / --text-* 的分模式、分主色定义处。 */
const SEMANTIC_FILE = "apps/portal/styles/semantic.css";
/** L3 标度层：尺寸标度，不表达颜色语义，但同样是「token 文件」本身，
 * 不是组件层，豁免 rule 6。 */
const SCALE_FILE = "apps/portal/styles/scale.css";
/** 全局样式入口。 */
const ENTRY_FILE = "apps/portal/styles.css";
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
  /* PageLayout.tsx:82-87，PageLayout 组件在根元素 style 上内联注入。 */
  "--page-layout-cols-xs",
  "--page-layout-cols-sm",
  "--page-layout-cols-md",
  "--page-layout-cols-lg",
  "--page-layout-cols-xl",
  "--page-layout-grid-gap",
  /* AppShell.tsx writes the live sidebar width onto the shell root. */
  "--app-sidebar-width",
  /* GalleryGrid.tsx:114，每张卡片的 style 上内联注入，用来错开入场动画延迟。 */
  "--stagger-index",
  /* LastWarCard.tsx:138，结果徽章的 style 上内联注入。 */
  "--war-result-color",
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
  /* --signup-dot-color：MySignupsCard.tsx 从 source-owned event type palette
   * 取得颜色，随事件类型变化，由色点 span 在运行期内联写入。 */
  "--signup-dot-color",
  /* Dynamic catalog and event colours are validated application data projected inline. */
  "--role-color",
  "--class-swatch",
  "--event-card-badge-color",
  "--month-event-color",
  /* --kpi-ratio：仪表盘比例计的 0..1 比值，运行期由 dashboard/shared.tsx 的
   * KpiMeter 在填充段的内联 style 上无条件写入（值在组件里已钳到 0..1）。 */
  "--kpi-ratio",
];

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
 * 「先剥注释再扫」（这是为了不让 EventDetailContent.css 那种在注释里纯讲解历史
 * rgb() 数值的说明文字被误当成命中——剥注释前会先加进命中列表）。但先剥注释
 * 就意味着扫描函数看不到注释里写的豁免理由，没法用「附近有没有说明注释」当
 * 判据；所以豁免机制使用这张按文件+值索引的表，并要求每条都记录来源与理由。
 */
const LITERAL_COLOUR_EXEMPTIONS: Record<string, LiteralColourExemption[]> = {
  "apps/portal/components/feature/events/EventCardsView.css": [
    {
      source: ".event-card__raffle-winners-badge",
      reason: "徽章底色与文字是固定的结果状态配色，不随 [data-theme] 变化；投影延续同一条决定，避免固定配色搭配会变化的阴影。",
      values: ["rgba(0, 0, 0, 0.2)"],
    },
  ],
  "apps/portal/components/pages/GalleryPage.css": [
    {
      source: ".gallery-video-thumb 与其 :hover 变体（已有注释）",
      reason: "占位背景使用固定深色，不随 [data-theme] 变化，图标色跟着保持固定白色透明度。",
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
      values: ["rgba(255, 255, 255, 0.1)", "rgba(255, 255, 255, 0.8)", "rgba(255, 255, 255, 0.2)", "rgba(255, 255, 255, 0.28)", "rgb(255 255 255)", "rgb(255 255 255)"],
    },
    {
      source: ".gallery-lb__nav 与其 :hover（已有注释）",
      reason: "理由同 .gallery-lb__close：固定近黑遮罩上的固定白色玻璃控件。",
      values: ["rgba(255, 255, 255, 0.08)", "rgba(255, 255, 255, 0.7)", "rgba(255, 255, 255, 0.18)", "rgba(255, 255, 255, 0.26)", "rgb(255 255 255)"],
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
      reason: "播放图标固定用白色，投影同理固定：给白色图标描一圈暗晕，保证压在任意亮度的缩略图上都看得清。",
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
      reason: "浅色模式唯一两档层级：表面顶边与浮层投影。它们是模式语义 token 的固定中性色值。--edge-top 是三段（顶边高光、贴地接触影、远投影）：前两段撑不开 #FFFFFF 卡片与 #FAF9F5 工作区之间 5 个亮度点的差，远投影那段才是分层的那一段。",
      values: [
        "rgb(255 255 255 / 0.90)",
        "rgb(10 10 15 / 0.05)",
        "rgb(10 10 15 / 0.22)",
        "rgb(10 10 15 / 0.18)",
      ],
    },
    {
      source: "[data-theme=\"dark\"] 块的 --edge-top / --shadow-overlay",
      reason: "深色模式对应的两档层级值，同样是三段式 --edge-top。",
      values: [
        "rgb(255 255 255 / 0.07)",
        "rgb(0 0 0 / 0.24)",
        "rgb(0 0 0 / 0.55)",
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
        (name) => !defined.has(name) && !RUNTIME_INJECTED_VARS.includes(name),
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
  const sharedStyles = readFileSync(
    resolve(repoRoot, "apps/portal/styles/shadcn.css"),
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

  it("uses a transparent pseudo-element for controls smaller than the hit-area token", () => {
    expect(sharedStyles).toMatch(/\[data-slot="button"\]::before\s*\{[\s\S]*?inline-size:\s*max\(100%,\s*var\(--control-hit-area\)\)/);
    expect(sharedStyles).toMatch(/\[data-slot="button"\]::before\s*\{[\s\S]*?block-size:\s*max\(100%,\s*var\(--control-hit-area\)\)/);
    expect(sharedStyles).toMatch(/\[data-slot="button"\]::before\s*\{[\s\S]*?background:\s*transparent/);
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
 * 放在模块作用域，因为下方多组对比度断言消费同一批表面，避免抄第二份
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

/* ── 双主题对等 ───────────────────────────────────────────── */

/** 收集某个选择器名下所有块里声明过的自定义属性名（注释已剥离）。 */
function customPropertiesUnder(source: string, selector: string): Set<string> {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = new Set<string>();
  for (const block of withoutComments.matchAll(new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`, "g"))) {
    for (const declaration of (block[1] ?? "").matchAll(/(--[a-z0-9-]+)\s*:/g)) {
      names.add(declaration[1]!);
    }
  }
  return names;
}

describe("dual-theme parity", () => {
  /**
   * 一个 token 只在一个模式里定义，是这套 token 层唯一会静默失效的错法：
   * 硬规则 5 只检查「var() 能不能解析到某处定义」，浅色块里有、深色块里没有
   * 的 token 照样过。真正的表现是换到另一个模式后那条声明整条作废——文字
   * 拿不到颜色、填充退回透明——而且只在人眼切到那个模式时才看得见。
   * 两个模式声明的名字集合必须完全相同；模式无关的派生值请写在 :root。
   */
  it("both mode blocks declare exactly the same token names", () => {
    const source = readFileSync(resolve(repoRoot, SEMANTIC_FILE), "utf8");
    const light = customPropertiesUnder(source, '[data-theme="light"]');
    const dark = customPropertiesUnder(source, '[data-theme="dark"]');

    expect(light.size).toBeGreaterThan(0);
    expect([...light].filter((name) => !dark.has(name))).toEqual([]);
    expect([...dark].filter((name) => !light.has(name))).toEqual([]);
  });

  /**
   * 分类色序表达的是「第几项」，四个位次同时出现在一张图或一条配额条上时
   * 必须互不相同——重复的色值比少一个颜色更糟，两条数据会读成同一条。
   * 首位 --series-accent 跟着站点主色走，必然与四个固定位次中的一个撞色，
   * 由消费方去重（见 theme/echarts.ts），所以不参与这条断言。
   */
  it("the four fixed series slots stay mutually distinct in both modes", () => {
    const source = readFileSync(resolve(repoRoot, SEMANTIC_FILE), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

    for (const mode of ["light", "dark"] as const) {
      const block = new RegExp(`\\[data-theme="${mode}"\\]\\s*\\{([^{}]*)\\}`, "g");
      const values = [...source.matchAll(block)]
        .flatMap((match) => [...(match[1] ?? "").matchAll(/--series-([1-4])\s*:\s*([^;]+);/g)])
        .map((declaration) => declaration[2]!.trim());

      expect(values).toHaveLength(4);
      expect(new Set(values).size).toBe(4);
    }
  });

  /**
   * 分类色序的四个色相就是四个可选主色，档位分工也一致（浅 700 / 深 500），
   * 于是它们的可读性已经被上面那组 accent 对比度断言逐一钉住了。这条断言
   * 守的是这个复用关系本身：一旦有人往色序里塞一个不在主色集合里的色相，
   * 那个色相就没有任何对比度覆盖，必须先补断言再进来。
   */
  it("draws every series hue from the accent set, so accent contrast already covers them", () => {
    const source = readFileSync(resolve(repoRoot, SEMANTIC_FILE), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const stops: Record<string, string> = { light: "700", dark: "500" };
    const offenders: string[] = [];

    for (const [mode, stop] of Object.entries(stops)) {
      const block = new RegExp(`\\[data-theme="${mode}"\\]\\s*\\{([^{}]*)\\}`, "g");
      for (const match of source.matchAll(block)) {
        for (const declaration of (match[1] ?? "").matchAll(/--series-([1-4])\s*:\s*var\(--palette-([a-z]+)-(\d+)\)/g)) {
          const [, slot, hue, used] = declaration;
          if (!ACCENTS.includes(hue as (typeof ACCENTS)[number]) || used !== stop) {
            offenders.push(`${mode} --series-${slot}: --palette-${hue}-${used}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /**
   * 比例条的填充压在轨道上，是 WCAG 1.4.11 说的「理解内容所必需的图形部件」，
   * 下限 3:1。轨道是 --surface-sunken：深色模式它是全站最暗的一档，怎么填都够；
   * 浅色模式它接近白，只有跟着表面走档位的 accent（700）才读得出来。
   * 这条断言存在的理由是 --meter-fill 一度取了恒 500 的 --accent-fill，
   * 浅色实测只有 2.23–2.52:1。
   */
  it("meter fill clears the 3:1 non-text floor against its track in both modes", () => {
    const p = palette();
    const AA_NON_TEXT = 3;

    for (const accent of ACCENTS) {
      expect(contrastRatio(token(p, `--palette-${accent}-700`), token(p, SUNKEN_GROUND))).toBeGreaterThanOrEqual(AA_NON_TEXT);
      expect(contrastRatio(token(p, `--palette-${accent}-500`), token(p, "--palette-neutral-950"))).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });
});

/* 下面几个函数服务本文件末尾的「ambient contrast budget」一组：把 token 解成
 * 色值，再按 alpha 把光一层层叠到地面上。 */

function hexChannels(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  return [
    Number.parseInt(n.slice(0, 2), 16),
    Number.parseInt(n.slice(2, 4), 16),
    Number.parseInt(n.slice(4, 6), 16),
  ];
}

/** 不透明底上叠一层带 alpha 的色。底不透明，逐通道线性插值即可。 */
function washOver(tint: string, alpha: number, ground: string): string {
  const t = hexChannels(tint);
  const g = hexChannels(ground);
  return `#${[0, 1, 2]
    .map((i) => Math.round(t[i]! * alpha + g[i]! * (1 - alpha)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * 解析某个模式块里的语义 token。值形如 `var(--palette-x)` 的解到色板色值，
 * 形如 `color-mix(in srgb, var(--palette-x) N%, var(--surface-y))` 的直接算出来。
 * 不自己抄一份色值，全部回到 tokens.css 与 semantic.css。
 */
function themeTokens(theme: "light" | "dark"): Record<string, string> {
  const source = readFileSync(resolve(repoRoot, SEMANTIC_FILE), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const block = source.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^{}]*)\\}`));
  if (!block) throw new Error(`missing [data-theme="${theme}"] block`);
  const p = palette();
  const out: Record<string, string> = {};

  for (const [, name, value] of block[1]!.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    const raw = value!.trim();
    const direct = raw.match(/^var\((--palette-[a-z0-9-]+)\)$/);
    if (direct) {
      out[name!] = token(p, direct[1]!);
      continue;
    }
    const percent = raw.match(/^(\d+)%$/);
    if (percent) out[name!] = raw;
  }

  /* 第二遍：解 color-mix 和「指向同块内另一个语义 token」这两种间接写法，
   * 它们的原料可能是第一遍才刚解出来的。反复扫到不再有新解出的为止，
   * 这样别名链多长都不必关心声明顺序。 */
  for (let pass = 0; pass < 4; pass += 1) {
    let resolved = 0;
    for (const [, name, value] of block[1]!.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
      if (out[name!] !== undefined) continue;
      const raw = value!.trim();

      const alias = raw.match(/^var\((--[a-z0-9-]+)\)$/);
      if (alias && out[alias[1]!] !== undefined) {
        out[name!] = out[alias[1]!]!;
        resolved += 1;
        continue;
      }

      const mix = raw.match(
        /^color-mix\(in srgb, var\((--[a-z0-9-]+)\) (\d+)%, var\((--[a-z0-9-]+)\)\)$/,
      );
      if (!mix) continue;
      const tint = p[mix[1]!] ?? out[mix[1]!];
      const ground = out[mix[3]!];
      if (tint && ground) {
        out[name!] = washOver(tint, Number(mix[2]) / 100, ground);
        resolved += 1;
      }
    }
    if (resolved === 0) break;
  }
  return out;
}

const AMBIENT_CSS = readFileSync(resolve(portalRoot, "styles/semantic.css"), "utf8");

/** @property 上的静止坐标，是圆心位置唯一的出处。 */
function restingCenter(axis: string): number {
  const block = new RegExp(`@property\\s+--ambient-${axis}\\s*\\{([^}]*)\\}`).exec(AMBIENT_CSS);
  return Number.parseFloat(/initial-value:\s*(-?[\d.]+)%/.exec(block![1]!)![1]!);
}

/** 从配方里读某一团光的半径，不在测试里抄第二份。 */
function lightRadii(name: string): { rx: number; ry: number } {
  const block = new RegExp(
    `--ambient-layer-${name}:\\s*radial-gradient\\(([\\d.]+)% ([\\d.]+)%`,
  ).exec(AMBIENT_CSS);
  return { rx: Number.parseFloat(block![1]!), ry: Number.parseFloat(block![2]!) };
}

/** 九支域色，从配方里读，别处新增一支，用到它的每一组都自动跟上。 */
const DOMAIN_NAMES = [
  ...new Set([...AMBIENT_CSS.matchAll(/\[data-domain="([a-z]+)"\]/g)].map((match) => match[1]!)),
];

/* 三团光：名字、坐标下标、以及「贴着哪条边」——最后一项决定漂移只许往哪走。 */
const AMBIENT_LIGHTS = [
  { name: "domain", axis: 1, edge: "bottom" },
  { name: "companion", axis: 2, edge: "right" },
  { name: "accent", axis: 3, edge: "top" },
] as const;

/** radial-gradient(RX% RY% at CX% CY%, c, transparent 100%) 在 (x,y) 的强度。 */
function radialAt(
  light: { cx: number; cy: number; rx: number; ry: number },
  x: number,
  y: number,
): number {
  return Math.max(0, 1 - Math.hypot((x - light.cx) / light.rx, (y - light.cy) / light.ry));
}

/** linear-gradient(θ, c, transparent STOP%) 在 (x,y) 的强度：起点满、STOP 处归零。 */
function linearAt(deg: number, stop: number, x: number, y: number): number {
  const rad = (deg * Math.PI) / 180;
  const [dx, dy] = [Math.sin(rad), -Math.cos(rad)];
  const length = Math.abs(100 * dx) + Math.abs(100 * dy);
  const along = 0.5 + ((x - 50) * dx + (y - 50) * dy) / length;
  return Math.min(1, Math.max(0, 1 - along / stop));
}

/* ── 环境光的对比度预算 ─────────────────────────────────────
 *
 * 三团光加一层压角铺在地面上，压在全站地面正文底下：每个字的实际背景都被它
 * 改过。所以「文字档 × 表面档」的对比度不能按干净表面算。
 *
 * 上一版用「峰值代数」估：每团算出自己在视口内能达到的最强值，再论证三团分居
 * 不会叠加。它有两个洞——三团互相的残余没算，压角那一层根本没进预算。现在直接
 * 在视口上打网格，逐点按 CSS 的合成顺序把四层叠起来，遍历全部配色组合取最差。
 * 配方与几何都从 semantic.css 读，测试里不存第二份数。 */
describe("ambient contrast budget", () => {
  /* 板子不吃光（见 architecture-boundaries 的 "keeps the ambient field on the
   * ground"），所以受照的只剩地面一档。raised / overlay 退出；sunken 本来就不在
   * ——侧栏、输入框、进度槽自己画不透明底，光到不了它们背后。 */
  const GROUND = "--surface-base";
  const STEPS = 21;

  /** 区域 → 伴色的对照，同样从 [data-domain] 规则里读。 */
  const COMPANION_OF = new Map(
    [
      ...AMBIENT_CSS.matchAll(
        /\[data-domain="([a-z]+)"\]\s*\{[^}]*--domain-companion:\s*var\(--domain-([a-z]+)\)/g,
      ),
    ].map((match) => [match[1]!, match[2]!] as const),
  );

  it("every domain declares a companion", () => {
    expect(DOMAIN_NAMES.length).toBeGreaterThanOrEqual(9);
    expect([...COMPANION_OF.keys()].sort()).toEqual([...DOMAIN_NAMES].sort());
    /* 伴色是「色环上的下一支」，所以不能指回自己——那样第二团就白加了。 */
    for (const [domain, companion] of COMPANION_OF) expect(companion).not.toBe(domain);
  });

  for (const theme of ["light", "dark"] as const) {
    const t = themeTokens(theme);
    const p = palette();

    const geometry = Object.fromEntries(
      AMBIENT_LIGHTS.map((light) => [
        light.name,
        {
          ...lightRadii(light.name),
          cx: restingCenter(`x${light.axis}`),
          cy: restingCenter(`y${light.axis}`),
          mix: Number.parseInt(t[`--ambient-mix-${light.name}`]!, 10) / 100,
        },
      ]),
    );

    const vignette =
      /linear-gradient\((\d+)deg, var\(--ambient-vignette\), transparent (\d+)%\)/.exec(AMBIENT_CSS)!;
    const vignetteDeg = Number.parseInt(vignette[1]!, 10);
    const vignetteStop = Number.parseInt(vignette[2]!, 10) / 100;
    const vignetteAlpha =
      Number.parseInt(
        /--ambient-vignette:\s*color-mix\(in srgb, var\(--surface-sunken\) (\d+)%/.exec(
          AMBIENT_CSS,
        )![1]!,
        10,
      ) / 100;

    /** 一个采样点上，把四层按 CSS 的顺序（先声明的画在上面）叠出来的地面色。 */
    function surfaceAt(
      domainTint: string,
      companionTint: string,
      accentTint: string,
      x: number,
      y: number,
    ): string {
      let surface = washOver(t["--surface-sunken"]!, vignetteAlpha * linearAt(vignetteDeg, vignetteStop, x, y), t[GROUND]!);
      surface = washOver(accentTint, geometry.accent!.mix * radialAt(geometry.accent!, x, y), surface);
      surface = washOver(companionTint, geometry.companion!.mix * radialAt(geometry.companion!, x, y), surface);
      return washOver(domainTint, geometry.domain!.mix * radialAt(geometry.domain!, x, y), surface);
    }

    /** 强调色四选一都可能被用户选中，两个模式都取 500 档。 */
    const accentFills = ACCENTS.map((accent) => token(p, `--palette-${accent}-500`));

    it(`${theme}: muted text keeps AA everywhere on the lit ground`, () => {
      let worst = { ratio: Infinity, label: "" };
      for (const domain of DOMAIN_NAMES) {
        const domainTint = t[`--domain-${domain}`]!;
        const companionTint = t[`--domain-${COMPANION_OF.get(domain)!}`]!;
        for (const accentTint of accentFills) {
          for (let i = 0; i < STEPS; i += 1) {
            for (let j = 0; j < STEPS; j += 1) {
              const x = (i / (STEPS - 1)) * 100;
              const y = (j / (STEPS - 1)) * 100;
              const surface = surfaceAt(domainTint, companionTint, accentTint, x, y);
              const ratio = contrastRatio(t["--text-muted"]!, surface);
              if (ratio < worst.ratio) {
                worst = { ratio, label: `${domain} + ${accentTint} @ (${x}%, ${y}%) → ${surface}` };
              }
            }
          }
        }
      }
      expect(worst.ratio, `${theme} 最差一处：${worst.label}`).toBeGreaterThanOrEqual(AA_TEXT);
    });

    /* 「只有左上角有背景」是这套光场修过的原始症状：圆心太靠外、停止点又太早，
     * 光在过中线之前就断干净，整屏大半是死平的底色。这条守的就是那件事不再发生
     * ——每一个采样点都得有肉眼分得出的颜色。 */
    it(`${theme}: the field covers the whole viewport, no dead flat corner`, () => {
      const ground = hexChannels(t[GROUND]!);
      for (const domain of DOMAIN_NAMES) {
        const domainTint = t[`--domain-${domain}`]!;
        const companionTint = t[`--domain-${COMPANION_OF.get(domain)!}`]!;
        for (let i = 0; i < STEPS; i += 1) {
          for (let j = 0; j < STEPS; j += 1) {
            const x = (i / (STEPS - 1)) * 100;
            const y = (j / (STEPS - 1)) * 100;
            const lit = hexChannels(surfaceAt(domainTint, companionTint, accentFills[0]!, x, y));
            const delta = Math.max(...lit.map((channel, k) => Math.abs(channel - ground[k]!)));
            expect(delta, `${theme} ${domain} @ (${x}%, ${y}%) 与干净地面无差`).toBeGreaterThanOrEqual(2);
          }
        }
      }
    });
  }

  /* 上面那个最差值是按静止坐标算的，而圆心会漂。这条守的是几何本身：每团只许
   * 沿着「离视口更远」的方向漂。
   *
   * 只查一个轴：离圆心最近的那个视口内的点就在圆心正对面，另一轴的差为零，椭圆
   * 距离退化成单轴的 |Δ|/r。另一轴漂多远都不改变峰值，这一轴漂近一点就会。 */
  it("ambient drift never brings a light closer than its resting clearance", () => {
    const keyframeStops = (frames: string, name: string): number[] => {
      const block = new RegExp(`@keyframes\\s+${frames}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(AMBIENT_CSS);
      return [...block![1]!.matchAll(new RegExp(`--${name}:\\s*(-?[\\d.]+)%`, "g"))].map((match) =>
        Number.parseFloat(match[1]!),
      );
    };
    /* 贴下边的间距 = y-100，贴右边的 = x-100，贴上边的 = -y。 */
    const clearanceOf = (edge: string, value: number): number =>
      edge === "top" ? -value : value - 100;

    for (const light of AMBIENT_LIGHTS) {
      const axis = light.edge === "right" ? `x${light.axis}` : `y${light.axis}`;
      const rest = clearanceOf(light.edge, restingCenter(axis));
      expect(rest, `${light.name} 静止时圆心必须在视口外`).toBeGreaterThan(0);

      const stops = keyframeStops(`ambient-drift-${light.name}`, `ambient-${axis}`);
      expect(stops.length, `${light.name} 的关键帧里没写 --ambient-${axis}`).toBeGreaterThan(0);
      for (const value of stops) {
        expect(
          clearanceOf(light.edge, value),
          `${light.name} 漂到 --ambient-${axis}: ${value}% 时比静止更靠近视口`,
        ).toBeGreaterThanOrEqual(rest);
      }
    }
  });
});

/* ── 色渍上的文字档 ─────────────────────────────────────────
 *
 * --brand-tint 与 --domain-tint 是压在 raised 上的一层色渍，不是阶梯上的一档。
 * 板子停用环境光之后它们不再被照，但文字档仍旧不能照抄 raised 那套：色渍本身
 * 就把面推离了 raised，浅色推暗、深色推亮，两边都在吃对比度。
 *
 * 这一组盯的是余量而不是及格线。--text-muted 压在色渍上实测最差 4.91（浅）／
 * 4.51（深）——名义上过了 AA，可 0.01 的余量等于没有，色渍浓度动一格就掉出去。
 * 所以色渍上一律 --text-secondary；品牌色压在自家色渍上走 --brand-on-tint。
 * 最后那条负向断言把「muted 在色渍上没有余量」钉成事实：哪天它真宽裕了，这里
 * 会失败，提醒把规则本身重新想一遍，而不是让规则悬在一个已经不成立的理由上。 */
describe("tinted surface ink", () => {
  /** 色渍名 → 色值，两个模式各算一遍。 */
  function tintsOf(t: Record<string, string>): Map<string, string> {
    const mix = Number.parseInt(t["--domain-mix-tint"]!, 10) / 100;
    const tints = new Map([["brand", t["--brand-tint"]!]]);
    for (const domain of DOMAIN_NAMES) {
      tints.set(domain, washOver(t[`--domain-${domain}`]!, mix, t["--surface-raised"]!));
    }
    return tints;
  }

  for (const theme of ["light", "dark"] as const) {
    const t = themeTokens(theme);

    it(`${theme}: secondary ink clears AA on every tint`, () => {
      for (const [name, tint] of tintsOf(t)) {
        expect(contrastRatio(t["--text-secondary"]!, tint), `${theme} ${name} 色渍`).toBeGreaterThanOrEqual(
          AA_TEXT,
        );
      }
    });

    it(`${theme}: brand ink on its own tint goes through --brand-on-tint`, () => {
      expect(contrastRatio(t["--brand-on-tint"]!, t["--brand-tint"]!)).toBeGreaterThanOrEqual(AA_TEXT);
      /* 选中的页签既压在色渍上、也可能压在板面上，两种底都得站得住。 */
      expect(contrastRatio(t["--brand-on-tint"]!, t["--surface-raised"]!)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it(`${theme}: muted ink has no headroom left on a tint, which is why it is banned there`, () => {
      const worst = Math.min(
        ...[...tintsOf(t).values()].map((tint) => contrastRatio(t["--text-muted"]!, tint)),
      );
      expect(worst).toBeLessThan(AA_TEXT + 0.5);
    });
  }
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

  it("keeps the document body on the app field throughout bootstrap", () => {
    const entry = readFileSync(resolve(repoRoot, ENTRY_FILE), "utf8");

    expect(entry).toMatch(
      /html\s+body\s*\{[\s\S]*?background:\s*var\(--surface-sunken\)/,
    );
  });
});
