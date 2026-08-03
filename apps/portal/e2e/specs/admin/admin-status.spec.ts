import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, readJson, test } from "../../support/test";

/*
 * 后台「系统状态」页签：健康面板、配置摘要复制，以及那台 API 测试控制台。
 *
 * 控制台是本页最重的控件，也是唯一一个「点下去会真的对整站发一串请求」的控件，
 * 所以只跑 System 这一类，理由是查过的，不是图省事：
 * 这一类九个端点里八个是 GET，剩下那个 PATCH /api/admin/analytics-settings
 * 在准备阶段被无条件跳过（api-test/request-builders.ts:457），根本发不出去。
 * 也就是说跑完它一行数据都不会变。
 *
 * 至于「Test All APIs」：那一轮会把目录里全部分类跑一遍，包含大量写接口。
 * 它自带完整的建-删闭环（每次运行自己开一个 system-test run，收尾时清理并删掉运行行），
 * 但整轮下来是分钟级，而且会在本轮 e2e 已经打开的运行之内再套一层运行。
 * 这里只断言这个按钮的可用状态，不真的按下去；目录本身、跳过规则、清理闭环
 * 都由 AdminApiTestEngine.test.ts 覆盖。
 */

type StatusData = { db: string; r2: string; ws: string; crons: string };

function statusLabel(value: string): string {
  if (value === "ok") return "Verified";
  if (value === "configured") return "Configured";
  return value.toUpperCase();
}

function healthTile(page: Page, label: string): Locator {
  return page.locator(".system-health-tile").filter({ hasText: label });
}
function apiConsole(page: Page): Locator {
  return page.locator(".api-console");
}
function debugConsole(page: Page): Locator {
  return page.locator(".api-debug");
}
/** 一类端点的整块卡片。用「运行」按钮定位，它的无障碍名就是分类名本身。 */
function category(page: Page, label: string): Locator {
  return page.locator(".api-cat").filter({ has: page.getByRole("button", { name: label, exact: true }) });
}
function runCategoryButton(scope: Locator, label: string): Locator {
  return scope.getByRole("button", { name: label, exact: true });
}

async function serverStatus(api: APIRequestContext): Promise<StatusData> {
  return await readJson(await api.get("/api/admin/status"), "读取系统状态") as StatusData;
}

/**
 * 打开状态页签。
 *
 * 健康日志、API 控制台、调试台三块默认都是折起的（AdminStatusTab.tsx），
 * 所以除了「只看健康面板」的用例，其余都得先把要用的那块摊开。
 */
async function openStatus(page: Page): Promise<void> {
  await page.goto("/admin?tab=status");
  await expect(page.getByRole("tab", { name: /Status/ })).toHaveAttribute("aria-selected", "true");
  await expect(apiConsole(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
}

/** 摊开一块折叠区；已经开着就什么都不做（跑起来时组件会自己把控制台掰开）。 */
async function expand(scope: Locator): Promise<void> {
  const toggle = scope.locator(".admin-status-toggle");
  if (await toggle.getAttribute("aria-expanded") === "true") return;
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

test("健康面板：四个服务的状态和延迟都如实来自接口，不是写死的绿灯", async ({ page, api }) => {
  const status = await serverStatus(api);
  await openStatus(page);

  await expect(healthTile(page, "D1")).toContainText(statusLabel(status.db));
  await expect(healthTile(page, "R2")).toContainText(statusLabel(status.r2));
  await expect(healthTile(page, "WS")).toContainText(statusLabel(status.ws));
  await expect(healthTile(page, "Crons")).toContainText(statusLabel(status.crons));

  /* 总览只看这四项服务；接口回包里还有延迟、时间戳之类的字段，不能一并拿去比。 */
  const values = [status.db, status.r2, status.ws, status.crons];
  const overall = values.every((value) => value === "ok")
    ? "Operational"
    : values.every((value) => value === "ok" || value === "configured")
      ? "Configured · runtime unverified"
      : "Degraded";
  await expect(page.locator(".system-health-overall")).toHaveText(overall);
  await expect(
    page.locator(".system-health-tile--latency"),
    "延迟格子必须是真实数字；显示成「—」说明这一栏根本没接上数据",
  ).toContainText(/^\d+/);
});

test("复制配置摘要：写进剪贴板的是当前这四项状态，不是一段模板文本", async ({ page, api, flow }) => {
  const status = await serverStatus(api);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await openStatus(page);

  /* 复制是纯前端动作，不该顺手再去问一遍服务端。 */
  await flow.clickWithoutApi(page.getByRole("button", { name: "Copy Config", exact: true }));

  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard, "剪贴板里得是刚才那次检查的结果").toContain(`DB: ${status.db}`);
  expect(clipboard).toContain(`R2: ${status.r2}`);
  expect(clipboard).toContain(`WS: ${status.ws}`);
  expect(clipboard).toContain(`Crons: ${status.crons}`);
  expect(clipboard, "还要带上这份摘要是什么时候抓的，否则贴到工单里没法判断新旧").toMatch(/Checked: \d{4}-\d{2}-\d{2}T/);
});

test("控制台默认折起：三块都收着，健康面板照常在；展开后端点总数和各分类之和对得上", async ({ page, flow }) => {
  await openStatus(page);

  /* 一进来最该看到的是四个服务的绿灯，而不是两屏控制台。 */
  await expect(healthTile(page, "D1")).toBeVisible();
  const healthLogCard = page.locator(".admin-status-card").filter({ has: page.locator(".admin-status-toggle") });
  for (const scope of [healthLogCard, apiConsole(page), debugConsole(page)]) {
    await expect(scope.locator(".admin-status-toggle")).toHaveAttribute("aria-expanded", "false");
  }
  await expect(page.locator(".api-cat__toggle").first(), "折起时分类列表不该露出来").toBeHidden();

  await flow.clickWithoutApi(apiConsole(page).locator(".admin-status-toggle"));

  const toggles = page.locator(".api-cat__toggle");
  const fractions = await page.locator(".api-cat__fraction").allInnerTexts();
  const total = fractions.reduce((sum, text) => sum + Number.parseInt(text.split("/")[1] ?? "0", 10), 0);
  expect(total, "分类里读不出端点数，后面的断言就没有意义了").toBeGreaterThan(0);
  await expect(
    apiConsole(page).getByText(`${total} endpoints`, { exact: true }),
    "顶上的总数要等于各分类端点数之和，对不上说明有一类被漏掉了",
  ).toBeVisible();

  const first = toggles.first();
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await flow.clickWithoutApi(first);
  await expect(first, "展开只是本地状态").toHaveAttribute("aria-expanded", "true");
  await flow.clickWithoutApi(first);
  await expect(first).toHaveAttribute("aria-expanded", "false");
});

test("跑 System 这一类：九个端点全过，控制台留下日志并明确报告已清理干净；清空按钮把两边都归零", async ({ page }) => {
  await openStatus(page);
  await expand(apiConsole(page));
  const cat = category(page, "System");
  const fraction = cat.locator(".api-cat__fraction");
  const totalText = await fraction.innerText();
  const total = Number.parseInt(totalText.split("/")[1] ?? "0", 10);
  expect(total, "System 这一类得有端点").toBeGreaterThan(0);

  await runCategoryButton(cat, "System").click();
  await expect(
    debugConsole(page).locator(".admin-status-toggle"),
    "一开跑就得把调试台掰开：结果正往里写、盒子却收着，等于按了运行什么都看不到",
  ).toHaveAttribute("aria-expanded", "true");
  await expect(fraction, "跑完之后这一类应当是满格").toHaveText(`${total}/${total}`, { timeout: 60_000 });
  await expect(cat.locator(".api-cat__status-dot--pass"), "有任何一个端点挂掉都不该是绿点").toBeVisible();
  await expect(cat.getByText("ERR", { exact: true }), "不允许出现请求失败").toHaveCount(0);

  /* 顶部统计：全过，因此只有 pass 一项，没有 fail 那一项。 */
  await expect(apiConsole(page).locator(".api-console__stat")).toHaveCount(1);
  await expect(apiConsole(page).locator(".api-console__stat-value")).toHaveText(String(total));

  /*
   * 控制台自己那次运行必须把自己清干净。
   * 这行结论是运行收尾时写进日志的，测的正是「跑测试不留垃圾」这条底线。
   */
  await expect(
    debugConsole(page).getByText("Teardown complete — every test row was deleted"),
    "控制台跑完必须明确报告自己清理干净了",
  ).toBeVisible();
  const logRows = debugConsole(page).locator(".api-debug__row");
  expect(await logRows.count(), "每个端点都该在调试台留下一行").toBeGreaterThanOrEqual(total);

  await debugConsole(page).getByRole("button", { name: "Clear console", exact: true }).click();
  await expect(logRows).toHaveCount(0);
  await expect(debugConsole(page).getByText("No test results yet. Run a category to see output here.")).toBeVisible();
  await expect(
    fraction,
    "清空要连结果一起清掉；只清日志会留下一份没有出处的成绩单",
  ).toHaveText(`0/${total}`);
});

test("停止按钮：跑起来之后能真的把这一轮掐掉，控制台回到空闲", async ({ page }) => {
  await openStatus(page);
  await expand(apiConsole(page));
  const cat = category(page, "System");
  const runAll = apiConsole(page).getByRole("button", { name: "Test All APIs", exact: true });
  await expect(runAll, "空闲时整体运行是可点的").toBeEnabled();

  await runCategoryButton(cat, "System").click();
  const stop = apiConsole(page).getByRole("button", { name: "Stop tests", exact: true });
  await expect(stop, "跑起来之后才会出现停止按钮").toBeVisible();
  await expect(runAll, "正在跑的时候不允许再开一轮").toBeDisabled();

  await stop.click();
  await expect(stop, "按下停止就该收工，而不是等它自己跑完").toHaveCount(0, { timeout: 60_000 });
  await expect(runAll).toBeEnabled();
  /* 中途掐掉也要走收尾：这一轮写没写东西都得有个明确交代。 */
  await expect(
    debugConsole(page).getByText("Teardown complete — every test row was deleted"),
    "中途停止同样要清理干净并留下结论",
  ).toBeVisible();
});
