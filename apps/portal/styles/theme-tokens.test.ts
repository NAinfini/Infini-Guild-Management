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

  it("rule 3: no !important", () => {
    const offenders: string[] = [];
    for (const { path, source } of readMigrated()) {
      const hits = source.match(/!important/g);
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

const AA_TEXT = 4.5;
const ACCENTS = ["teal", "indigo", "violet"] as const;

describe("accent contrast across all 6 theme × accent combinations", () => {
  const p = palette();

  /* 浅色模式最不利的文字底 = 纸底 --surface-base；深色模式最不利 = 最亮的表面 --surface-raised。 */
  const LIGHT_GROUND = "--palette-neutral-25";
  const DARK_GROUND = "--palette-neutral-850";

  for (const accent of ACCENTS) {
    it(`${accent}: light-mode accent text clears AA on paper`, () => {
      const ratio = contrastRatio(p[`--palette-${accent}-700`]!, p[LIGHT_GROUND]!);
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it(`${accent}: light-mode accent text clears AA on white cards`, () => {
      const ratio = contrastRatio(p[`--palette-${accent}-700`]!, p["--palette-neutral-0"]!);
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it(`${accent}: dark-mode accent text clears AA on the lightest dark surface`, () => {
      const ratio = contrastRatio(p[`--palette-${accent}-500`]!, p[DARK_GROUND]!);
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it(`${accent}: on-fill ink clears AA on the accent fill`, () => {
      const ratio = contrastRatio(p[`--palette-${accent}-900`]!, p[`--palette-${accent}-500`]!);
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it(`${accent}: mid stop is decorative only — it must NOT be used as text on white`, () => {
      /* 反向断言：500 档作为白底文字是不合格的，这正是它需要 700 档存在的理由。
       * 如果哪天有人把 --accent-500 直接当浅色模式文字用，这条会提醒他为什么不行。 */
      const ratio = contrastRatio(p[`--palette-${accent}-500`]!, p["--palette-neutral-0"]!);
      expect(ratio).toBeLessThan(AA_TEXT);
    });
  }

  it("body text clears AA in both modes", () => {
    expect(contrastRatio(p["--palette-neutral-800"]!, p["--palette-neutral-25"]!)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(p["--palette-neutral-100-warm"]!, p["--palette-neutral-850"]!)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("muted text clears AA in both modes", () => {
    expect(contrastRatio(p["--palette-neutral-500"]!, p["--palette-neutral-25"]!)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(p["--palette-neutral-400"]!, p["--palette-neutral-850"]!)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("token file coverage", () => {
  it("every migrated path exists on disk", () => {
    const onDisk = new Set(listCssFiles(portalRoot).map(toRepoPath));
    const missing = MIGRATED.filter((path) => !onDisk.has(path));
    expect(missing).toEqual([]);
  });
});
