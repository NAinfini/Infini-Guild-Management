// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("portal entrypoint", () => {
  it("disables Zod JIT before loading application schemas under the strict CSP", () => {
    const source = readFileSync(resolve(process.cwd(), "apps/portal/main.tsx"), "utf8");
    const configureIndex = source.indexOf("configureZod({ jitless: true })");
    const bootstrapIndex = source.indexOf('import("./bootstrap")');

    expect(configureIndex).toBeGreaterThan(-1);
    expect(bootstrapIndex).toBeGreaterThan(configureIndex);
  });

  it("routes asynchronous application bootstrap failures to the visible fatal state", () => {
    const entrypoint = readFileSync(resolve(process.cwd(), "apps/portal/main.tsx"), "utf8");
    const bootstrap = readFileSync(resolve(process.cwd(), "apps/portal/bootstrap.tsx"), "utf8");

    expect(entrypoint).toContain('.then(({ mountApp }) => mountApp(root))');
    expect(bootstrap).toContain("loadSiteConfig(),");
    /* fetchQuery 会抛出请求错误；prefetchQuery 会吞掉。这里锁住 fetchQuery，
       保证目录拉不下来时挂载中止、走可见的致命错误路径。 */
    expect(bootstrap).toContain("queryClient.fetchQuery(classCatalogQueryOptions),");
    expect(bootstrap).toContain("queryClient.fetchQuery(classTagsQueryOptions),");
    expect(bootstrap).not.toContain("prefetchQuery");
    expect(bootstrap).not.toContain("[bootstrap] Failed to load");
  });
});
