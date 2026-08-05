import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, readJson, test } from "../../support/test";
import { confirmDialog, dialogTitled, expectNoDialog, field, readInteger } from "../../support/ui";

/*
 * 后台「邀请码」页签的全部控件：新建弹窗、可见性分段、搜索框、行上的复制／撤销／删除、
 * 以及分页的「加载更多」。
 *
 * 这一页和成员页最大的不同：筛选和搜索都是服务端做的（listInviteLinks 直接按
 * visibility/search 拼 SQL），所以每一次筛选、每一次搜索都必须验到「请求真的带着这个
 * 条件发出去了」——只看表里剩几行的话，前端在内存里过滤一遍也能装得一模一样，
 * 而那样的实现一旦超过一页就会开始漏数据。
 *
 * 靶子一律是本条用例自己经 POST /api/admin/invite-links 造的码：这个接口的返回
 * 会被系统测试中间件登记（system-test-tracking.ts:24），收尾时按 id 硬删。
 * 撤销是不可逆的（服务端对已撤销的码直接返 409），拿种子里的码开刀会把后面的用例
 * 建在一份被悄悄改过的数据上，而收尾指纹只数行数，这种污染一条都查不出来。
 */

const CREATE_INVITE = { method: "POST", path: /^\/api\/admin\/invite-links$/ } as const;
const REVOKE_INVITE = { method: "DELETE", path: /^\/api\/admin\/invite-links\/[^/]+$/ } as const;
const DELETE_INVITE = { method: "DELETE", path: /^\/api\/admin\/invite-links\/[^/]+\/permanent$/ } as const;
const LIST_INVITES = { method: "GET", path: /^\/api\/admin\/invite-links$/ } as const;

/** 服务端一页最多给 50 条（LIMITS.pagination.admin），「加载更多」就是按这个数出现的。 */
const PAGE_SIZE = 50;

type ServerInvite = {
  id: string;
  code: string;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  revoked_at: string | null;
};
type InviteStats = { total: number; active: number; revoked: number; expired: number };
type Visibility = "active" | "expired" | "revoked";

async function serverStats(api: APIRequestContext): Promise<InviteStats> {
  return await readJson(await api.get("/api/admin/invite-links/stats"), "读取邀请统计") as InviteStats;
}

async function serverInvites(api: APIRequestContext, visibility: Visibility): Promise<ServerInvite[]> {
  const page = await readJson(
    await api.get(`/api/admin/invite-links?visibility=${visibility}&limit=100`),
    `读取${visibility}邀请码`,
  ) as { data: ServerInvite[] };
  return page.data;
}

/** 建一个挂在本次运行名下的邀请码。expiresAt 传 null 表示永不过期。 */
async function createInvite(
  api: APIRequestContext,
  options: { maxUses?: number; expiresAt?: string | null } = {},
): Promise<ServerInvite> {
  return await readJson(
    await api.post("/api/admin/invite-links", {
      data: {
        max_uses: options.maxUses ?? 5,
        ...(options.expiresAt === null || options.expiresAt === undefined
          ? {}
          : { expires_at: options.expiresAt }),
      },
    }),
    "创建邀请码",
  ) as ServerInvite;
}

function toolbar(page: Page): Locator {
  return page.locator(".admin-toolbar");
}
function searchBox(page: Page): Locator {
  return page.getByPlaceholder("Search code / date");
}
function inviteRows(page: Page): Locator {
  return page.locator(".admin-table tbody tr");
}
/** 邀请码是 16 位随机串，用它挑行不会撞车。 */
function inviteRow(page: Page, code: string): Locator {
  return page.locator(".admin-table tbody tr").filter({ hasText: code });
}
/*
 * Mantine 的 SegmentedControl 把真正的 radio 藏了起来（视觉上不可见），可点的是 label。
 * 按 role 取到的是那个隐藏 input，点它会一直等「元素可见」直到超时，报出来像控件坏了。
 */
function segment(page: Page, label: string): Locator {
  return page.locator("label.mantine-SegmentedControl-label").filter({ hasText: new RegExp(`^${label}$`) });
}
function segmentInput(page: Page, label: string): Locator {
  return page.getByRole("radio", { name: label, exact: true });
}
function loadedCount(page: Page): Locator {
  return page.locator(".admin-table-card__footer").getByText(/^Loaded \d+ of \d+$/);
}
function loadMoreButton(page: Page): Locator {
  return page.locator(".admin-table-card__footer").getByRole("button", { name: "Load More", exact: true });
}

/** 四个统计块，顺序固定：总数、有效、已过期、已撤销。 */
async function readStats(page: Page): Promise<InviteStats> {
  const values = page.locator(".admin-stat__value");
  await expect(values).toHaveCount(4);
  return {
    total: await readInteger(values.nth(0), "邀请码总数"),
    active: await readInteger(values.nth(1), "有效数"),
    expired: await readInteger(values.nth(2), "过期数"),
    revoked: await readInteger(values.nth(3), "撤销数"),
  };
}

async function openInvites(page: Page): Promise<void> {
  await page.goto("/admin?tab=invite");
  await expect(page.getByRole("tab", { name: /Invite Links/ })).toHaveAttribute("aria-selected", "true");
  await expect(searchBox(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
}

/**
 * 等一次列表请求，并且要求它带着预期的筛选条件。
 * 这一页的筛选和搜索全在服务端做，条件没送到就意味着看到的是别的结果集。
 */
async function expectListRequest(
  page: Page,
  action: () => Promise<void>,
  expected: { visibility: Visibility; search?: string },
): Promise<void> {
  const waiter = page.waitForResponse((response) => {
    if (response.request().method() !== "GET") return false;
    const url = new URL(response.url());
    if (url.pathname !== "/api/admin/invite-links") return false;
    return url.searchParams.get("visibility") === expected.visibility
      && (url.searchParams.get("search") ?? "") === (expected.search ?? "");
  });
  await action();
  const response = await waiter;
  expect(
    response.ok(),
    `列表请求 ${response.url()} 返回 ${response.status()}`,
  ).toBe(true);
}

/**
 * 切可见性分段：请求要带上新的 visibility，radio 也要真的选中。
 * 搜索词是和 visibility 一起进同一个查询键的，切段时框里还留着什么就得一并报给这里，
 * 否则等的是一个根本不会发出来的请求。
 */
async function switchVisibility(
  page: Page,
  label: string,
  visibility: Visibility,
  search = "",
): Promise<void> {
  await expectListRequest(page, () => segment(page, label).click(), {
    visibility,
    search: search.trim().toLowerCase(),
  });
  await expect(segmentInput(page, label)).toBeChecked();
}

/** 输入搜索词：搜索是防抖后发给服务端的，等到那一次请求才算这一步做完。 */
async function searchInvites(page: Page, term: string, visibility: Visibility = "active"): Promise<void> {
  await expectListRequest(
    page,
    () => searchBox(page).fill(term),
    { visibility, search: term.trim().toLowerCase() },
  );
}

async function openRowMenu(page: Page, code: string): Promise<void> {
  await inviteRow(page, code).getByRole("button", { name: "Actions", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}
function menuItem(page: Page, name: string): Locator {
  return page.getByRole("menuitem", { name, exact: true });
}

/**
 * 断言弹出了这句通知。
 * notifications.show({ message }) 渲染进的是 Notification 的 description 槽，不是 title。
 */
async function expectNotified(page: Page, text: string): Promise<void> {
  await expect(
    page.locator(".mantine-Notification-description").filter({ hasText: text }),
    `没有弹出通知「${text}」`,
  ).toBeVisible();
}

/** 盯着 /api/ 证明这段操作没发请求。取消确认框、复制链接都必须走这条。 */
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

test("新建邀请码：弹窗填的次数和到期时间一路落到库里，统计块和表格一起跟上", async ({ page, api, flow }) => {
  const before = await serverStats(api);
  await openInvites(page);
  expect(await readStats(page), "统计块必须等于服务端的统计").toEqual(before);

  await toolbar(page).getByRole("button", { name: "Create Invite", exact: true }).click();
  const dialog = dialogTitled(page, "Create Invite Link");
  await expect(dialog).toBeVisible();

  await field(dialog, "Invite max uses").fill("3");
  /* 浏览器时区被固定成 UTC（playwright.config.ts），所以这个本地时间就是 UTC 时间，
     写进库里是 2031-03-07T05:09:00.000Z，表格里也照这个渲染。 */
  await field(dialog, "Invite expiration time").fill("2031-03-07T05:09");

  const created = await flow.click(
    dialog.getByRole("button", { name: "Create Invite", exact: true }),
    { ...CREATE_INVITE, status: 201 },
  ) as ServerInvite;
  await expectNotified(page, "Invite link created");
  await expectNoDialog(page);

  expect(created.max_uses, "弹窗里填的次数必须原样送到服务端").toBe(3);
  expect(created.used_count).toBe(0);
  expect(created.expires_at, "到期时间要按 UTC 转成 ISO").toBe("2031-03-07T05:09:00.000Z");

  await searchInvites(page, created.code);
  const row = inviteRow(page, created.code);
  await expect(row).toHaveCount(1);
  await expect(row.locator("td[data-column-id='usage']"), "用量列显示 已用/上限").toContainText("0/3");
  await expect(row.locator("td[data-column-id='status']")).toHaveText("Valid");
  await expect(row.locator("td[data-column-id='expires']")).toHaveText("2031-03-07 05:09");

  const after = { ...before, total: before.total + 1, active: before.active + 1 };
  expect(await serverStats(api), "服务端统计必须真的多一个有效码").toEqual(after);
  await expect(page.locator(".admin-stat__value").nth(0)).toHaveText(String(after.total));
  await expect(page.locator(".admin-stat__value").nth(1)).toHaveText(String(after.active));
});

test("可见性三段：有效／过期／撤销各自只装自己那一批，条件是发给服务端的", async ({ page, api }) => {
  const active = await createInvite(api, { expiresAt: "2031-05-01T00:00:00.000Z" });
  const expired = await createInvite(api, { expiresAt: "2020-05-01T00:00:00.000Z" });
  const revoked = await createInvite(api, { expiresAt: "2031-05-01T00:00:00.000Z" });
  expect(
    (await api.delete(`/api/admin/invite-links/${revoked.id}`)).status(),
    "预置：撤销其中一个",
  ).toBe(200);

  await openInvites(page);
  await expect(segmentInput(page, "Valid"), "默认停在「有效」这一段").toBeChecked();
  await expect(inviteRow(page, active.code)).toHaveCount(1);
  await expect(inviteRow(page, expired.code), "过期的码不该出现在有效段").toHaveCount(0);
  await expect(inviteRow(page, revoked.code), "撤销的码不该出现在有效段").toHaveCount(0);

  await switchVisibility(page, "Expired", "expired");
  await expect(inviteRow(page, expired.code)).toHaveCount(1);
  await expect(inviteRow(page, expired.code).locator("td[data-column-id='status']")).toHaveText("expired");
  await expect(inviteRow(page, active.code)).toHaveCount(0);
  await expect(inviteRow(page, revoked.code)).toHaveCount(0);

  await switchVisibility(page, "Revoked", "revoked");
  await expect(inviteRow(page, revoked.code)).toHaveCount(1);
  await expect(inviteRow(page, revoked.code).locator("td[data-column-id='status']")).toHaveText("revoked");
  await expect(inviteRow(page, active.code)).toHaveCount(0);
  await expect(inviteRow(page, expired.code)).toHaveCount(0);
});

test("搜索框：按码能搜到唯一一条，按到期日能搜到同一批，搜不到时列表清零", async ({ page, api }) => {
  /* 搜索命中的是 code / created_at / expires_at 三列，所以给这两个码配同一个到期日，
     它就成了「这一批」的标签——用 created_at 会连上种子数据里同一天建的码。 */
  const day = "2032-09-14";
  const first = await createInvite(api, { expiresAt: `${day}T01:00:00.000Z` });
  const second = await createInvite(api, { expiresAt: `${day}T02:00:00.000Z` });

  await openInvites(page);

  await searchInvites(page, first.code);
  await expect(inviteRows(page), "码是唯一的，只该剩这一行").toHaveCount(1);
  await expect(inviteRow(page, first.code)).toHaveCount(1);
  await expect(loadedCount(page)).toHaveText("Loaded 1 of 1");

  await searchInvites(page, day);
  await expect(inviteRows(page)).toHaveCount(2);
  await expect(inviteRow(page, first.code)).toHaveCount(1);
  await expect(inviteRow(page, second.code)).toHaveCount(1);
  await expect(loadedCount(page)).toHaveText("Loaded 2 of 2");

  await searchInvites(page, "zzz-no-such-invite");
  await expect(inviteRows(page), "搜不到就该是空表，不是退回全量").toHaveCount(0);
  await expect(loadedCount(page)).toHaveText("Loaded 0 of 0");
});

test("复制链接：剪贴板里是可以直接发出去的完整注册地址，且不碰网络", async ({ page, context, api }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const invite = await createInvite(api);

  await openInvites(page);
  await searchInvites(page, invite.code);

  await expectNoApiCalls(page, async () => {
    await inviteRow(page, invite.code).getByRole("button", { name: "Copy Link", exact: true }).click();
  });

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied, "复制出来的必须是能直接注册的完整地址，不是光秃秃一个码")
    .toBe(`${new URL(page.url()).origin}/register/${invite.code}`);
});

test("撤销：取消什么都不发；确认之后码当场失效、搬进「已撤销」段、统计跟着挪一格", async ({ page, api, flow }) => {
  const invite = await createInvite(api);
  const before = await serverStats(api);

  await openInvites(page);
  await searchInvites(page, invite.code);

  await openRowMenu(page, invite.code);
  await menuItem(page, "Revoke").click();
  const dialog = await confirmDialog(page, "Revoke invite link?");
  await expect(dialog, "确认框必须点名是哪个码，否则撤错了都不知道").toContainText(invite.code);

  await expectNoApiCalls(page, async () => {
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expectNoDialog(page);
  });
  expect(
    (await serverInvites(api, "active")).some((row) => row.id === invite.id),
    "取消之后这个码必须还在有效列表里",
  ).toBe(true);

  await openRowMenu(page, invite.code);
  await menuItem(page, "Revoke").click();
  const again = await confirmDialog(page, "Revoke invite link?");
  await flow.click(again.getByRole("button", { name: "Revoke", exact: true }), REVOKE_INVITE);
  await expectNotified(page, "Invite link revoked");

  await expect(inviteRows(page), "撤销之后它就不该留在有效段里了").toHaveCount(0);
  expect(await serverStats(api), "统计要从有效挪到撤销，总数不变").toEqual({
    ...before,
    active: before.active - 1,
    revoked: before.revoked + 1,
  });

  await switchVisibility(page, "Revoked", "revoked", invite.code);
  const row = inviteRow(page, invite.code);
  await expect(row).toHaveCount(1);
  await expect(row.locator("td[data-column-id='status']")).toHaveText("revoked");
  await expect(
    row.getByRole("button", { name: "Copy Link", exact: true }),
    "已经作废的码不该还能复制出去",
  ).toBeDisabled();
  await openRowMenu(page, invite.code);
  await expect(menuItem(page, "Revoke"), "撤销过的码不能再撤一次，服务端对此直接返 409").toBeDisabled();

  const stored = (await serverInvites(api, "revoked")).find((entry) => entry.id === invite.id);
  expect(stored?.revoked_at, "服务端必须真的写上了撤销时间").toBeTruthy();
});

test("删除：确认之后这条从三个分段里一起消失，服务端和统计都少一个", async ({ page, api, flow }) => {
  const invite = await createInvite(api);
  const before = await serverStats(api);

  await openInvites(page);
  await searchInvites(page, invite.code);
  await expect(inviteRow(page, invite.code)).toHaveCount(1);

  await openRowMenu(page, invite.code);
  await menuItem(page, "Delete").click();
  const dialog = await confirmDialog(page, "Delete invite link?");
  await expect(dialog).toContainText(invite.code);
  await expect(dialog, "不可逆的操作必须说明它不可逆").toContainText("This cannot be undone.");

  await flow.click(dialog.getByRole("button", { name: "Delete", exact: true }), DELETE_INVITE);
  await expectNotified(page, "Invite link deleted");

  await expect(inviteRows(page)).toHaveCount(0);
  expect(await serverStats(api), "永久删除要把总数一起减掉").toEqual({
    ...before,
    total: before.total - 1,
    active: before.active - 1,
  });
  for (const visibility of ["active", "expired", "revoked"] as const) {
    expect(
      (await serverInvites(api, visibility)).some((row) => row.id === invite.id),
      `删掉的码不该还留在 ${visibility} 列表里`,
    ).toBe(false);
  }
});

test("加载更多：一页只给 50 条，点一次把剩下的补齐，补齐后按钮自己收起来", async ({ page, api, flow }) => {
  /*
   * 「加载更多」只有结果集超过一页才会出现，所以必须真的造出 51 条。
   * 全部配同一个到期日，搜索时就只剩这一批——否则种子和前面用例留下的码会混进来，
   * 行数断言就不成立了。
   */
  const day = "2033-11-22";
  const total = PAGE_SIZE + 1;
  const codes: string[] = [];
  for (let index = 0; index < total; index += 1) {
    const invite = await createInvite(api, { expiresAt: `${day}T00:00:00.000Z` });
    codes.push(invite.code);
  }

  await openInvites(page);
  await searchInvites(page, day);

  await expect(inviteRows(page), "第一页只该给 50 条").toHaveCount(PAGE_SIZE);
  await expect(loadedCount(page)).toHaveText(`Loaded ${PAGE_SIZE} of ${total}`);
  await expect(loadMoreButton(page)).toBeVisible();

  await flow.click(loadMoreButton(page), LIST_INVITES);

  await expect(inviteRows(page), "点完必须把剩下那条补上").toHaveCount(total);
  await expect(loadedCount(page)).toHaveText(`Loaded ${total} of ${total}`);
  await expect(loadMoreButton(page), "取完了按钮就该消失，否则点下去是空转").toHaveCount(0);

  /* 51 条的 created_at 精确到秒，多半是同一个值——游标必须靠 id 兜住这种并列，
     否则翻页会重复或漏掉。逐个点名，重复和缺失都跑不掉。 */
  for (const code of codes) {
    await expect(inviteRow(page, code), `${code} 应当在补齐后的列表里`).toHaveCount(1);
  }
});
