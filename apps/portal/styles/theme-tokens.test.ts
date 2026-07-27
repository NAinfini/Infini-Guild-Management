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
];

/** 唯一允许出现 hex 的文件。 */
const PALETTE_FILE = "apps/portal/styles/tokens.css";
/** L2 语义层：所有 --accent-* / --text-* 的分模式、分主色定义处。 */
const SEMANTIC_FILE = "apps/portal/styles/semantic.css";
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
];
/** --mantine-color-* 系列由 Mantine 的 CSS 变量解析器批量写入运行期
 * （@mantine/core 的 MantineCssVariables），逐个列名不现实，按前缀豁免。 */
const MANTINE_COLOR_PREFIX = "--mantine-color-";

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

  /* Known blind spot (task-6 review I-3): this rule only matches literal
   * #hex. Functional color notations — rgb()/rgba()/hsl() etc. — are not
   * matched at all, even when they spell out the same mode-independent
   * literal (e.g. `rgb(255 255 255)`) that rule 2 exists to catch in hex
   * form. Sites using those are expected to carry an inline comment
   * explaining why the literal is mode-independent (see AuthPages.css around
   * the mask and glass-highlight rules for examples). Task 9 needs to decide
   * whether to widen this rule to cover functional notation or formalize an
   * explicit allowlist keyed off that comment — widening it naively would
   * also flag semantic.css's own rgb()-based shadows, which are a separate,
   * already-reviewed case. */
  it("rule 2: no bare hex outside the palette file", () => {
    const offenders: string[] = [];
    for (const { path, source } of readMigrated()) {
      if (path === PALETTE_FILE) continue;
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
      const hits = withoutComments.match(/#[0-9a-fA-F]{3,8}\b/g);
      if (hits) offenders.push(`${path}: ${[...new Set(hits)].join(", ")}`);
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

    /* 「有定义」= MIGRATED 集合里任意一处 `^\s*--name\s*:`，跨文件算数
     * （例如 .star-border 在 styles.css 内自定义的三个变量，定义与消费同文件）。 */
    const defined = new Set<string>();
    for (const { source } of files) {
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of withoutComments.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)) {
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
});
