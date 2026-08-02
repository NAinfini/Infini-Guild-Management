import { readFileSync } from "node:fs";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, readJson, test } from "../../support/test";
import { field } from "../../support/ui";

/*
 * 后台「审计日志」页签的全部控件：搜索、时间预设分段、两个自定义日期框、筛选摘要上的
 * 清除按钮、行展开、分页（页码条 + 页码输入框）、CSV/JSON 导出、以及归档下载面板。
 *
 * 这一页所有筛选都是服务端做的，所以每一次操作都验到「请求真的带着这个条件发出去了」，
 * 再拿回来的 total / data 和界面对账——只看界面的话，前端在内存里过滤也能装得一样，
 * 而那样一超过一页就开始漏数据。
 *
 * 造数据的手法是「做一件会被记账的事」：建一个邀请码，服务端就会写下一行
 * entity_id = diff_title = 邀请码 id 的审计。这一行是本条用例独有的锚点，
 * 搜它就只剩一条，导出的内容也因此可以逐字断言。邀请码和审计行都会被
 * 系统测试注册表登记（audit.ts:84 会把每条审计行登记进本次运行），收尾时一起删掉。
 */

/*
 * 这个文件必须关掉 trace，原因是量出来的，不是猜的：
 * 开着 trace（配置里是 retain-on-failure，等于每条用例全程都在录）时，浏览器进程会在
 * 渲染进程那次 fetch 之外，对同一个导出 URL 再补发一次请求——服务端日志里两条 GET，
 * 而 page.on("request") 只看得到一条；补发的那条没有 X-Request-Id、没有系统测试运行头，
 * user-agent 是 HeadlessChrome 而不是上下文覆盖过的那个，可见它绕开了渲染进程。
 * 同一条用例加 --trace=off 再跑，服务端就只剩一条 GET。
 *
 * 后果有两个，都不能靠放宽断言绕过去：
 *   - 导出接口每被调一次就写一行审计（这是有意的留痕），补发那次于是多写一行，
 *     后一次导出算出来的 total 就凭空多一条；
 *   - 补发的请求没带运行头，那行审计不会被登记进本次运行，收尾时删不掉，
 *     站点指纹对不上（table:audit_log 多一行），整轮 e2e 以「有数据没清干净」告终。
 * 两者都源自量测工具本身，不是产品缺陷，所以关掉的是工具，断言保持严格。
 * trace 只能在文件级设置（放进 describe 会被 Playwright 拒绝），所以这一整个文件都不录；
 * 需要排查时把下面这行注释掉重跑，只是别把导出那条的结果当真。
 */
test.use({ trace: "off" });

const AUDIT_LOG_PATH = "/api/admin/audit-log";
const PAGE_SIZE = 50;

type AuditRow = {
  id: string;
  entity_type: string;
  action: string;
  entity_id: string;
  diff_title: string | null;
  detail_text: string | null;
};
type AuditPage = { data: AuditRow[]; total: number };

/**
 * 默认时间范围：昨天 00:00 到今天 23:59（useAdminAuditFilter.ts:38）。
 * 浏览器时区被固定成 UTC，所以这里也一律按 UTC 取日期，两边才对得上。
 */
function utcDay(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}
function startOf(day: string): string {
  return `${day}T00:00:00.000Z`;
}
function endOf(day: string): string {
  return `${day}T23:59:59.999Z`;
}

function toolbar(page: Page): Locator {
  return page.locator(".admin-toolbar");
}
function searchBox(page: Page): Locator {
  return page.getByLabel("Search audit logs", { exact: true });
}
function auditRows(page: Page): Locator {
  return page.locator(".audit-log-row");
}
function auditRowFor(page: Page, text: string): Locator {
  return page.locator(".audit-log-row").filter({ hasText: text });
}
function filterSummary(page: Page): Locator {
  return page.locator(".admin-filter-summary");
}
function filterChip(page: Page, text: string): Locator {
  return page.locator(".admin-filter-chip").filter({ hasText: text });
}
/*
 * Mantine 的 SegmentedControl 把真正的 radio 藏了起来，可点的是它的 label；
 * 按 role 取到的是隐藏 input，点它会一直等「元素可见」直到超时。
 */
function preset(page: Page, label: string): Locator {
  return page.locator("label.mantine-SegmentedControl-label").filter({ hasText: new RegExp(`^${label}$`) });
}
/*
 * Mantine 的 Pagination 只给首/末/前/后四颗控件配了 aria-label，页码本身的无障碍名
 * 就是那个数字。限定在分页条里取，免得撞上页面上别处同名的按钮。
 */
function pageButton(page: Page, name: string): Locator {
  return page.locator(".mantine-Pagination-root").getByRole("button", { name, exact: true });
}

/**
 * 触发一次导出并等服务端把文件吐出来。
 * 这里不复用 flow.click：导出的响应体会被页面拿去建 blob 下载，读第二遍拿到的是空的。
 * 内容对不对由落盘的文件来断言，这一步只负责钉住「请求发了、服务端接了」。
 */
async function clickExport(page: Page, item: Locator, contentType: string): Promise<void> {
  const waiter = page.waitForResponse((response) => (
    response.request().method() === "GET"
    && new URL(response.url()).pathname === "/api/admin/audit-log/export"
  ));
  await item.click();
  const response = await waiter;
  expect(response.status(), "导出接口").toBe(200);
  expect(response.headers()["content-type"], "导出的类型").toContain(contentType);
}

/**
 * 等一次审计列表请求，并要求它带着预期的查询参数（值写 null 表示这个参数必须不存在）。
 * 返回服务端的响应体，好让调用方拿 total / data 和界面对账。
 */
async function expectAuditRequest(
  page: Page,
  action: () => Promise<void>,
  expected: Record<string, string | null>,
): Promise<AuditPage> {
  const waiter = page.waitForResponse((response) => {
    if (response.request().method() !== "GET") return false;
    const url = new URL(response.url());
    if (url.pathname !== AUDIT_LOG_PATH) return false;
    return Object.entries(expected).every(([key, value]) => (
      value === null ? !url.searchParams.has(key) : url.searchParams.get(key) === value
    ));
  });
  await action();
  const response = await waiter;
  expect(response.ok(), `审计列表请求返回 ${response.status()}`).toBe(true);
  return await response.json() as AuditPage;
}

/** 进审计页签，并把首屏那次取数接住。 */
async function openAudit(page: Page): Promise<AuditPage> {
  const first = await expectAuditRequest(page, () => page.goto("/admin?tab=audit").then(() => undefined), {
    page: "1",
    limit: String(PAGE_SIZE),
    start_at: startOf(utcDay(-1)),
    end_at: endOf(utcDay()),
  });
  await expect(page.getByRole("tab", { name: /Audit Log/ })).toHaveAttribute("aria-selected", "true");
  await page.waitForLoadState("networkidle");
  return first;
}

/** 做一件会被记账的事：建个邀请码，换回它在审计里的那行锚点。 */
async function makeAuditedEvent(api: APIRequestContext): Promise<{ id: string; code: string }> {
  return await readJson(
    await api.post("/api/admin/invite-links", { data: { max_uses: 5 } }),
    "创建邀请码以产生一行审计",
  ) as { id: string; code: string };
}

async function serverAudit(
  api: APIRequestContext,
  params: Record<string, string>,
): Promise<AuditPage> {
  const query = new URLSearchParams({ page: "1", limit: String(PAGE_SIZE), ...params });
  return await readJson(await api.get(`${AUDIT_LOG_PATH}?${query.toString()}`), "读取审计日志") as AuditPage;
}

async function expectNotified(page: Page, text: string): Promise<void> {
  await expect(
    page.locator(".mantine-Notification-description").filter({ hasText: text }),
    `没有弹出通知「${text}」`,
  ).toBeVisible();
}

/** 盯着 /api/ 证明这段操作没发请求。 */
async function expectNoApiCalls(page: Page, action: () => Promise<void>): Promise<void> {
  const calls: string[] = [];
  const record = (response: { url: () => string; request: () => { method: () => string } }): void => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith("/api/")) calls.push(`${response.request().method()} ${path}`);
  };
  page.on("response", record);
  try {
    await action();
    await page.waitForTimeout(300);
  } finally {
    page.off("response", record);
  }
  expect(calls, "这段操作本不该发请求").toEqual([]);
}

test("进页签：默认按「昨天到今天」取第一页，筛选摘要报的条数和服务端一致", async ({ page }) => {
  const first = await openAudit(page);

  await expect(auditRows(page), "界面上的行数必须等于这一页真的取回来多少行")
    .toHaveCount(Math.min(PAGE_SIZE, first.data.length));
  await expect(filterSummary(page)).toBeVisible();
  await expect(
    filterChip(page, `${utcDay(-1)} to ${utcDay()}`),
    "默认就带着时间筛选，摘要必须如实说出来，否则看到的是被筛过的数据却以为是全量",
  ).toBeVisible();
  await expect(filterSummary(page)).toContainText(`${first.total} entries`);
});

test("搜索：词送到服务端，命中的就是刚才那次操作，展开能看到当时的入参", async ({ page, api }) => {
  const invite = await makeAuditedEvent(api);
  const before = await openAudit(page);
  expect(before.total, "刚建完邀请码，审计里至少该有这一行").toBeGreaterThan(0);

  const searched = await expectAuditRequest(
    page,
    () => searchBox(page).fill(invite.id),
    { search: invite.id, page: "1" },
  );
  expect(searched.total, "邀请码 id 是唯一的，只该命中它自己那一行").toBe(1);
  expect(searched.data[0]?.entity_type).toBe("invite_link");
  expect(searched.data[0]?.action).toBe("create");

  await expect(auditRows(page)).toHaveCount(1);
  const row = auditRows(page).first();
  await expect(row, "行上要看得出是什么对象、做了什么").toContainText("Invite");
  await expect(row).toContainText("Created");
  await expect(row, "标题位上是这条记录指向的实体").toContainText(invite.id);

  /* 详情面板是这一页唯一能看到「当时到底传了什么」的地方。 */
  const header = row.locator(".audit-log-row__header");
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await expectNoApiCalls(page, () => header.click());
  await expect(header).toHaveAttribute("aria-expanded", "true");
  const detail = row.locator(".audit-log-row__detail-panel");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("Max uses");
  await expect(detail).toContainText("5");

  /* 摘要上的搜索标签是撤销这次筛选的唯一入口。 */
  await expect(filterChip(page, `Search: ${invite.id}`)).toBeVisible();
  await filterChip(page, `Search: ${invite.id}`).click();
  await expect(searchBox(page)).toHaveValue("");
  await expect(filterChip(page, "Search:")).toHaveCount(0);
  await expect(auditRows(page)).toHaveCount(Math.min(PAGE_SIZE, before.data.length));
});

test("时间范围：三个预设各自改的是起始日，切回「自定义」露出两个日期框且不重新取数", async ({ page }) => {
  await openAudit(page);

  const week = await expectAuditRequest(page, () => preset(page, "7D").click(), {
    start_at: startOf(utcDay(-7)),
    end_at: endOf(utcDay()),
    page: "1",
  });
  await expect(filterChip(page, `${utcDay(-7)} to ${utcDay()}`)).toBeVisible();
  await expect(
    field(toolbar(page), "Audit date from"),
    "选了预设之后自定义日期框就该收起来，不然屏幕上同时有两套互相矛盾的时间控件",
  ).toHaveCount(0);

  const month = await expectAuditRequest(page, () => preset(page, "1M").click(), {
    start_at: startOf(utcDay(-30)),
    page: "1",
  });
  expect(month.total, "范围放宽之后条数只会多不会少").toBeGreaterThanOrEqual(week.total);

  /* 切回「自定义」只是把两个日期框放出来，筛选条件一个字没变，不该重新取数。 */
  await expectNoApiCalls(page, () => preset(page, "Custom").click());
  await expect(field(toolbar(page), "Audit date from")).toHaveValue(utcDay(-30));
  await expect(field(toolbar(page), "Audit date to")).toHaveValue(utcDay());

  await expectAuditRequest(
    page,
    () => field(toolbar(page), "Audit date from").fill(utcDay(-3)),
    { start_at: startOf(utcDay(-3)), end_at: endOf(utcDay()) },
  );
  await expect(filterChip(page, `${utcDay(-3)} to ${utcDay()}`)).toBeVisible();

  /* 时间标签上的叉要把两个日期一起清掉，请求里这两个参数就该整个消失。 */
  const cleared = await expectAuditRequest(
    page,
    () => filterChip(page, `${utcDay(-3)} to ${utcDay()}`).click(),
    { start_at: null, end_at: null },
  );
  expect(cleared.total, "不限时间之后条数只会多不会少").toBeGreaterThanOrEqual(month.total);
  await expect(filterSummary(page), "筛选全清之后摘要整条消失").toHaveCount(0);
});

test("翻页：页码条和页码输入框各自能换页；但换页之后再搜索不会回到第一页", async ({ page, api }) => {
  /* 分页条要有第二页才有意义，先把当天的审计行顶到 51 条以上。 */
  let total = (await serverAudit(api, { start_at: startOf(utcDay(-1)), end_at: endOf(utcDay()) })).total;
  while (total <= PAGE_SIZE) {
    await makeAuditedEvent(api);
    total += 1;
  }
  const anchor = await makeAuditedEvent(api);
  total += 1;

  const first = await openAudit(page);
  expect(first.total).toBe(total);
  await expect(auditRows(page)).toHaveCount(PAGE_SIZE);
  const firstPageTop = await auditRows(page).first().innerText();

  const second = await expectAuditRequest(page, () => pageButton(page, "2").click(), {
    page: "2",
  });
  await expect(auditRows(page)).toHaveCount(second.data.length);
  expect(second.data.length, "第二页的行数就是剩下的那些").toBe(Math.min(PAGE_SIZE, total - PAGE_SIZE));
  expect(
    await auditRows(page).first().innerText(),
    "第二页的第一行不该还是第一页那条，否则等于没换页",
  ).not.toBe(firstPageTop);

  /*
   * 页码输入框是另一条换页路径。这里只断言渲染结果，不等请求：
   * 全局 QueryClient 的 staleTime 是 5 分钟（router.tsx:263），第一页刚才已经取过，
   * 回到第一页是命中缓存、一个请求都不发的——这是设计如此，不是没换页。
   * 所以验收改成「屏幕上确实回到了第一页」：行数满页，且首行就是刚才记下的那一条。
   */
  await field(page, "Page").fill("1");
  await expect(auditRows(page)).toHaveCount(PAGE_SIZE);
  await expect
    .poll(async () => await auditRows(page).first().innerText(), { message: "页码输入框没把界面切回第一页" })
    .toBe(firstPageTop);

  /* 同理，回到第二页也是命中缓存。 */
  await pageButton(page, "2").click();
  await expect(auditRows(page)).toHaveCount(second.data.length);

  /*
   * 现状如实记录，这是一处缺陷：
   * SET_SEARCH 只改 search 不重置 page（useAdminAuditFilter.ts:25），
   * 于是在第二页上开始搜索，请求带着 page=2 发出去。搜索结果只有一条时，
   * 第二页当然是空的——界面给出的是「没有任何记录」，而那条记录明明就在。
   * 修的时候把 SET_SEARCH 一并置 page: 1，然后把下面的断言换成「命中一行」。
   */
  const searched = await expectAuditRequest(
    page,
    () => searchBox(page).fill(anchor.id),
    { search: anchor.id, page: "2" },
  );
  expect(searched.total, "服务端确实只有这一条命中").toBe(1);
  expect(searched.data, "但请求要的是第二页，所以什么都拿不到").toEqual([]);
  await expect(page.getByText("No audit log entries found")).toBeVisible();
  await expect(auditRowFor(page, anchor.id), "记录就在库里，界面上却一行都看不到").toHaveCount(0);
});

test("导出：CSV 和 JSON 都真的落盘、内容就是当前筛选的结果，且导出本身也被记进审计", async ({ page, api }) => {
  const invite = await makeAuditedEvent(api);
  const exportsBefore = (await serverAudit(api, { entity_type: "audit_log_export" })).total;

  await openAudit(page);
  await expectAuditRequest(page, () => searchBox(page).fill(invite.id), { search: invite.id });
  await expect(auditRows(page)).toHaveCount(1);

  const filenameBase = `guild-audit-${utcDay(-1)}-to-${utcDay()}`;

  await toolbar(page).getByRole("button", { name: "Export", exact: true }).click();
  const csvDownload = page.waitForEvent("download");
  await clickExport(page, page.getByRole("menuitem", { name: "Export CSV", exact: true }), "text/csv");
  const csvFile = await csvDownload;
  await expectNotified(page, "Audit CSV exported");

  expect(csvFile.suggestedFilename(), "文件名要带上导出的时间范围，否则存下来分不清是哪一批")
    .toBe(`${filenameBase}.csv`);
  const csv = readFileSync(await csvFile.path(), "utf8").trim().split("\n");
  expect(csv[0], "表头必须齐全，缺一列就意味着导出的数据不完整").toBe(
    "id,entity_type,action,actor_id,actor_username,entity_id,diff_title,detail_text,created_at",
  );
  expect(csv.length, "当前筛选只剩一条，导出的就该只有这一条——导出必须跟着筛选走").toBe(2);
  expect(csv[1], "导出的正是屏幕上那一条").toContain(invite.id);

  await toolbar(page).getByRole("button", { name: "Export", exact: true }).click();
  const jsonDownload = page.waitForEvent("download");
  await clickExport(page, page.getByRole("menuitem", { name: "Export JSON", exact: true }), "application/json");
  const jsonFile = await jsonDownload;
  await expectNotified(page, "Audit JSON exported");

  expect(jsonFile.suggestedFilename()).toBe(`${filenameBase}.json`);
  const json = JSON.parse(readFileSync(await jsonFile.path(), "utf8")) as {
    total: number;
    start_at: string;
    end_at: string;
    data: AuditRow[];
  };
  /*
   * 这里是 2 不是 1，如实记录原因：刚才那次 CSV 导出自己写了一行审计，
   * 而它的 detail_text 里原样存着这次的筛选词（AdminAuditService.ts:412），
   * 搜索又是拿 detail_text 一起匹配的，于是第二次导出把第一次导出的那行也捞了进来。
   * 也就是说：同一个筛选连着导两次，后一次一定比前一次多一条。
   */
  expect(json.total, "第二次导出会把第一次导出留下的那行审计一并算进来").toBe(2);
  expect(json.start_at, "导出的时间范围要和界面上筛的一致").toBe(startOf(utcDay(-1)));
  expect(json.end_at).toBe(endOf(utcDay()));
  const exported = json.data.map((row) => row.entity_id).sort();
  expect(exported, "导出的两行就是：刚才那次建码，和刚才那次 CSV 导出").toEqual(
    ["audit-log", invite.id].sort(),
  );

  /* 导出是把全站操作记录带出系统的动作，它自己必须留痕。 */
  const exportsAfter = await serverAudit(api, { entity_type: "audit_log_export" });
  expect(exportsAfter.total, "两次导出要各自记下一行").toBe(exportsBefore + 2);
  const actions = exportsAfter.data.slice(0, 2).map((row) => row.action).sort();
  expect(actions).toEqual(["export_filtered_csv", "export_filtered_json"]);
});

test("归档下载面板：默认收起，展开后如实说明本地没有归档，不谎报有东西可下", async ({ page }) => {
  await openAudit(page);

  const panel = page.locator(".mantine-Paper-root").filter({ hasText: "Archive Downloads" }).last();
  await expect(panel).toBeVisible();
  await expect(
    panel.getByText("No archived audit months available yet."),
    "收起状态下不该有内容露在外面",
  ).toBeHidden();

  /* 归档月份在进页签时就取好了，展开只是把面板放出来，不该再发请求。 */
  await expectNoApiCalls(page, () => panel.getByRole("button", { name: "Show Archive", exact: true }).click());
  await expect(panel.getByText("No archived audit months available yet.")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Download (.ndjson.gz)", exact: true }),
    "没有可下的月份时不该摆出一个按钮让人白点",
  ).toHaveCount(0);

  await panel.getByRole("button", { name: "Hide Archive", exact: true }).click();
  await expect(panel.getByText("No archived audit months available yet.")).toBeHidden();
});
