// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

// dist is build output and dot-directories hold tool state and test output —
// e2e/.artifacts traces carry copies of rendered page CSS that would otherwise
// trip every style rule after an aborted Playwright run.
function shouldSkipDirectory(entry: string): boolean {
  return entry === "dist" || entry === "node_modules" || entry.startsWith(".");
}

function listSourceFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (shouldSkipDirectory(entry)) continue;
      result.push(...listSourceFiles(fullPath));
      continue;
    }
    if (
      /\.(ts|tsx)$/.test(entry) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
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
      if (shouldSkipDirectory(entry)) continue;
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

/*
 * JSX 开标签的文本，从 `<` 读到配对的 `>`。
 *
 * 不能用 /<Paper[^>]*>/：className 里的模板串和 clsx 调用带着 `=>`、`?:` 和
 * 嵌套的 `>`，正则会在半路截断，标签后半段的类名就此看不见——公会战那张
 * `<Paper className={`guild-war-column-card ...`}>` 正是这样躲过下面这条规则的。
 */
function readOpeningTag(source: string, from: number): string {
  let depth = 0;
  let quote = "";
  for (let index = from; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return source.slice(from, index + 1);
  }
  return source.slice(from);
}

/** className= 后面那一段的原文：带引号的字面量，或配对花括号里的整个表达式。 */
function readClassNameExpression(tagText: string): string {
  const attribute = /className\s*=\s*/.exec(tagText);
  if (!attribute) return "";
  const start = attribute.index + attribute[0].length;
  const opener = tagText[start];
  if (opener === '"' || opener === "'") {
    const end = tagText.indexOf(opener, start + 1);
    return end < 0 ? "" : tagText.slice(start + 1, end);
  }
  if (opener !== "{") return "";
  let depth = 0;
  for (let index = start; index < tagText.length; index += 1) {
    if (tagText[index] === "{") depth += 1;
    else if (tagText[index] === "}" && (depth -= 1) === 0) return tagText.slice(start + 1, index);
  }
  return "";
}

/* 表达式里所有字符串字面量（含模板串）切成类名候选。三元、clsx、条件后缀
   （`... ${selected ? "x--selected" : ""}`）都落在字面量里，所以按字面量取就够。 */
function collectClassNames(expression: string, into: Set<string>): void {
  for (const literal of expression.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
    const text = literal[1] ?? literal[2] ?? literal[3] ?? "";
    for (const name of text.split(/[^\w-]+/)) {
      if (name) into.add(name);
    }
  }
}

const forbiddenRawApiImportFragments = [
  "/api/client",
  "/api/queries/",
  "/api/mutations/",
  "@portal/api/queries",
  "@portal/api/mutations",
];

function hasForbiddenRawApiImport(source: string): boolean {
  return forbiddenRawApiImportFragments.some((fragment) => source.includes(fragment));
}

const rawTimeConversionFragments = [
  "getTimezoneOffset",
  "toISOString().slice(",
  ".toLocaleDateString(",
  ".toLocaleTimeString(",
  "Intl.DateTimeFormat(",
];

function hasRawTimeConversion(source: string): boolean {
  return rawTimeConversionFragments.some((fragment) => source.includes(fragment));
}

const timeConversionExemptPaths = new Set([
  // 换算本身住在这里，注释里也要能写出被禁的写法长什么样。
  "apps/portal/utils/datetime.ts",
  /* 接口冒烟用例直接按服务端自己的说法造请求体：整条链路都在 UTC 里，从不换成本地
     给人看，所以它不属于这条规矩要管的「自己实现一套换算」。 */
  "apps/portal/components/feature/admin/api-test/request-builders.ts",
]);

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

  it("keeps glow, blur-filter and 3D effects inside the protected MemberCard", () => {
    const cssRoot = resolve(repoRoot, "apps/portal");
    const memberCardPath = resolve(repoRoot, "apps/portal/components/shared/MemberCard.css");
    /*
     * 径向渐变从「除 MemberCard 外一律禁止」改成「另有两个具名消费点」。
     *
     * 原规则想拦的是「每个组件各自发光」，但它连站点自己的环境层一起拦掉了，
     * 结果是全站没有任何光源、每页读成一块平色——这正是要修的问题本身。放开的
     * 是位置，不是数量：下面两处是仅有的两个消费点，别处出现照样算违规。
     *
     * 两条 toContain 是为了让这份豁免随用途一起过期：哪天这两处不再用径向渐变，
     * 断言会失败，提醒把名字从表里删掉，而不是留一条谁也不敢动的空豁免。
     */
    const radialOwners = new Map([
      ["apps/portal/styles/semantic.css", "环境光场 --ambient-field 的三团光"],
      ["apps/portal/styles.css", "空态图标井的光晕"],
    ]);
    const forbiddenEffect =
      /(?:^|[;{\s])filter\s*:\s*blur|text-shadow|perspective\s*:|transform-style\s*:\s*preserve-3d/m;
    const offenders = listStyleFiles(cssRoot)
      .filter((filePath) => filePath !== memberCardPath)
      .filter((filePath) => {
        const source = stripCssComments(readFileSync(filePath, "utf8"));
        const relativePath = relative(repoRoot, filePath).replace(/\\/g, "/");
        const strayRadial = source.includes("radial-gradient") && !radialOwners.has(relativePath);
        return strayRadial || forbiddenEffect.test(source) || hasHaloShadow(source);
      })
      .map((filePath) => relative(repoRoot, filePath).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
    for (const owner of radialOwners.keys()) {
      expect(stripCssComments(readProjectFile(owner))).toContain("radial-gradient");
    }
  });

  it("leaves the panel surface to .paperRoot instead of restating the ladder rung", () => {
    /*
     * Wiki 正文卡自己写过一句 background: var(--surface-raised)——和 .paperRoot
     * 给的颜色一模一样，所以多年没人看出它是多余的。同样的重复当时共六处。
     *
     * 值一样不等于可以各写各的：面板的材质出自 --plate-fill，阶梯档 --surface-*
     * 是它的原料。原料被当成材质直接用，同一件事就有了两份真相——材质哪天再长
     * 出别的层（曾经带过环境光），这六处不会跟着变，只有它们停在旧材质上。
     *
     * 拦的是「把面板已有的阶梯档再写一遍」。状态色渍（选中、告警）不在此列——
     * 那是有意换掉的一档，正是它要的效果。
     */
    const portalRoot = resolve(repoRoot, "apps/portal");

    /* 挂在 <Paper> / <Card> 上的类名，这些元素同时带着 .paperRoot。 */
    const panelClasses = new Set<string>();
    for (const filePath of listSourceFiles(portalRoot)) {
      const source = readFileSync(filePath, "utf8");
      for (const tag of source.matchAll(/<(?:Paper|Card)[\s>]/g)) {
        collectClassNames(readClassNameExpression(readOpeningTag(source, tag.index)), panelClasses);
      }
    }
    expect(panelClasses.size).toBeGreaterThan(0);
    /* 模板串里的类名必须收得到，这是这条规则曾经漏掉的那一类写法。 */
    expect(panelClasses.has("guild-war-column-card")).toBe(true);

    const offenders: string[] = [];
    for (const filePath of listStyleFiles(portalRoot)) {
      const source = stripCssComments(readFileSync(filePath, "utf8"));
      /* 页面常把阶梯档换个名字再用（如 --storage-plate），一并解析回去。 */
      const aliases = new Map(
        [...source.matchAll(/(--[\w-]+):\s*var\((--surface-[\w-]+)\)/g)]
          .map((match) => [match[1]!, match[2]!] as const),
      );
      for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const declared =
          /(?:^|[;{\s])background(?:-color)?\s*:\s*var\((--[\w-]+)\)\s*(?:;|$)/.exec(rule[2]!);
        if (!declared) continue;
        const resolved = aliases.get(declared[1]!) ?? declared[1]!;
        if (!resolved.startsWith("--surface-")) continue;
        const subjects = rule[1]!.split(",").map((selector) =>
          (selector.trim().split(/[\s>+~]+/).pop() ?? "").split(/[:[]/)[0]!.replace(/^\./, ""),
        );
        if (!subjects.some((subject) => panelClasses.has(subject))) continue;
        offenders.push(`${relative(repoRoot, filePath).replace(/\\/g, "/")}: ${rule[1]!.trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the ambient field on the ground: no panel carries the light", () => {
    /*
     * 光打在地面上，板子压在光上面，本身不透光。
     *
     * 反过来做过一版：板也铺同一张光图，靠 background-attachment: fixed 让每块
     * 板与地面像素对齐。它确实消掉了接缝，但代价是两条——
     *   · 全站正文的实际背景都被光改过，对比度预算得按「被照过的表面」算，
     *     浓度只能压到肉眼几乎看不见的一档；
     *   · 图贴着视口，板越高、板内明暗落差越大，一张顶到内容区底边的卡
     *     （见 A34）下半张读起来就是一块彩色。
     * 收回地面之后干净的板压在有色的地面上，反而分得更开。
     *
     * 这里拦三件事：光的图层跑出配方文件、板子把光重新拼回台面材质里、以及
     * --plate-glow 这个已经删掉的名字借尸还魂。
     */
    const portalRoot = resolve(repoRoot, "apps/portal");
    const recipeOwner = "apps/portal/styles/semantic.css";
    /* --ambient-field 只有地面和页头两个消费点，都在外壳里。 */
    const fieldConsumer = "apps/portal/components/layout/AppShell.css";

    const strayLayers: string[] = [];
    const strayField: string[] = [];
    const resurrectedGlow: string[] = [];
    for (const filePath of listStyleFiles(portalRoot)) {
      const relativePath = relative(repoRoot, filePath).replace(/\\/g, "/");
      const source = stripCssComments(readFileSync(filePath, "utf8"));
      if (relativePath !== recipeOwner && source.includes("--ambient-layer-")) {
        strayLayers.push(relativePath);
      }
      if (
        relativePath !== recipeOwner &&
        relativePath !== fieldConsumer &&
        source.includes("var(--ambient-field)")
      ) {
        strayField.push(relativePath);
      }
      if (source.includes("--plate-glow")) resurrectedGlow.push(relativePath);
    }

    expect(strayLayers).toEqual([]);
    expect(strayField).toEqual([]);
    expect(resurrectedGlow).toEqual([]);

    /* 台面材质是干净的一档表面色，配方还在它该在的地方。 */
    expect(stripCssComments(readProjectFile(recipeOwner))).toContain(
      "--plate-fill: var(--surface-raised);",
    );
  });

  it("routes page-level block spacing through the single --page-rhythm token", () => {
    /*
     * 页面块间距曾经是每页自己填的数：wiki 24、公告 16、活动/花名册/仓库 12。
     * 同一条「筛选栏到工作区」的缝因此各页宽窄不一，这条断言把它钉回一个来源。
     * 下面四个页面在 PageLayout 里再包一层 Stack 只为把剩余高度传下去，
     * 它们没有资格重新定义节奏。
     */
    const rhythmConsumers = [
      "apps/portal/components/layout/PageLayout.tsx",
      "apps/portal/components/pages/AnnouncementsPage.tsx",
      "apps/portal/components/pages/EventsPage.tsx",
      "apps/portal/components/pages/RosterPage.tsx",
      "apps/portal/components/pages/StoragePage.tsx",
    ];
    const offenders = rhythmConsumers
      .filter((path) => !readProjectFile(path).includes('gap="var(--page-rhythm)"'));

    expect(stripCssComments(readProjectFile("apps/portal/components/layout/PageLayout.css")))
      .toMatch(/--page-rhythm:\s*var\(--space-md\)/);
    expect(offenders).toEqual([]);
  });

  it("routes press displacement through the motion tokens so reduced motion degrades once", () => {
    /*
     * --motion-press / --motion-sink 在 scale.css 的 prefers-reduced-motion 块里
     * 一起归零，那是全站唯一的降级点。谁在 :active 里直接写 translateY(1px) 或
     * scale(.98)，谁就绕过了这个开关——用户关掉动效，那一处照样会动。
     */
    const cssRoot = resolve(repoRoot, "apps/portal");
    /* 恒等值不算位移：translate 的 0 和 scale 的 1 是「取消上一个状态」，不是动效，
       降级时也不需要归零。只有非恒等的字面量才是绕过开关。 */
    const identity: Record<string, number> = { translate: 0, translateX: 0, translateY: 0, scale: 1 };
    const offenders = listStyleFiles(cssRoot)
      .filter((filePath) => {
        const source = stripCssComments(readFileSync(filePath, "utf8"));
        return [...source.matchAll(/:active[^{]*\{([^}]*)\}/gs)].some((block) =>
          [...(block[1] ?? "").matchAll(/transform\s*:([^;}]*)/g)].some((declaration) =>
            [...(declaration[1] ?? "").matchAll(/(translate[XY]?|scale)\(\s*(-?[\d.]+)/g)].some(
              (call) => Number(call[2]) !== identity[call[1]!],
            ),
          ),
        );
      })
      .map((filePath) => relative(repoRoot, filePath).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
    expect(stripCssComments(readProjectFile("apps/portal/styles/scale.css")))
      .toMatch(/prefers-reduced-motion:\s*reduce\s*\)\s*\{\s*:root\s*\{[^}]*--motion-sink:\s*0px/s);
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
    /* 0.02/0.03 那一档在实机上等于没有：噪点是唯一一层让工作区不读成一块平色的
       材质，压到看不见就只剩「压制得很干净」这个自我安慰。抬到 0.035/0.05 后仍
       远低于会干扰正文的量级，但表面确实有了颗粒。 */
    expect(shellStyles).toMatch(/\.app-content::before\s*\{[^}]*opacity:\s*0\.05/s);
    expect(shellStyles).toMatch(/\[data-theme="light"\] \.app-content::before\s*\{[^}]*opacity:\s*0\.035/s);
    expect(allComponentStyles.match(/forged-grain\.png/g)).toHaveLength(1);
  });

  it("detects hand-rolled timezone conversion", () => {
    expect(hasRawTimeConversion("const offset = -new Date().getTimezoneOffset();")).toBe(true);
    expect(hasRawTimeConversion("const today = new Date().toISOString().slice(0, 10);")).toBe(true);
    expect(hasRawTimeConversion("return date.toLocaleDateString(locale);")).toBe(true);
    expect(hasRawTimeConversion("return d.toLocaleTimeString(locale, opts);")).toBe(true);
    expect(hasRawTimeConversion("new Intl.DateTimeFormat(locale).format(date)")).toBe(true);
    expect(hasRawTimeConversion('import { localDateKey } from "@portal/utils/datetime";')).toBe(false);
  });

  it("keeps every UTC↔local conversion inside utils/datetime.ts", () => {
    /* 后端存 UTC、界面显示本地，这中间的换算一散出去就会分叉：偏移的符号、「今天」
       是谁的今天、datetime-local 的串怎么读，每一处都能各写一套且都看着像对的。
       所以这些原语只准出现在 utils/datetime.ts 里，别处一律经它转手。 */
    const offenders = listSourceFiles(resolve(repoRoot, "apps/portal"))
      .map((filePath) => relative(repoRoot, filePath).replace(/\\/g, "/"))
      .filter((path) => !timeConversionExemptPaths.has(path) && !path.startsWith("apps/portal/e2e/"))
      .filter((path) => hasRawTimeConversion(readProjectFile(path)));

    expect(offenders).toEqual([]);
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
});
