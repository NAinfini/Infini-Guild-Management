import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { createThrowawayMember, uniqueTag } from "../../support/members";
import { expect, readJson, test } from "../../support/test";
import { field, readInteger, topDialog } from "../../support/ui";

/*
 * 后台「成员管理」页签的取数控件：搜索、状态筛选、统计块、分页、选择条、键盘操作。
 *
 * 这一条只管「看」，不改任何成员数据——真正会写库的行操作和批量操作分别在
 * admin-member-actions.spec.ts 和 admin-member-batch.spec.ts。
 *
 * 两条贯穿全篇的约束：
 *  1. 表格是虚拟滚动的（DataTableAdapter virtualize + maxHeight 65vh），
 *     一整页 20 行里 DOM 上只挂着可视区那十几行。所以凡是数行数的断言，
 *     都必须先用搜索把结果缩到个位数，否则数出来的是渲染窗口而不是数据。
 *  2. 一次性账号要到整轮运行收尾才删，前面用例留下的账号这会儿都还在。
 *     每条用例用自己的 tag 当搜索词，搜出来的就只有自己造的那几个。
 */


function searchBox(page: Page): Locator {
  return page.getByRole("textbox", { name: "Search members", exact: true });
}
function memberRows(page: Page): Locator {
  return page.getByRole("row", { name: /member row$/ });
}
function memberRow(page: Page, username: string): Locator {
  return page.getByRole("row", { name: `${username} member row`, exact: true });
}
/*
 * Mantine 的 SegmentedControl 把真正的 radio 藏起来（视觉上不可见），可点的是它的
 * label。按 role 取到的是那个隐藏 input，点它会一直等「元素可见」直到超时，
 * 报出来像是控件坏了。所以点 label、断言 radio。
 */
function statusFilter(page: Page, label: string): Locator {
  return page.locator("label.mantine-SegmentedControl-label").filter({ hasText: new RegExp(`^${label}$`) });
}
function statusFilterInput(page: Page, label: string): Locator {
  return page.getByRole("radio", { name: label, exact: true });
}
/*
 * 分页条在页面上有两份：桌面表格的页脚一份，移动端卡片列表里还有一份。
 * 后者只是被 CSS 藏起来，DOM 里一直在，不限定作用域的话每个分页按钮都会撞成
 * strict mode violation——报出来像是选择器写错了，其实是控件被渲染了两遍。
 */
function pagination(page: Page): Locator {
  return page.locator(".admin-table-card__footer");
}

/** 四个统计块，顺序固定：总数、启用、停用、管理员。 */
async function readStats(page: Page): Promise<{ total: number; active: number; inactive: number; admins: number }> {
  const values = page.locator(".admin-stat__value");
  await expect(values).toHaveCount(4);
  return {
    total: await readInteger(values.nth(0), "总成员数"),
    active: await readInteger(values.nth(1), "启用数"),
    inactive: await readInteger(values.nth(2), "停用数"),
    admins: await readInteger(values.nth(3), "管理员数"),
  };
}

async function serverUserTotal(api: APIRequestContext): Promise<number> {
  const response = await readJson(await api.get("/api/users?page=1&limit=500"), "读取成员总数") as {
    total: number;
  };
  return response.total;
}

async function openMembers(page: Page): Promise<void> {
  await page.goto("/admin");
  await expect(page.getByRole("tab", { name: /Member Mgmt/ })).toHaveAttribute("aria-selected", "true");
  await expect(searchBox(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
}

/** 盯着 /api/ 证明这段操作真的是纯前端的。搜索和筛选都在内存里做，一个请求都不该有。 */
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
  expect(calls, "这段操作本应是纯前端的，却发了请求").toEqual([]);
}

test("搜索框：缩到唯一一行，四个统计块跟着搜索结果重算，清空后回到全量", async ({ page, api }) => {
  const member = await createThrowawayMember(api, uniqueTag("search"));
  const total = await serverUserTotal(api);

  await openMembers(page);
  const before = await readStats(page);
  expect(before.total, "统计块的总数必须等于服务端的成员总数").toBe(total);

  await expectNoApiCalls(page, async () => {
    await searchBox(page).fill(member.username);
    await expect(memberRows(page), "用户名是唯一的，只该剩这一行").toHaveCount(1);
  });
  await expect(memberRow(page, member.username)).toBeVisible();

  /* 统计块算的是搜索结果，不是全站——新建的成员默认启用、默认非管理员。 */
  expect(await readStats(page)).toEqual({ total: 1, active: 1, inactive: 0, admins: 0 });

  await searchBox(page).fill("");
  expect(await readStats(page), "清空搜索必须完全回到原样").toEqual(before);
});

test("状态筛选：三段各自过滤可见行，而统计块按搜索结果算、不跟着筛选变", async ({ page, api }) => {
  const tag = uniqueTag("flt");
  const running = await createThrowawayMember(api, tag);
  const paused = await createThrowawayMember(api, tag);
  expect(
    /* 空 body 会被当成非法载荷退回 400，停用理由是可选的但 JSON 本体必须有。 */
    (await api.patch(`/api/admin/users/${paused.id}/deactivate`, { data: {} })).status(),
    "预置：把其中一个停用",
  ).toBe(200);

  await openMembers(page);
  await searchBox(page).fill(tag);
  await expect(memberRows(page)).toHaveCount(2);

  const stats = { total: 2, active: 1, inactive: 1, admins: 0 };
  expect(await readStats(page)).toEqual(stats);

  await expectNoApiCalls(page, async () => {
    await statusFilter(page, "active").click();
    await expect(memberRows(page)).toHaveCount(1);
  });
  await expect(statusFilterInput(page, "active")).toBeChecked();
  await expect(memberRow(page, running.username)).toBeVisible();
  expect(await readStats(page), "统计块的口径是搜索结果，状态筛选只是视图").toEqual(stats);

  await statusFilter(page, "inactive").click();
  await expect(statusFilterInput(page, "inactive")).toBeChecked();
  await expect(memberRows(page)).toHaveCount(1);
  await expect(memberRow(page, paused.username)).toBeVisible();

  await statusFilter(page, "All").click();
  await expect(statusFilterInput(page, "All")).toBeChecked();
  await expect(memberRows(page)).toHaveCount(2);
});

test("分页：超过一页才出现分页条，末页行数对得上，改成每页 50 之后分页条整条消失", async ({ page, api }) => {
  /* 默认每页 20，所以要先把总人数顶到 21 以上，分页条才会渲染出来。 */
  const PAGE_SIZE = 20;
  let total = await serverUserTotal(api);
  while (total <= PAGE_SIZE) {
    await createThrowawayMember(api, uniqueTag("page"));
    total += 1;
  }
  expect(total, "这条用例假定总人数不超过 50，否则改成每页 50 之后分页条不会消失").toBeLessThanOrEqual(50);

  await openMembers(page);
  const lastPage = Math.ceil(total / PAGE_SIZE);
  const lastPageRows = total - (lastPage - 1) * PAGE_SIZE;

  await pagination(page).getByRole("button", { name: `Go to page ${lastPage}` }).click();
  await expect(
    memberRows(page),
    `末页应当只剩 ${lastPageRows} 行（总数 ${total}，每页 ${PAGE_SIZE}）`,
  ).toHaveCount(lastPageRows);

  /*
   * 每页条数是分页条自己的一部分：调到 50 之后只剩一页，整条分页条（连同这个
   * 下拉）一起从 DOM 里消失，不刷新页面就再也调不回去了。如实记录现状。
   */
  await field(pagination(page), "Per page").click();
  await page.getByRole("option", { name: "50", exact: true }).click();
  await expect(pagination(page).getByRole("button", { name: "Last page" })).toHaveCount(0);
  await expect(field(pagination(page), "Per page")).toHaveCount(0);
});

/* 多选操作通过行的右键菜单进入；本用例验证 aria-selected 对应的选择模型。 */
test("选择：单击换选，Ctrl 点选累加，再单击一行把选中收回这一行", async ({ page, api, flow }) => {
  const tag = uniqueTag("sel");
  const first = await createThrowawayMember(api, tag);
  const second = await createThrowawayMember(api, tag);

  await openMembers(page);
  await searchBox(page).fill(tag);
  await expect(memberRows(page)).toHaveCount(2);

  await expect(page.getByText(/Click or press Space to select/)).toBeVisible();
  await expect(memberRow(page, first.username)).toHaveAttribute("aria-selected", "false");

  await flow.clickWithoutApi(memberRow(page, first.username));
  await expect(memberRow(page, first.username)).toHaveAttribute("aria-selected", "true");
  await expect(memberRow(page, second.username)).toHaveAttribute("aria-selected", "false");

  await memberRow(page, second.username).click({ modifiers: ["ControlOrMeta"] });
  await expect(memberRow(page, first.username)).toHaveAttribute("aria-selected", "true");
  await expect(memberRow(page, second.username)).toHaveAttribute("aria-selected", "true");

  await flow.clickWithoutApi(memberRow(page, second.username));
  await expect(memberRow(page, first.username), "不带修饰键的单击应当只留下这一行")
    .toHaveAttribute("aria-selected", "false");
  await expect(memberRow(page, second.username)).toHaveAttribute("aria-selected", "true");
});

test("键盘：提示文案承诺的三件事都要真的能做到——空格选中、回车看详情、Shift+F10 出菜单", async ({ page, api }) => {
  const tag = uniqueTag("kbd");
  const member = await createThrowawayMember(api, tag);

  await openMembers(page);
  await searchBox(page).fill(tag);
  await expect(memberRows(page)).toHaveCount(1);

  const row = memberRow(page, member.username);
  await row.focus();
  await page.keyboard.press(" ");
  await expect(row, "空格应当选中当前行").toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Enter");
  await expect(topDialog(page), "回车应当打开这一行的成员详情").toBeVisible();
  await expect(
    topDialog(page).getByRole("heading", { name: `Member Detail · ${member.username}`, exact: true }),
    "打开的必须是这一行的成员，不能是别人",
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await row.focus();
  await page.keyboard.press("Shift+F10");
  await expect(
    page.locator("[data-admin-user-action-menu]"),
    "Shift+F10 应当调出行操作菜单",
  ).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Detail", exact: true })).toBeVisible();
});
