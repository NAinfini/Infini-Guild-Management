import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function listSourceFiles(root: string, includeTests = false): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      result.push(...listSourceFiles(fullPath, includeTests));
      continue;
    }
    if (
      /\.(ts|tsx)$/.test(entry) &&
      (includeTests || (!entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")))
    ) {
      result.push(fullPath);
    }
  }
  return result;
}

function listStyleFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === "dist") continue;
      result.push(...listStyleFiles(fullPath));
      continue;
    }
    if (entry.endsWith(".css")) result.push(fullPath);
  }
  return result;
}

function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function hasHaloShadow(source: string): boolean {
  return [...source.matchAll(/box-shadow\s*:\s*([^;]+)/g)].some((match) =>
    /(?:^|,)\s*0\s+0\s+(?:[1-9]\d*|\.\d+)/.test(match[1] ?? ""),
  );
}

function readProjectFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

const forbiddenRawApiImportFragments = [
  "/api/client",
  "/api/queries/",
  "/api/mutations/",
  "@portal/api/queries",
  "@portal/api/mutations",
];

const removedUiPrimitiveNames = [
  "DepthButton",
  "DepthToggle",
  "InfiniMenu",
  "PortalCard",
  "FilterToolbar",
  "PageTabs",
  "ConfirmDialogProvider",
  "InfiniTable",
  "TablePagination",
  "FloatingSaveBar",
] as const;

function hasForbiddenRawApiImport(source: string): boolean {
  return forbiddenRawApiImportFragments.some((fragment) => source.includes(fragment));
}

describe("portal architecture boundaries", () => {
  it("detects forbidden raw API query and mutation imports in component source", () => {
    expect(hasForbiddenRawApiImport('import { apiRequest } from "../../api/client";')).toBe(true);
    expect(hasForbiddenRawApiImport('import { listEvents } from "../../api/queries/events";')).toBe(true);
    expect(hasForbiddenRawApiImport('import { saveEvent } from "../../api/mutations/events";')).toBe(true);
    expect(hasForbiddenRawApiImport('import { listEvents } from "@portal/api/queries/events";')).toBe(true);
    expect(hasForbiddenRawApiImport('import { saveEvent } from "@portal/api/mutations/events";')).toBe(true);
  });

  it("keeps portal components out of the raw API client layer", () => {
    const componentRoot = resolve(repoRoot, "apps/portal/components");
    const offenders = listSourceFiles(componentRoot)
      .filter((filePath) => !filePath.endsWith("architecture-boundaries.test.ts"))
      .filter((filePath) => hasForbiddenRawApiImport(readFileSync(filePath, "utf8")))
      .map((filePath) => relative(repoRoot, filePath).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
  });

  it("enforces raw API client import restrictions through eslint", () => {
    const eslintConfig = readProjectFile("eslint.config.js");

    expect(eslintConfig).toContain("**/api/client");
    expect(eslintConfig).toContain("**/api/queries/*");
    expect(eslintConfig).toContain("**/api/mutations/*");
  });

  it("keeps removed visual primitives out of portal component source", () => {
    const componentRoot = resolve(repoRoot, "apps/portal/components");
    const offenders = listSourceFiles(componentRoot)
      .filter((filePath) => !filePath.endsWith("architecture-boundaries.test.ts"))
      .filter((filePath) => {
        const source = readFileSync(filePath, "utf8");
        return removedUiPrimitiveNames.some((name) => new RegExp(`\\b${name}\\b`).test(source));
      })
      .map((filePath) => relative(repoRoot, filePath).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
  });

  it("does not restore the removed third-party UI dependencies", () => {
    const packageJson = JSON.parse(readProjectFile("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    expect(dependencies).not.toHaveProperty("cmdk");
    expect(dependencies).not.toHaveProperty("mantine-contextmenu");
    expect(dependencies).not.toHaveProperty("@tailwindcss/vite");
    expect(dependencies).not.toHaveProperty("tailwindcss");
    expect(dependencies).not.toHaveProperty("tailwind-merge");

    expect(readProjectFile("apps/portal/styles.css")).not.toContain("tailwindcss");
    expect(readProjectFile("apps/portal/vite.config.ts")).not.toContain("@tailwindcss");
  });

  it("keeps foundational Mantine styling in the theme instead of the global stylesheet", () => {
    const globalStyles = readProjectFile("apps/portal/styles.css");

    expect(globalStyles).not.toMatch(/\.mantine-[A-Za-z0-9_-]+/);
    expect(globalStyles).not.toContain("infini-menu");
    expect(readProjectFile("apps/portal/providers/ThemeProvider.tsx"))
      .toContain("ThemeProvider.module.css");
  });

  it("has one Mantine confirm adapter", () => {
    const portalRoot = resolve(repoRoot, "apps/portal");
    const offenders = listSourceFiles(portalRoot)
      .filter((filePath) => readFileSync(filePath, "utf8").includes("modals.openConfirmModal"))
      .map((filePath) => relative(repoRoot, filePath).replace(/\\/g, "/"));

    expect(offenders).toEqual(["apps/portal/hooks/useConfirmDialog.ts"]);
  });

  it("keeps glow, radial, blur-filter and 3D effects inside the protected MemberCard", () => {
    const cssRoot = resolve(repoRoot, "apps/portal");
    const memberCardPath = resolve(repoRoot, "apps/portal/components/shared/MemberCard.css");
    const forbiddenEffect =
      /radial-gradient|(?:^|[;{\s])filter\s*:\s*blur|text-shadow|perspective\s*:|transform-style\s*:\s*preserve-3d/m;
    const offenders = listStyleFiles(cssRoot)
      .filter((filePath) => filePath !== memberCardPath)
      .filter((filePath) => {
        const source = stripCssComments(readFileSync(filePath, "utf8"));
        return forbiddenEffect.test(source) || hasHaloShadow(source);
      })
      .map((filePath) => relative(repoRoot, filePath).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
  });

  it("does not animate layout properties", () => {
    const cssRoot = resolve(repoRoot, "apps/portal");
    const layoutTransition =
      /transition(?:-property)?\s*:[^;]*(?:width|height|padding|margin)/;
    const offenders = listStyleFiles(cssRoot)
      .filter((filePath) => layoutTransition.test(stripCssComments(readFileSync(filePath, "utf8"))))
      .map((filePath) => relative(repoRoot, filePath).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
  });

  it("allows backdrop blur only on the protected card and the full-screen Gallery overlay", () => {
    const cssRoot = resolve(repoRoot, "apps/portal");
    const allowed = new Set([
      "apps/portal/components/shared/MemberCard.css",
      "apps/portal/components/pages/GalleryPage.css",
    ]);
    const offenders = listStyleFiles(cssRoot)
      .filter((filePath) => stripCssComments(readFileSync(filePath, "utf8")).includes("backdrop-filter"))
      .map((filePath) => relative(repoRoot, filePath).replace(/\\/g, "/"))
      .filter((filePath) => !allowed.has(filePath));
    const galleryStyles = stripCssComments(
      readProjectFile("apps/portal/components/pages/GalleryPage.css"),
    );

    expect(offenders).toEqual([]);
    expect(galleryStyles.match(/backdrop-filter\s*:\s*blur\(12px\)/g)).toHaveLength(1);
    expect(galleryStyles).toMatch(/\.gallery-lb-overlay\s*\{[^}]*backdrop-filter/s);
  });

  it("uses only the 160-degree material gradient outside the protected MemberCard", () => {
    const cssRoot = resolve(repoRoot, "apps/portal");
    const memberCardPath = resolve(repoRoot, "apps/portal/components/shared/MemberCard.css");
    const offenders: string[] = [];

    for (const filePath of listStyleFiles(cssRoot).filter((path) => path !== memberCardPath)) {
      const source = stripCssComments(readFileSync(filePath, "utf8"));
      const gradients = [...source.matchAll(/linear-gradient\(\s*([^,\s]+)/g)]
        .map((match) => match[1]);
      if (source.includes("repeating-linear-gradient") || gradients.some((angle) => angle !== "160deg")) {
        offenders.push(relative(repoRoot, filePath).replace(/\\/g, "/"));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("uses one bounded 128px root grain instead of per-card texture effects", () => {
    const grainPath = resolve(
      repoRoot,
      "apps/portal/public/textures/forged-grain.png",
    );
    const grain = readFileSync(grainPath);
    const shellStyles = stripCssComments(
      readProjectFile("apps/portal/components/layout/AppShell.css"),
    );
    const allComponentStyles = listStyleFiles(resolve(repoRoot, "apps/portal/components"))
      .map((filePath) => stripCssComments(readFileSync(filePath, "utf8")))
      .join("\n");

    expect(grain.readUInt32BE(16)).toBe(128);
    expect(grain.readUInt32BE(20)).toBe(128);
    expect(shellStyles.match(/url\(\"\/textures\/forged-grain\.png\"\)/g)).toHaveLength(1);
    expect(shellStyles).toMatch(/\.app-content::before\s*\{[^}]*opacity:\s*0\.03/s);
    expect(shellStyles).toMatch(/\[data-theme="light"\] \.app-content::before\s*\{[^}]*opacity:\s*0\.02/s);
    expect(allComponentStyles.match(/forged-grain\.png/g)).toHaveLength(1);
  });

  it("keeps the pre-React splash free of decorative effect machinery", () => {
    const html = readProjectFile("apps/portal/index.html");

    expect(html).not.toContain("splash.js");
    expect(html).not.toContain("splash-canvas");
    expect(html).not.toContain("splash-glow");
    expect(html).not.toContain("splash-ring");
    expect(html).not.toContain("radial-gradient");
    expect(html).not.toContain("background-clip: text");
  });

  it("disables Zod JIT before loading the module graph under strict CSP", () => {
    const html = readProjectFile("apps/portal/index.html");
    const jitlessScriptIndex = html.indexOf('<script src="/zod-csp.js"></script>');
    const moduleEntryIndex = html.indexOf('<script type="module" src="/main.tsx"></script>');

    expect(jitlessScriptIndex).toBeGreaterThanOrEqual(0);
    expect(moduleEntryIndex).toBeGreaterThan(jitlessScriptIndex);
    expect(readProjectFile("apps/portal/public/zod-csp.js"))
      .toContain("__zod_globalConfig = { jitless: true }");
    expect(readProjectFile("apps/portal/main.tsx")).not.toContain("z.config({ jitless: true })");
  });

  it("does not reference deleted implementation-note or superseded plan files", () => {
    const portalRoot = resolve(repoRoot, "apps/portal");
    const deletedPlanReference =
      /task-[0-9][^\s)]*\.md|final-review\.md|docs[\\/]plans[\\/]2026-05-21-equipment-calculator-design\.md/;
    const offenders = [
      ...listSourceFiles(portalRoot, true),
      ...listStyleFiles(portalRoot),
    ]
      .filter((filePath) => deletedPlanReference.test(readFileSync(filePath, "utf8")))
      .map((filePath) => relative(repoRoot, filePath).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
  });
});
