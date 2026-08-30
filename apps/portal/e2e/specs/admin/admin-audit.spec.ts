import { readFileSync } from "node:fs";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import type { AuditEvent, CursorResponse } from "@guild/shared";
import { readAssignableRole } from "../../support/members";
import { expect, readJson, test } from "../../support/test";
import { appSiderNavigationItem, ensureFiltersOpen, expectToast, field, selectRadioOption } from "../../support/ui";

/* Filters are server-owned; each interaction checks the outgoing query before asserting the UI. */

/* Trace replays export downloads outside the instrumented request context, creating an
   unregistered audit event that cleanup cannot remove. Keep it disabled for this file. */
test.use({ trace: "off" });

const AUDIT_LOG_PATH = "/api/admin/audit-log";
const PAGE_SIZE = 50;

type AuditPage = CursorResponse<AuditEvent>;

/**
 * 默认时间范围：七天前 00:00 到今天 23:59（useAdminAuditFilter.ts）。
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
  return page.locator(".admin-audit-toolbar");
}
function searchBox(page: Page): Locator {
  return page.getByLabel("Search audit logs", { exact: true });
}
function auditRows(page: Page): Locator {
  return page.locator(".audit-log-row");
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
 * 返回服务端的 cursor page，好让调用方和界面对账。
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

/** 进入审计工作区，并把首屏那次取数接住。 */
async function openAudit(page: Page): Promise<AuditPage> {
  const first = await expectAuditRequest(page, () => page.goto("/admin?tab=audit").then(() => undefined), {
    limit: String(PAGE_SIZE),
    start_at: startOf(utcDay(-7)),
    end_at: endOf(utcDay()),
  });
  await expect(appSiderNavigationItem(page, "Audit Log")).toHaveAttribute("aria-current", "page");
  await page.waitForLoadState("networkidle");
  return first;
}

/** 做一件会被记账的事：建个邀请链接，换回它在审计里的那行锚点。 */
async function makeAuditedEvent(api: APIRequestContext): Promise<{ id: string; roleName: string }> {
  const role = await readAssignableRole(api);
  const invite = await readJson(
    await api.post("/api/admin/invite-links", { data: { max_uses: 5, role_id: role.id } }),
    "创建邀请链接以产生一行审计",
  ) as { id: string };
  return { ...invite, roleName: role.name };
}

async function serverAudit(
  api: APIRequestContext,
  params: Record<string, string>,
): Promise<AuditPage> {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE), ...params });
  return await readJson(await api.get(`${AUDIT_LOG_PATH}?${query.toString()}`), "读取审计日志") as AuditPage;
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

test("进页签：默认按最近七天取首批事件，不再重复渲染筛选摘要", async ({ page }) => {
  const first = await openAudit(page);

  await expect(auditRows(page), "界面上的行数必须等于这一页真的取回来多少行")
    .toHaveCount(Math.min(PAGE_SIZE, first.data.length));
  await expect(page.locator(".admin-filter-summary")).toHaveCount(0);
  await expect(toolbar(page).getByRole("button", { name: "Filters", exact: true })).toBeVisible();
});

test("搜索：词送到服务端，命中的就是刚才那次操作，展开能看到当时的入参", async ({ page, api }) => {
  const invite = await makeAuditedEvent(api);
  const before = await openAudit(page);
  expect(before.data.length, "刚建完邀请链接，审计里至少该有这一行").toBeGreaterThan(0);

  const searched = await expectAuditRequest(
    page,
    () => searchBox(page).fill(invite.id),
    { search: invite.id, cursor: null },
  );
  expect(searched.data, "邀请链接 id 是唯一的，只该命中它自己那一行").toHaveLength(1);
  expect(searched.data[0]?.subject.type).toBe("invite_link");
  expect(searched.data[0]?.action).toBe("create");

  await expect(auditRows(page)).toHaveCount(1);
  const row = auditRows(page).first();
  const header = row.locator(".audit-log-row__header");
  await expect(header, "主行应使用完整自然语言描述").toContainText("created an invite link");
  await expect(header).toContainText(invite.roleName);
  await expect(header, "技术标识不应出现在主行").not.toContainText(invite.id);

  await expect(header).toHaveAttribute("aria-expanded", "false");
  await expectNoApiCalls(page, () => header.click());
  await expect(header).toHaveAttribute("aria-expanded", "true");
  const detail = row.locator(".audit-log-row__details");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("Maximum uses");
  await expect(detail).toContainText("5");
  await detail.locator(".audit-technical-disclosure summary").click();
  await expect(detail.getByText(invite.id, { exact: true })).toBeVisible();

  /* 空查询仍在 TanStack Query 缓存期内，恢复首批结果不应额外请求服务端。 */
  await searchBox(page).fill("");
  await expect(searchBox(page)).toHaveValue("");
  await expect(auditRows(page)).toHaveCount(Math.min(PAGE_SIZE, before.data.length));
});

test("时间范围：预设只改变一个有效范围，自定义时才露出两个日期框", async ({ page }) => {
  await openAudit(page);
  await ensureFiltersOpen(toolbar(page));

  const day = await expectAuditRequest(page, () => selectRadioOption(page, "1D"), {
    start_at: startOf(utcDay(-1)),
    end_at: endOf(utcDay()),
  });
  await expect(
    field(page, "Audit date from"),
    "选了预设之后自定义日期框就该收起来，不然屏幕上同时有两套互相矛盾的时间控件",
  ).toHaveCount(0);

  await ensureFiltersOpen(toolbar(page));
  const month = await expectAuditRequest(page, () => selectRadioOption(page, "1M"), {
    start_at: startOf(utcDay(-30)),
  });
  expect(month.data.length).toBeGreaterThanOrEqual(day.data.length);

  /* 切回「自定义」只是把两个日期框放出来，筛选条件一个字没变，不该重新取数。 */
  await ensureFiltersOpen(toolbar(page));
  await expectNoApiCalls(page, () => selectRadioOption(page, "Custom"));
  await expect(field(page, "Audit date from")).toHaveValue(utcDay(-30));
  await expect(field(page, "Audit date to")).toHaveValue(utcDay());

  await expectAuditRequest(
    page,
    () => field(page, "Audit date from").fill(utcDay(-3)),
    { start_at: startOf(utcDay(-3)), end_at: endOf(utcDay()) },
  );
  await expect(toolbar(page).getByRole("button", { name: "Filters (1)" })).toBeVisible();
});

test("加载更多：使用游标追加事件，随后搜索会开启新的首批结果", async ({ page, api }) => {
  const range = { start_at: startOf(utcDay(-7)), end_at: endOf(utcDay()) };
  let firstServerPage = await serverAudit(api, range);
  while (!firstServerPage.next_cursor) {
    await makeAuditedEvent(api);
    firstServerPage = await serverAudit(api, range);
  }
  const anchor = await makeAuditedEvent(api);

  const first = await openAudit(page);
  expect(first.next_cursor).not.toBeNull();
  await expect(auditRows(page)).toHaveCount(first.data.length);

  const second = await expectAuditRequest(
    page,
    () => page.getByRole("button", { name: "Load more", exact: true }).click(),
    { cursor: first.next_cursor },
  );
  await expect(auditRows(page)).toHaveCount(first.data.length + second.data.length);

  const searched = await expectAuditRequest(
    page,
    () => searchBox(page).fill(anchor.id),
    { search: anchor.id, cursor: null },
  );
  expect(searched.data).toHaveLength(1);
  await expect(auditRows(page)).toHaveCount(1);
  await expect(auditRows(page).first().locator(".audit-log-row__header")).not.toContainText(anchor.id);
});

test("导出：CSV 和 JSON 都真的落盘、内容就是当前筛选的结果，且导出本身也被记进审计", async ({ page, api }) => {
  const invite = await makeAuditedEvent(api);
  const exportsBefore = await serverAudit(api, { entity_type: "audit_log_export" });
  const exportIdsBefore = new Set(exportsBefore.data.map((event) => event.event_id));

  await openAudit(page);
  await expectAuditRequest(page, () => searchBox(page).fill(invite.id), { search: invite.id });
  await expect(auditRows(page)).toHaveCount(1);

  const filenameBase = `guild-audit-${utcDay(-7)}-to-${utcDay()}`;

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const csvDownload = page.waitForEvent("download");
  await clickExport(page, page.getByRole("menuitem", { name: "Export CSV", exact: true }), "text/csv");
  const csvFile = await csvDownload;
  await expectToast(page, "Audit CSV exported");

  expect(csvFile.suggestedFilename(), "文件名要带上导出的时间范围，否则存下来分不清是哪一批")
    .toBe(`${filenameBase}.csv`);
  const csv = readFileSync(await csvFile.path(), "utf8").trim().split("\n");
  expect(csv[0], "表头必须齐全，缺一列就意味着导出的数据不完整").toBe(
    "event_id,subject_type,action,actor_id,actor_label,subject_id,subject_label,payload,occurred_at",
  );
  expect(csv.length, "当前筛选只剩一条，导出的就该只有这一条——导出必须跟着筛选走").toBe(2);
  expect(csv[1], "导出的正是屏幕上那一条").toContain(invite.id);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const jsonDownload = page.waitForEvent("download");
  await clickExport(page, page.getByRole("menuitem", { name: "Export JSON", exact: true }), "application/json");
  const jsonFile = await jsonDownload;
  await expectToast(page, "Audit JSON exported");

  expect(jsonFile.suggestedFilename()).toBe(`${filenameBase}.json`);
  const json = JSON.parse(readFileSync(await jsonFile.path(), "utf8")) as {
    total: number;
    start_at: string;
    end_at: string;
    data: AuditEvent[];
  };
  /* 导出留痕不会命中仍按邀请链接 id 过滤的下一次导出。 */
  expect(json.total, "第二次导出仍然只包含当前筛选命中的那条记录").toBe(1);
  expect(json.start_at, "导出的时间范围要和界面上筛的一致").toBe(startOf(utcDay(-7)));
  expect(json.end_at).toBe(endOf(utcDay()));
  const exported = json.data.map((row) => row.subject.id);
  expect(exported, "导出的就是屏幕上按邀请链接 id 命中的那一条").toEqual([invite.id]);

  /* 导出是把全站操作记录带出系统的动作，它自己必须留痕。 */
  const exportsAfter = await serverAudit(api, { entity_type: "audit_log_export" });
  const newExports = exportsAfter.data.filter((event) => !exportIdsBefore.has(event.event_id));
  expect(newExports, "两次导出要各自记下一行").toHaveLength(2);
  const actions = newExports.map((row) => row.action).sort();
  expect(actions).toEqual(["export_filtered_csv", "export_filtered_json"]);
});

test("归档下载面板：默认收起，展开后如实说明本地没有归档，不谎报有东西可下", async ({ page }) => {
  await openAudit(page);

  const panel = page.locator('[data-slot="card"]').filter({ hasText: "Archive Downloads" }).last();
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
