import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const portalRoot = resolve(repoRoot, "apps/portal");

/**
 * 已迁移到 token 层的 CSS 文件。每个迁移任务往这里追加自己那批，
 * Task 9 断言它等于磁盘上的全部 CSS 文件 —— 所以这不是可以留短的白名单。
 */
export const MIGRATED: string[] = [
  "apps/portal/styles/tokens.css",
  "apps/portal/styles/semantic.css",
  "apps/portal/styles/scale.css",
  "apps/portal/styles.css",
  "apps/portal/components/layout/AppShell.css",
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
  /* Task 7 批 A（task-7-addendum.md D 节）。 */
  "apps/portal/components/equipment-calc/EquipmentCalcModal.css",
  "apps/portal/components/feature/admin/AdminApiTest.css",
  /* Task 7 批 B（task-7-addendum.md D 节）。 */
  "apps/portal/components/shared/tiptap-editor.css",
  "apps/portal/components/feature/events/RecurringTemplateFormModal.css",
  "apps/portal/components/feature/events/EventCardsView.css",
  "apps/portal/components/feature/admin/AuditLogViewer.css",
  /* Task 7 批 C（task-7-addendum.md D 节）。 */
  "apps/portal/components/feature/events/EventDetailModal.css",
  "apps/portal/components/feature/admin/AdminGameDataSection.css",
  "apps/portal/components/feature/admin/AdminSystemSection.css",
  "apps/portal/components/shared/MemberCard.css",
  "apps/portal/components/feature/admin/AdminBadgesSection.css",
  "apps/portal/components/shared/media-gallery.css",
  "apps/portal/components/feature/events/EventMonthView.css",
  "apps/portal/components/shared/ProfileModal.module.css",
  "apps/portal/components/shared/FilterToolbar.css",
  "apps/portal/components/feature/admin/AdminMemberDetailModal.module.css",
];

/** 唯一允许出现 hex 的文件。 */
const PALETTE_FILE = "apps/portal/styles/tokens.css";
/** L2 语义层：所有 --accent-* / --text-* 的分模式、分主色定义处。 */
const SEMANTIC_FILE = "apps/portal/styles/semantic.css";
/** L3 标度层：尺寸标度，不表达颜色语义，但同样是「token 文件」本身，
 * 不是组件层，豁免 rule 6。 */
const SCALE_FILE = "apps/portal/styles/scale.css";
/** 入口文件，也是 Tailwind / Mantine 两处桥接块的所在。 */
const ENTRY_FILE = "apps/portal/styles.css";
const THEME_PROVIDER_FILE = "apps/portal/providers/ThemeProvider.tsx";

/**
 * rule 5 豁免表。这里的每一条在源码里都没有 `^\s*--name\s*:` 形式的定义 ——
 * 它们的值是运行期由某处 JS/库写进 style 的。没有出处的名字不许进这张表
 * （task-7-addendum.md A 节）。
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
  /* Mantine MantineProvider 在运行期写入（@mantine/core 的
   * esm/core/MantineProvider/MantineCssVariables/default-css-variables-resolver.mjs:35，
   * defaultCssVariablesResolver()）。Task 7 批 A 在 AdminApiTest.css 里去掉了
   * 这个变量的 var() 兜底（rule 1 不允许兜底），暴露出它并不落在
   * --mantine-color- 前缀下，需要单独列出处。 */
  "--mantine-font-family-monospace",
  /* EventCardAvatarStrip.tsx:71，在 .event-card__avatar-grid 根元素的 style
   * 上无条件内联写入（avatarSize 用 ?? AVATAR_MAX_SIZE 兜底，不会是
   * undefined）。Task 7 批 B 在 EventCardsView.css 里去掉了这个变量的 var()
   * 兜底（rule 1 不允许兜底），暴露出它是运行期注入而非 CSS 定义。 */
  "--event-card-avatar-size",
  /* --badge-color：管理员自选的任意色号，运行期由内联 style 无条件写入
   * （MemberCard.tsx:24 的 MemberBadge；AdminBadgesSection.tsx:102/194/231
   * 的表单预览、侧栏列表徽章、详情大徽章）。三处消费值都经
   * apps/shared/schemas/admin.ts 的 colorSchema 校验（min(1)，保证非空），
   * Task 7 批 C 在 MemberCard.css / AdminBadgesSection.css 里去掉了这个变量的
   * var() 兜底（rule 1 不允许兜底），暴露出它是运行期注入而非 CSS 定义。 */
  "--badge-color",
  /* --role-color：当前游戏配置的每个 role 的十六进制色号（activeGame.roles[].color，
   * 例如 apps/shared/games/definitions/yan-yun.ts），换一个游戏配置文件这个值就会变，
   * 不是本 token 系统固定枚举，运行期由 MemberRoleAvatar.tsx 无条件内联写入
   * （cfg.color 来自游戏配置，不会是 undefined），推理同 --badge-color。
   * Task 8 批 B 在 MemberCard.css 里去掉了这个变量的 var() 兜底。 */
  "--role-color",
  /* --swatch-color：色板/取色按钮各自的色号，来自 TipTapEditorToolbar.tsx /
   * TipTapEditorContextMenu.tsx 的 TEXT_COLORS / HIGHLIGHT_COLORS、
   * AdminBadgesSection.tsx 的 COLOR_PRESETS，以及 ToolsPage.tsx 的
   * recentColors（localStorage 持久化的用户历史取色，等同 class-1 数据），
   * 不在本任务范围内改名/改值，运行期由这四个文件的色板/色点按钮无条件
   * 内联写入。Task 8 批 B 在 tiptap-editor.css / AdminBadgesSection.css /
   * ToolsPage.css 里去掉了这个变量的 var() 兜底。 */
  "--swatch-color",
  /* --signup-dot-color：MySignupsCard.tsx 按事件类型拼出的 Mantine 色号字符串
   * （`var(--mantine-color-X-5, var(--accent-fill))`，X 来自 eventTypeTagColor()），
   * 随事件类型变化，运行期由该文件的色点 span 无条件内联写入。
   * Task 8 批 B 在 DashboardPage.css 里去掉了这个变量的 var() 兜底。 */
  "--signup-dot-color",
  /* --bubble-hue：BubbleBackground.tsx 每个气泡用确定性伪随机数生成的色相
   * （30-60 连续区间，seededRandom(42)），没有固定枚举，运行期由该组件
   * 无条件内联写入。Task 8 批 B 在 AuthPages.css 里去掉了这个变量的
   * var() 兜底。 */
  "--bubble-hue",
];
/** --mantine-color-* 系列由 Mantine 的 CSS 变量解析器批量写入运行期
 * （@mantine/core 的 MantineCssVariables），逐个列名不现实，按前缀豁免。 */
const MANTINE_COLOR_PREFIX = "--mantine-color-";

/**
 * CSS Color Module 的基础 + 扩展关键字色，逐个都是真实固定 RGB 值 ——
 * 唯二排除的两个关键字 `transparent` / `currentColor`（连同 `inherit`）不在
 * 此列：前者是恒定的 0 透明度，渲染结果与所在模式无关；后两个根本不是颜色，
 * 只是「沿用级联已经算出来的那个值」的引用，正是 token 系统想要的效果，
 * 本来就不构成绕过。 */
const CSS_NAMED_COLOURS: string[] = [
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque",
  "black", "blanchedalmond", "blue", "blueviolet", "brown", "burlywood",
  "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue", "cornsilk",
  "crimson", "cyan", "darkblue", "darkcyan", "darkgoldenrod", "darkgray",
  "darkgreen", "darkgrey", "darkkhaki", "darkmagenta", "darkolivegreen",
  "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen",
  "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise",
  "darkviolet", "deeppink", "deepskyblue", "dimgray", "dimgrey", "dodgerblue",
  "firebrick", "floralwhite", "forestgreen", "fuchsia", "gainsboro",
  "ghostwhite", "gold", "goldenrod", "gray", "grey", "green", "greenyellow",
  "honeydew", "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender",
  "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral",
  "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey",
  "lightpink", "lightsalmon", "lightseagreen", "lightskyblue",
  "lightslategray", "lightslategrey", "lightsteelblue", "lightyellow", "lime",
  "limegreen", "linen", "magenta", "maroon", "mediumaquamarine", "mediumblue",
  "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue",
  "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue",
  "mintcream", "mistyrose", "moccasin", "navajowhite", "navy", "oldlace",
  "olive", "olivedrab", "orange", "orangered", "orchid", "palegoldenrod",
  "palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff",
  "peru", "pink", "plum", "powderblue", "purple", "rebeccapurple", "red",
  "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen",
  "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray",
  "slategrey", "snow", "springgreen", "steelblue", "tan", "teal", "thistle",
  "tomato", "turquoise", "violet", "wheat", "white", "whitesmoke", "yellow",
  "yellowgreen",
];

/**
 * 逐个字面关键字色的检测，两端都设了边界。左边界排除字母/数字/下划线/双引号/
 * 单引号/句点/连字符：双引号、单引号是因为 `[data-accent="teal"]` /
 * `[data-accent='teal']` / `content: 'red'` 这类字符串字面量里的颜色词不是
 * 颜色（task-9-addendum.md E 节 + 复审 M-1 都实测过，本项目三个 accent 名恰好
 * 是 teal/indigo/violet，单引号写法是最可能真实撞上的一种）；句点是因为
 * `.gold { }` / `&.plum` 这类类选择器名不是颜色。右边界同理排除
 * `--palette-teal-500` 这类自定义属性名的一部分，并额外排除 `(`：
 * `tan(30deg)` 这类 CSS 函数名（如 rotate(calc(1deg * tan(30deg)))）在没有
 * 这层排除时会被误判成命中 "tan"。 */
function keywordColourHits(withoutComments: string): string[] {
  const re = new RegExp(`(?<![a-zA-Z0-9_"'.\\-])(${CSS_NAMED_COLOURS.join("|")})(?![a-zA-Z0-9_"'.\\-(])`, "gi");
  return [...withoutComments.matchAll(re)].map((match) => match[1]!.toLowerCase());
}

/**
 * 逐个字面 rgb()/rgba()/hsl()/hsla()/oklch()/oklab()/lab()/lch()/hwb()/color()
 * 调用。加 `i` 标志：CSS 函数名大小写不敏感（`RGBA(0,0,0,.5)` 是合法 CSS，
 * 复审 I-4 用这个输入验证过旧版没有 `i` 标志时会漏检，见 task-9-report.md 的
 * 变异证明）。`color` 用 `(?!-mix)` 负向断言排除 `color-mix(`——后者是本仓库
 * 大量在用的「颜色 + 透明度」合成写法，不该被这条规则当成新引入的字面颜色。
 *
 * 允许一层嵌套括号，只是为了不让内部的 `var(...)`/`color-mix(...)` 破坏配对；
 * 两层嵌套（例如 `rgb(calc(2 * (10 + 5)) 0 0)`）会匹配失败——这是已知限制，
 * 现实 CSS 里几乎不会写出这种嵌套（T-2），暂不处理。
 *
 * 紧接着的 `.filter` 是一条**有意放宽的近似，不是逐通道的精确判断**：只要调用
 * 里任意一个通道来自 var()，整个调用（含其余写死的通道）都会被放行。例如
 * AuthPages.css 的 `hsla(var(--bubble-hue), 60%, 60%, 0.1)` 只有色相来自
 * var()，饱和度/亮度/透明度三个通道都是字面量，也会被整体放行——这在当前仓库
 * 是可以接受的，因为这是唯一一处用例，放宽换来的假阴性面很小；但这不是通则：
 * 如果以后出现「色相来自 var()、但饱和度/亮度是刻意写死的另一个品牌值」这类
 * 真正该被拦下的写法，这条近似会连带放它一马，届时需要收紧为逐通道判断
 * （复审 I-4）。 */
function functionalColourHits(withoutComments: string): string[] {
  const re = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color(?!-mix))\(((?:[^()]|\([^()]*\))*)\)/gi;
  return [...withoutComments.matchAll(re)].filter((match) => !match[1]!.includes("var(")).map((match) => match[0]);
}

type LiteralColourExemption = {
  /** 定位这条豁免对应的选择器/规则块，方便回查源码。 */
  source: string;
  /** 为什么这个字面量是与模式无关的固定值，而不是被漏迁的主题色。 */
  reason: string;
  /** 这个出处贡献的具体字面量，逐次出现都要列出（同一值出现几次就写几次）。 */
  values: string[];
};

/**
 * rule 2 扩宽后的豁免表（task-9-addendum.md E 节）。结构照抄
 * inline-colour.test.ts 的 BARE_HEX_EXEMPTIONS：按文件索引，每条都写清楚
 * 选择器出处与理由，按值计次消耗，不是整文件豁免。
 *
 * 为什么豁免表在这里、而不是「找源码里挨着的说明注释」：rule 2 沿用现有的
 * 「先剥注释再扫」（这是为了不让 EventDetailModal.css 那种在注释里纯讲解历史
 * rgb() 数值的说明文字被误当成命中——剥注释前会先加进命中列表）。但先剥注释
 * 就意味着扫描函数看不到注释里写的豁免理由，没法用「附近有没有说明注释」当
 * 判据；所以豁免机制改成这张按文件+值索引的表，来源审计仍然要求：每一条
 * 豁免在这张表里有理由字段的同时，源码里对应站点也必须有一段说明性注释
 * （本批已逐处核实/补全，见 task-9-report.md），只是自动化检查依赖这张表，
 * 不依赖去解析注释文本。
 */
const LITERAL_COLOUR_EXEMPTIONS: Record<string, LiteralColourExemption[]> = {
  "apps/portal/components/feature/admin/AdminGameDataSection.css": [
    {
      source: ".admin-game-data__textarea 的内凹阴影（周围有注释）",
      reason: "文本域内凹阴影的黑色晕影，与模式无关的字面黑。",
      values: ["rgba(0, 0, 0, 0.06)"],
    },
  ],
  "apps/portal/components/feature/events/EventCardsView.css": [
    {
      source: ".event-card__raffle-winners-badge",
      reason: "徽章底色/文字已固定吃 --mantine-color-pink-5 / --mantine-color-white，不随 [data-theme] 变化，投影延续同一条设计决定保持固定，避免固定配色配一圈会变化的阴影。",
      values: ["rgba(0, 0, 0, 0.2)"],
    },
  ],
  "apps/portal/components/pages/AuthPages.css": [
    {
      source: ".login-page__card 的 box-shadow 外层投影",
      reason: "把玻璃卡片压在 BubbleBackground 的动态渐变之上，需要跟页面自身 [data-theme] 无关的固定压暗，理由同 tiptap-editor.css 的浮层投影先例。",
      values: ["rgba(0, 0, 0, 0.2)"],
    },
    {
      source: ".login-page__card 的 box-shadow 内嵌高光（已有注释）",
      reason: "玻璃卡片顶边固定的一缕白色高光，深浅两模式都是同一条白，没有对应的 L2/L3 token。",
      values: ["rgb(255 255 255 / 0.06)"],
    },
    {
      source: ".login-page__card::before 的 mask/-webkit-mask（已有注释）",
      reason: "mask 只读渐变的 alpha 通道来决定裁切范围，颜色通道从不参与渲染，任何不透明色效果等价，rgb(255 255 255) 只是「不透明」的约定写法。-webkit-mask 与 mask 各写了一遍，每个属性各出现两次（两段 linear-gradient）。",
      values: ["rgb(255 255 255)", "rgb(255 255 255)", "rgb(255 255 255)", "rgb(255 255 255)"],
    },
  ],
  "apps/portal/components/pages/DashboardPage.css": [
    {
      source: ".war-nav-btn svg / .war-share-btn svg 的图标描边投影",
      reason: "图标本身吃 currentColor 随主题反色，这层投影只是加一圈固定暗晕保证图标在任意背景上可辨识，理由同 media-gallery.css 的缩略图播放图标投影。两处选择器各贡献一次。",
      values: ["rgba(0, 0, 0, 0.35)", "rgba(0, 0, 0, 0.35)"],
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
      source: ".gallery-lb__caption / __uploader / __date / __count（已有注释，task-8 批 B）",
      reason: "灯箱信息条文字，与 .gallery-lb__close/.gallery-lb__nav 同一先例：遮罩恒为近黑，文字保持固定白色透明度而非表面/文字 token。",
      values: ["rgba(255, 255, 255, 0.95)", "rgba(255, 255, 255, 0.6)", "rgba(255, 255, 255, 0.4)", "rgba(255, 255, 255, 0.5)"],
    },
  ],
  "apps/portal/components/pages/GuildWarPage.css": [
    {
      source: ".war-history-compare-bar-fill--own / --enemy",
      reason: "往已经随主题变化的 --accent-fill / --status-danger 里固定混 26% 真白，做出一档更浅的「淡色版」——要的是「往真白提亮同一个比例」，不是把颜色带向某个表面 token（那是 --accent-tint 在深色模式的做法，效果不同）。两个选择器各贡献一次。",
      values: ["white", "white"],
    },
  ],
  "apps/portal/components/pages/ToolsPage.css": [
    {
      source: ".sandbox__recent-dot",
      reason: "给下面任意色号的 --swatch-color 描一圈固定轮廓，理由同 --swatch-color 本身（用户数据色，不随主题变化）。",
      values: ["rgba(0, 0, 0, 0.1)"],
    },
  ],
  "apps/portal/components/shared/MemberCard.css": [
    {
      source: ".member-role-avatar__role-circle",
      reason: "给下面任意色号的 --role-color 描一圈固定投影，理由同 --role-color 本身（当前游戏配置的数据色，不随主题变化）。",
      values: ["rgba(0, 0, 0, 0.25)"],
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
      reason: "浮层对话框背后的全屏遮罩。复审 I-7：这不是纯黑，是特意选的一个冷色调（slate-900，rgb(15, 23, 42)）遮罩，深浅两模式都用同一个值、不随 [data-theme] 反色。",
      values: ["rgba(15, 23, 42, 0.48)"],
    },
    {
      source: ".infini-tiptap-link-dialog 的投影（已有注释）",
      reason: "投影与上面的遮罩同一个冷色调（slate-900），不是纯黑，深浅两模式都固定不随 [data-theme] 变化。",
      values: ["rgba(15, 23, 42, 0.24)"],
    },
    {
      source: ".infini-tiptap-context-menu / __context-submenu / __find-replace 的投影（已有注释，理由同上）",
      reason: "浮层菜单/查找替换面板的投影，同一个冷色调（slate-900），不是纯黑，理由同 link-dialog。三处选择器各贡献一次。",
      values: ["rgba(15, 23, 42, 0.18)", "rgba(15, 23, 42, 0.18)", "rgba(15, 23, 42, 0.18)"],
    },
  ],
  "apps/portal/styles.css": [
    {
      source: '.mantine-Button-root[data-variant="filled"]::after 的斜向高光扫光',
      reason: "按钮自身填色上方的固定白色高光扫光，跟主色/主题无关——就像光源本身不会因为照到什么表面而变色。",
      values: ["rgb(255 255 255 / 0.15)"],
    },
    {
      source: ".mantine-Tooltip-tooltip 的 box-shadow",
      reason: "玻璃拟态投影 + 顶边高光，跟 AuthPages.css 的 .login-page__card 同一先例，两个值都固定、不随模式变化。",
      values: ["rgb(0 0 0 / 0.12)", "rgb(255 255 255 / 0.06)"],
    },
    {
      source: ".mantine-Modal-content.mantine-Modal-content 的外层投影",
      reason: "弹窗要在任意背景上都压出同等强度的浮起效果，理由同 .mantine-Tooltip-tooltip 与 .login-page__card。",
      values: ["rgb(0 0 0 / 0.2)"],
    },
  ],
  "apps/portal/styles/semantic.css": [
    {
      source: "[data-theme=\"light\"] 块的 --shadow-xs/sm/md/lg（复审 I-3，:41-44）",
      reason: "阴影不是可主题化的颜色——这四档中性色标度阴影本身就是设计如此的例外（task-9-addendum.md E 节），与 tokens.css 同类。此前用整文件跳过处理，复审 I-3 指出这会连带关掉这个文件里的关键字色检测且不按值计次，改成逐值登记：7 个值来自 4 条声明，rgb(10 10 15 / 0.06) 被 --shadow-xs 与 --shadow-md/--shadow-lg 的第二层各用一次，共 3 次。",
      values: [
        "rgb(10 10 15 / 0.06)",
        "rgb(10 10 15 / 0.08)",
        "rgb(10 10 15 / 0.04)",
        "rgb(10 10 15 / 0.10)",
        "rgb(10 10 15 / 0.06)",
        "rgb(10 10 15 / 0.14)",
        "rgb(10 10 15 / 0.06)",
      ],
    },
    {
      source: "[data-theme=\"dark\"] 块的 --shadow-xs/sm/md/lg（复审 I-3，:71-74）",
      reason: "同上，深色模式的另一套数值。rgb(0 0 0 / 0.16) 被 --shadow-sm/--shadow-md/--shadow-lg 的第二层各用一次，共 3 次。",
      values: [
        "rgb(0 0 0 / 0.20)",
        "rgb(0 0 0 / 0.24)",
        "rgb(0 0 0 / 0.16)",
        "rgb(0 0 0 / 0.28)",
        "rgb(0 0 0 / 0.16)",
        "rgb(0 0 0 / 0.32)",
        "rgb(0 0 0 / 0.16)",
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
 * 复审 M-2：光是「命中 ≤ 额度」还不够——那只防得住多出来的字面量，防不住
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
      if (entry === "dist" || entry === "node_modules") continue;
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

function readMigrated(): Array<{ path: string; source: string }> {
  return MIGRATED.map((path) => ({ path, source: readFileSync(resolve(repoRoot, path), "utf8") }));
}

/* ── 硬规则 1–5 ───────────────────────────────────────────── */

describe("theme token hard rules", () => {
  it("rule 1: no var() fallback values", () => {
    const offenders: string[] = [];
    for (const { path, source } of readMigrated()) {
      const hits = source.match(/var\(--[^,)]*,/g);
      if (hits) offenders.push(`${path}: ${hits.length} × ${hits[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  /* task-9-addendum.md E 节收口：曾经的已知盲区（rule 2 只认字面 #hex，
   * rgb()/rgba()/hsl()/hsla() 与 black/white 这类关键字色一概漏检）现在补上——
   * 见下面的 hex + literalColourOffenders 两段判断。semantic.css 的阴影档
   * （rgb(10 10 15 / …) / rgb(0 0 0 / …)）与 tokens.css 一样是设计如此的例外，
   * 但（复审 I-3 之后）不再整文件跳过——那 14 个值已按站点逐条登记进
   * LITERAL_COLOUR_EXEMPTIONS["apps/portal/styles/semantic.css"]，走跟其它
   * 文件完全一样的按值计次消耗路径。整文件跳过会连带关掉这个文件里的关键字色
   * 检测（万一有人在这里写死一个关键字色，例如 [data-theme="dark"] 里的
   * --status-danger: red，逐条登记不会有这个盲区），也不符合本文件其它地方
   * 反复强调的「按文件索引，不是整文件豁免」。 */
  it("rule 2: no bare hex, literal rgb()/rgba()/hsl()/hsla(), or literal named colour outside the palette/semantic files", () => {
    const offenders: string[] = [];
    for (const { path, source } of readMigrated()) {
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
    for (const { path, source } of readMigrated()) {
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
    for (const { path, source } of readMigrated()) {
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
      if (/(^|[\s,>+~(])\.dark\b/.test(withoutComments)) offenders.push(`${path}: .dark selector`);
      if (withoutComments.includes("data-mantine-color-scheme")) offenders.push(`${path}: data-mantine-color-scheme selector`);
    }
    expect(offenders).toEqual([]);
  });

  it("rule 5: every var() in migrated CSS resolves to a definition", () => {
    const files = readMigrated();

    /* 「有定义」= MIGRATED 集合里任意一处自定义属性声明，跨文件算数
     * （例如 .star-border 在 styles.css 内自定义的三个变量，定义与消费同文件）。
     *
     * 锚点是「行首」或「{ / ; 之后」，不能只认行首（task-7 修复轮次 1 修复
     * I4）：单行写法 `.foo { --x: 1px; }` 曾被行首版正则误判成未定义，逼得
     * Task 7 批 A 的实现者为了让这条测试变绿把 `--ring-glow` 的定义从单行拆成
     * 多行——测试在指挥代码风格，是测试的缺陷，不是代码的。`[{;]` 分支只放行
     * 紧跟在 `{` 或 `;` 后面（中间只许空白）的 `--name:`，`var(--x)` 里的名字
     * 后面接的是 `)` 不是 `:`，伪类 `:hover` 前面没有 `--`，两者都不会命中。 */
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
    /* 三层纪律（附录 G）此前零自动化约束：rule 5 的「已定义集合」是 MIGRATED
     * 里所有文件定义的并集，tokens.css / semantic.css 自己也在 MIGRATED 里，
     * 所以 L1 名字在 rule 5 眼里永远「已定义」——它管得了「有没有定义」，管不了
     * 「该不该在这一层用」。组件层 CSS 直接引用 var(--palette-teal-500) 或
     * var(--accent-600) 会被 rule 5 放行（task-7 修复轮次 1 修复 I3，变异
     * 测试见 task-7-report.md）。
     *
     * 只拦纯数字档位的 --accent-<digit>（--accent-50/600/900 这类），不拦
     * --accent-fill / --accent-text / --accent-tint / --accent-on-fill /
     * --accent-on-fill-hover / --accent-border / --accent-fill-hover 这些
     * L2 语义名——它们名字里同样带 "accent"，但不是纯数字后缀。 */
    const offenders: string[] = [];
    for (const { path, source } of readMigrated()) {
      if (path === PALETTE_FILE || path === SEMANTIC_FILE || path === SCALE_FILE || path === ENTRY_FILE) continue;
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
      const hits = [...withoutComments.matchAll(/var\((--[a-zA-Z0-9-]+)\)/g)]
        .map((match) => match[1]!)
        .filter((name) => name.startsWith("--palette-") || /^--accent-\d+$/.test(name));
      if (hits.length > 0) offenders.push(`${path}: ${[...new Set(hits)].join(", ")}`);
    }
    expect(offenders).toEqual([]);
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

/**
 * 从 tokens.css 里解析色值，而不是在测试里再抄一份 hex。
 * 抄一份就等于又造了一个真相来源，跟本任务要解决的问题一模一样。
 */
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
const ACCENTS = ["teal", "indigo", "violet"] as const;

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
      /* task-7 修复轮次 1 修复 I2：--accent-on-fill（900 墨）落在
       * --accent-fill-hover（600）上只有 3.16–3.50，不过 AA。反向断言把这个
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

/* ── Mantine light variant 的文字对比度（Task 4 修复轮次 1） ─────────── */

/**
 * Task 2 把三条金/铜/古铜色阶换成唯一一条 portal-accent 时，styles.css 里那份
 * Mantine 文字档覆盖只跟着改了 13 个库色阶，漏了 portal-accent 自己 —— 而它是
 * primaryColor，仓库里约 100 处 variant="light" 默认吃的就是它。缺口静默存在了
 * 两个任务，正说明它需要自动化盯防，故补这组断言。
 *
 * 被测值全部从「真正生效的那条声明」解出来，不在测试里抄 token 名或 hex ——
 * 理由同上面 palette() 的注释：抄一份就等于又造了一个真相来源。
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

/**
 * 在指定选择器块里找 `property: var(--x)` 的目标，找不到就抛出错误。
 *
 * H-2a：此前这里直接对整个 styles.css 做全文匹配，从不检查命中落在哪个选择器
 * 里 —— 于是把 `:root[data-theme="light"][data-theme="light"]`（0,3,0）削回
 * `[data-theme="light"]`（0,1,0）这种会让浅色下 13+2 条 Mantine 覆盖全部输给库
 * 后注入的 (0,2,0)、对比度整体回退的改动，守卫照样全绿。现在委托给已经具备
 * 选择器定位能力的 scopedForward，把「转发到哪个 token」与「住在哪个选择器
 * 下」一起钉住。报错语义与此前保持一致。 */
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
const PORTAL_ACCENT_LIGHT_SELECTOR = ':root[data-theme="light"][data-theme="light"]';

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

/** ThemeProvider 里 portal-accent 色阶的第 index 档。不在测试里抄一份，有人重排要跟着变。 */
function accentRampStep(index: number): string {
  const source = readFileSync(resolve(repoRoot, THEME_PROVIDER_FILE), "utf8");
  const marker = '"portal-accent": [';
  const open = source.indexOf(marker);
  if (open === -1) throw new Error(`${THEME_PROVIDER_FILE}: 找不到 portal-accent 色阶 —— 被改名或挪走了，请同步改这个测试。`);
  const steps = [...source.slice(open + marker.length, source.indexOf("]", open)).matchAll(/var\((--accent-[a-z0-9-]+)\)/g)]
    .map((match) => match[1]!);
  if (steps.length !== 10) throw new Error(`${THEME_PROVIDER_FILE}: Mantine 色阶必须正好 10 档，实际 ${steps.length} 档。`);
  const step = steps[index];
  if (step === undefined) throw new Error(`${THEME_PROVIDER_FILE}: portal-accent 取不到第 ${index} 档。`);
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
      const text = token(p, resolveToPalette(semantic, accent, forwardTarget(entry, PORTAL_ACCENT_LIGHT_SELECTOR, "--mantine-color-portal-accent-light-color", ENTRY_FILE)));
      const fill = token(p, resolveToPalette(semantic, accent, accentRampStep(MANTINE_LIGHT_PRIMARY_SHADE)));
      const failures = LIGHT_SURFACES
        .map((surface) => ({ surface, ratio: contrastRatio(text, over(fill, token(p, surface), MANTINE_LIGHT_FILL_ALPHA)) }))
        .filter(({ ratio }) => ratio < AA_TEXT)
        .map(({ surface, ratio }) => `${surface}: ${ratio.toFixed(2)}`);
      expect(
        failures,
        `--mantine-color-portal-accent-light-color 指向的档位在这些表面上不过 ${AA_TEXT}:1：\n${failures.join("\n")}`,
      ).toEqual([]);
    });

    it(`${accent}: subtle / transparent 与 <Text c> 的文字在三种浅色表面上都过 AA`, () => {
      /* --mantine-color-X-text 是 variant="subtle" / "transparent" 与 <Text c="…">
       * 取的那一档，直接画在表面上、没有淡色填充垫底。 */
      const text = token(p, resolveToPalette(semantic, accent, forwardTarget(entry, PORTAL_ACCENT_LIGHT_SELECTOR, "--mantine-color-portal-accent-text", ENTRY_FILE)));
      const failures = LIGHT_SURFACES
        .map((surface) => ({ surface, ratio: contrastRatio(text, token(p, surface)) }))
        .filter(({ ratio }) => ratio < AA_TEXT)
        .map(({ surface, ratio }) => `${surface}: ${ratio.toFixed(2)}`);
      expect(
        failures,
        `--mantine-color-portal-accent-text 指向的档位在这些表面上不过 ${AA_TEXT}:1：\n${failures.join("\n")}`,
      ).toEqual([]);
    });
  }

  it("styles.css 必须包含三段选择器 :root[data-theme=\"light\"][data-theme=\"light\"]（H-2a）", () => {
    /* 必须是三段：Mantine 自己那条 `:root[data-mantine-color-scheme="light"]`
     * 覆盖是 (0,2,0) 且注入在本文件之后，打平会赢。属性选择器自我重复
     * （[data-theme="light"][data-theme="light"]）把这条覆盖抬到 (0,3,0)，
     * 稳赢而不必依赖感叹号优先级。削回单段 [data-theme="light"]（0,1,0）会让
     * 这场特异性之争静默输掉——上面两个断言靠 forwardTarget 的选择器定位能
     * 拦住这个坑，这一条独立钉住选择器字面量本身，防止两者共用的解析路径
     * 同时失灵。 */
    expect(entry.includes(PORTAL_ACCENT_LIGHT_SELECTOR)).toBe(true);
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
/** 取 `createTheme(` 之后到括号配平为止的那段源码。 */
function createThemeArgument(source: string): string {
  const marker = "createTheme(";
  const open = source.indexOf(marker);
  if (open === -1) {
    throw new Error(`${THEME_PROVIDER_FILE}: 找不到 createTheme( —— Mantine 主题配置被挪走或改名了，请同步改这个测试。`);
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
  throw new Error(`${THEME_PROVIDER_FILE}: createTheme( 的括号没有配平，无法切出配置对象。`);
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

/* ── 菜单单一真相的护栏（Task 3） ────────────────────────── */

/**
 * Task 3 曾在这里窄断言「菜单区块内 0 处 !important、0 处裸 hex」，因为当时
 * styles.css 还没迁完、进不了 MIGRATED。Task 4 把整个 styles.css 加进 MIGRATED
 * 之后，那两条已是 rule 2 / rule 3 的真子集（两条规则覆盖整个文件），故删除。
 *
 * 剩下这一条管的是 .tsx，MIGRATED 的四条 CSS 规则一条都覆盖不到，必须留着。
 */
/** 取 `Menu.extend(` 之后到括号配平为止的那段源码。 */
function menuExtendArgument(source: string): string {
  const marker = "Menu.extend(";
  const open = source.indexOf(marker);
  if (open === -1) {
    throw new Error(`${THEME_PROVIDER_FILE}: 找不到 Menu.extend( —— 菜单的 Mantine 配置被挪走或改名了，请同步改这个测试。`);
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
  throw new Error(`${THEME_PROVIDER_FILE}: Menu.extend( 的括号没有配平，无法切出配置对象。`);
}

describe("menu single source of truth (Task 3)", () => {
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
  it("every migrated path exists on disk", () => {
    const onDisk = new Set(listCssFiles(portalRoot).map(toRepoPath));
    const missing = MIGRATED.filter((path) => !onDisk.has(path));
    expect(missing).toEqual([]);
  });

  it("MIGRATED covers every CSS file on disk — no silent white-list", () => {
    const onDisk = listCssFiles(portalRoot).map(toRepoPath).sort();
    const migrated = [...MIGRATED].sort();

    /* 这条断言是本计划的收口。它一红，说明有人加了 CSS 文件却没迁移它，
     * 或者把某个文件从名单里摘掉了。两种都是回归。 */
    expect(migrated).toEqual(onDisk);
  });
});
