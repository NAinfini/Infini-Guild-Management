// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const palettePath = resolve(process.cwd(), "apps/portal/styles/tokens.css");
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;
const accents = ["teal", "indigo", "violet", "orange"] as const;

function palette(): Record<string, string> {
  const values: Record<string, string> = {};
  const source = readFileSync(palettePath, "utf8");
  for (const [, name, value] of source.matchAll(/(--palette-[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)) {
    values[name!] = value!;
  }
  return values;
}

function token(values: Record<string, string>, name: string): string {
  const value = values[name];
  if (value === undefined) throw new Error(`missing palette token ${name}`);
  return value;
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(first: string, second: string): number {
  const luminance = (hex: string) => {
    const value = hex.replace("#", "");
    return 0.2126 * channel(Number.parseInt(value.slice(0, 2), 16))
      + 0.7152 * channel(Number.parseInt(value.slice(2, 4), 16))
      + 0.0722 * channel(Number.parseInt(value.slice(4, 6), 16));
  };
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

describe("WCAG token contrast", () => {
  it("keeps text and selectable accent text readable on their active surfaces", () => {
    const values = palette();

    expect(contrastRatio(token(values, "--palette-neutral-800"), token(values, "--palette-neutral-25"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(token(values, "--palette-ink-warm"), token(values, "--palette-neutral-850"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(token(values, "--palette-neutral-500"), token(values, "--palette-neutral-25"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(token(values, "--palette-neutral-400"), token(values, "--palette-neutral-850"))).toBeGreaterThanOrEqual(AA_TEXT);

    for (const accent of accents) {
      expect(contrastRatio(token(values, `--palette-${accent}-700`), token(values, "--palette-neutral-0"))).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(token(values, `--palette-${accent}-500`), token(values, "--palette-neutral-850"))).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(token(values, `--palette-${accent}-900`), token(values, `--palette-${accent}-500`))).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("keeps essential progress fills distinct from their tracks", () => {
    const values = palette();

    for (const accent of accents) {
      expect(contrastRatio(token(values, `--palette-${accent}-700`), token(values, "--palette-neutral-50"))).toBeGreaterThanOrEqual(AA_NON_TEXT);
      expect(contrastRatio(token(values, `--palette-${accent}-500`), token(values, "--palette-neutral-950"))).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });
});
