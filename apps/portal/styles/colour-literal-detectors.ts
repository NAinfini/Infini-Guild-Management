import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Shared pure detectors for CSS and TSX color-contract tests. */

/** 列出 root 下所有 .tsx 文件，跳过 dist/node_modules 与 *.test.tsx。 */
export function listTsxFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "dist" || entry === "node_modules") continue;
      out.push(...listTsxFiles(full));
      continue;
    }
    if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

/**
 * CSS Color Module 的基础 + 扩展关键字色，逐个都是真实固定 RGB 值 ——
 * 唯二排除的两个关键字 `transparent` / `currentColor`（连同 `inherit`）不在
 * 此列：前者是恒定的 0 透明度，渲染结果与所在模式无关；后两个根本不是颜色，
 * 只是「沿用级联已经算出来的那个值」的引用，正是 token 系统想要的效果，
 * 本来就不构成绕过。
 */
export const CSS_NAMED_COLOURS: string[] = [
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
 * 颜色（本项目三个 accent 名恰好是 teal/indigo/violet）；句点是因为
 * `.gold { }` / `&.plum` 这类类选择器名不是颜色。右边界同理排除
 * `--palette-teal-500` 这类自定义属性名的一部分，并额外排除 `(`：
 * `tan(30deg)` 这类 CSS 函数名（如 rotate(calc(1deg * tan(30deg)))）在没有
 * 这层排除时会被误判成命中 "tan"。
 */
export function keywordColourHits(withoutComments: string): string[] {
  const re = new RegExp(`(?<![a-zA-Z0-9_"'.\\-])(${CSS_NAMED_COLOURS.join("|")})(?![a-zA-Z0-9_"'.\\-(])`, "gi");
  return [...withoutComments.matchAll(re)].map((match) => match[1]!.toLowerCase());
}

/**
 * 逐个字面 rgb()/rgba()/hsl()/hsla()/oklch()/oklab()/lab()/lch()/hwb()/color()
 * 调用。加 `i` 标志，因为 CSS 函数名大小写不敏感（`RGBA(0,0,0,.5)` 合法）。
 * `color` 用 `(?!-mix)` 负向断言排除 `color-mix(`——后者是本仓库
 * 大量在用的「颜色 + 透明度」合成写法，不该被这条规则当成新引入的字面颜色。
 *
 * 允许一层嵌套括号，只是为了不让内部的 `var(...)`/`color-mix(...)` 破坏配对；
 * 两层嵌套（例如 `rgb(calc(2 * (10 + 5)) 0 0)`）会匹配失败；仓库当前不使用该形态。
 *
 * 紧接着的 `.filter` 是一条**有意放宽的近似，不是逐通道的精确判断**：只要调用
 * 里任意一个通道来自 var()，整个调用（含其余写死的通道）都会被放行。例如
 * AuthPages.css 的 `hsla(var(--bubble-hue), 60%, 60%, 0.1)` 只有色相来自
 * var()，饱和度/亮度/透明度三个通道都是字面量，也会被整体放行——这在当前仓库
 * 是可以接受的，因为这是唯一一处用例，放宽换来的假阴性面很小；但这不是通则：
 * 如果出现「色相来自 var()、但其他通道是品牌字面值」的写法，应收紧为逐通道判断。
 */
export function functionalColourHits(withoutComments: string): string[] {
  const re = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color(?!-mix))\(((?:[^()]|\([^()]*\))*)\)/gi;
  return [...withoutComments.matchAll(re)].filter((match) => !match[1]!.includes("var(")).map((match) => match[0]);
}
