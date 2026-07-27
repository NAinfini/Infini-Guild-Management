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
];

/** 唯一允许出现 hex 的文件。 */
const PALETTE_FILE = "apps/portal/styles/tokens.css";

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

/* ── 硬规则 1–4 ───────────────────────────────────────────── */

describe("theme token hard rules", () => {
  it("rule 1: no var() fallback values", () => {
    const offenders: string[] = [];
    for (const { path, source } of readMigrated()) {
      const hits = source.match(/var\(--[^,)]*,/g);
      if (hits) offenders.push(`${path}: ${hits.length} × ${hits[0]}`);
    }
    expect(offenders).toEqual([]);
  });

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

describe("accent contrast across all 6 theme × accent combinations", () => {
  const p = palette();

  /* 浅色模式三个表面 --surface-sunken / --surface-base / --surface-raised
   * 全部覆盖：sunken = neutral-50（三者中最暗）是最不利的文字底，
   * base = neutral-25、raised = neutral-0 依次更亮、更宽松。
   * 深色模式最不利 = 最亮的表面 --surface-raised。 */
  const LIGHT_GROUND = "--palette-neutral-25";
  const SUNKEN_GROUND = "--palette-neutral-50";
  const DARK_GROUND = "--palette-neutral-850";

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

/* ── 菜单单一真相的护栏（Task 3） ────────────────────────── */

/**
 * Task 3 曾在这里窄断言「菜单区块内 0 处 !important、0 处裸 hex」，因为当时
 * styles.css 还没迁完、进不了 MIGRATED。Task 4 把整个 styles.css 加进 MIGRATED
 * 之后，那两条已是 rule 2 / rule 3 的真子集（两条规则覆盖整个文件），故删除。
 *
 * 剩下这一条管的是 .tsx，MIGRATED 的四条 CSS 规则一条都覆盖不到，必须留着。
 */
const MENU_BLOCK_FILE = "apps/portal/styles.css";
const THEME_PROVIDER_FILE = "apps/portal/providers/ThemeProvider.tsx";

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
        `会无条件压过 ${MENU_BLOCK_FILE} 的菜单区块。菜单外观请写在那个区块里。实际内容：\n${argument}`,
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
