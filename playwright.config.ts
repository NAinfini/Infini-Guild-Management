import { defineConfig, devices } from "@playwright/test";
import {
  E2E_INSPECTOR_PORT_BASE,
  E2E_PORT_BASE,
  E2E_SLOTS,
  originForSlot,
  type E2eOptions,
} from "./apps/portal/e2e/support/config";

/*
 * 站点和接口同一个源：worker 通过 ASSETS 绑定直接吐 apps/portal/dist，
 * 不再起 vite dev server（理由见 apps/portal/e2e/support/config.ts 的说明）。
 */

export default defineConfig<E2eOptions>({
  testDir: "apps/portal/e2e/specs",
  outputDir: "apps/portal/e2e/.artifacts",
  globalSetup: "./apps/portal/e2e/global-setup.ts",
  globalTeardown: "./apps/portal/e2e/global-teardown.ts",

  /*
   * 并行按槽位切，不按用例切。
   *
   * 以前串行的唯一理由是「本地只有一个 D1，它是所有用例共享的可变状态」。
   * 现在每个槽位有自己的 worker 实例、自己的 D1 和 R2（见下面的 webServer），
   * 数据层面互不可见，那条理由就不成立了。
   * fullyParallel 仍然关着：分发单位是文件，同一文件内的用例保持原有先后，
   * 文件级的模块状态（let stamp / let itemA 这类）照旧安全。
   */
  workers: E2E_SLOTS,
  fullyParallel: false,

  /*
   * 不重试。重试只会把真实的时序缺陷洗成偶发绿，
   * 而 e2e 抓的恰恰就是这类问题。
   */
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 45_000,
  expect: { timeout: 10_000 },
  /* CI 上多接一个 html reporter：它把 trace、截图和错误上下文收进
     playwright-report/，是失败后唯一能带出运行器的现场。open: never，
     不然 CI 上会去尝试拉起浏览器。 */
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"]],

  use: {
    /* baseURL 和 storageState 由 support/test.ts 的 fixture 按槽位给，
       配置在主进程求值，这里拿不到 TEST_PARALLEL_INDEX。 */
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    /*
     * 固定成英文：i18n 取 localStorage.locale，取不到就看 navigator.language。
     * 用例靠可访问名定位控件，语言飘一下全套选择器就散架。
     * 中文渲染本身由 specs/guest/locale.spec.ts 单独验证。
     */
    locale: "en-US",
    timezoneId: "UTC",
  },

  projects: [
    {
      name: "guest",
      testDir: "apps/portal/e2e/specs/guest",
      use: { ...devices["Desktop Chrome"], role: "guest" },
    },
    {
      name: "member",
      testDir: "apps/portal/e2e/specs/member",
      use: { ...devices["Desktop Chrome"], role: "member" },
    },
    {
      name: "admin",
      testDir: "apps/portal/e2e/specs/admin",
      use: { ...devices["Desktop Chrome"], role: "admin", trackArtifacts: true },
    },
  ],

  /*
   * 每个槽位一个 wrangler 实例：独立端口、独立 --persist-to（D1 + R2 都在里面）、
   * 独立 inspector 端口。worker 同时是接口和站点，所以不需要另起 vite。
   *
   * 这里**不**负责 build：所有槽位共读同一个 apps/portal/dist，让其中一个边跑
   * vite build 边让别的槽位对着半成品目录起服务是自找的麻烦。产物由
   * `pnpm test:e2e` 在启动 Playwright 之前构建；直接敲 `playwright test` 时，
   * globalSetup 的时间戳比对会当场报错并告诉你去跑 `pnpm build`。
   *
   * 每个槽位起服务前先跑一次 migrations apply：它是幂等的（已应用的会跳过），
   * 所以不需要任何「这份库是不是旧了」的判断逻辑，新建目录和已有目录走同一条路。
   * reuseExistingServer 关掉：e2e 必须自己起自己的实例。复用别人留下的进程意味着
   * 复用别人留下的库，那是「上一轮的残留伪装成这一轮的数据」最常见的来源；
   * 端口被占就当场报错，比静默跑在错误的库上强。
   */
  webServer: Array.from({ length: E2E_SLOTS }, (_, slot) => ({
    command: [
      `wrangler d1 migrations apply guild-portal-db --local`,
      ` --config apps/worker/wrangler.jsonc --persist-to apps/worker/.wrangler/e2e-${slot} && `,
      `wrangler dev --config apps/worker/wrangler.jsonc`,
      ` --persist-to apps/worker/.wrangler/e2e-${slot}`,
      ` --port ${E2E_PORT_BASE + slot} --inspector-port ${E2E_INSPECTOR_PORT_BASE + slot}`,
    ].join(""),
    url: `${originForSlot(slot)}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe" as const,
    stderr: "pipe" as const,
  })),
});
