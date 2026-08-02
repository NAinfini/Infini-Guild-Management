import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { createThrowawayMember, uniqueTag, type ThrowawayMember } from "../../support/members";
import { expect, readJson, test } from "../../support/test";
import { confirmDialog, expectNoDialog } from "../../support/ui";

/*
 * 选择条上的四件批量操作：改角色、启用、停用、删除。
 *
 * 每一件都隔着一个确认框，所以每条用例都要把两条路都走一遍——
 * 取消必须真的什么都不发（确认框形同虚设是最容易漏的一类缺陷），
 * 确认之后必须回读服务端逐个核对。批量接口一次改多条，只核对其中一条
 * 等于放过「只改了第一个」这种最典型的批量 bug。
 */

const BATCH_ROLE = { method: "PATCH", path: /^\/api\/admin\/users\/batch\/role$/ } as const;
const BATCH_DEACTIVATE = { method: "PATCH", path: /^\/api\/admin\/users\/batch\/deactivate$/ } as const;
const BATCH_REACTIVATE = { method: "PATCH", path: /^\/api\/admin\/users\/batch\/reactivate$/ } as const;
const BATCH_DELETE = { method: "PATCH", path: /^\/api\/admin\/users\/batch\/delete$/ } as const;

const CONFIRM_TITLE = "Confirm batch action";

type ServerMember = {
  user: { id: string; username: string; role: string; is_active: boolean };
};

function searchBox(page: Page): Locator {
  return page.getByPlaceholder("Search members...");
}
function memberRow(page: Page, username: string): Locator {
  return page.getByRole("row", { name: `${username} member row`, exact: true });
}
function selectionBar(page: Page): Locator {
  return page.locator(".admin-selbar");
}

async function serverMembers(api: APIRequestContext): Promise<ServerMember[]> {
  const list = await readJson(await api.get("/api/users?page=1&limit=500"), "读取成员列表") as {
    data: ServerMember[];
  };
  return list.data;
}

async function serverMember(api: APIRequestContext, userId: string): Promise<ServerMember> {
  const found = (await serverMembers(api)).find((row) => row.user.id === userId);
  expect(found, `服务端找不到成员 ${userId}`).toBeTruthy();
  return found as ServerMember;
}

/** 造两个一次性成员，进成员页签，把列表缩到这两个，然后把它们都选上。 */
async function setUpPair(page: Page, api: APIRequestContext): Promise<[ThrowawayMember, ThrowawayMember]> {
  const tag = uniqueTag("batch");
  const first = await createThrowawayMember(api, tag);
  const second = await createThrowawayMember(api, tag);

  await page.goto("/admin");
  await expect(searchBox(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
  await searchBox(page).fill(tag);
  await expect(page.getByRole("row", { name: /member row$/ })).toHaveCount(2);

  await memberRow(page, first.username).click();
  await memberRow(page, second.username).click({ modifiers: ["ControlOrMeta"] });
  await expect(selectionBar(page).locator(".admin-selbar__count")).toHaveText(/^Selected: 2 /);
  return [first, second];
}

function batchButton(page: Page, name: string): Locator {
  return selectionBar(page).getByRole("button", { name, exact: true });
}

/** 打开确认框并确认它点名了这两个人——批量操作误伤的代价太高，名单必须摆出来。 */
async function expectConfirm(page: Page, body: string, names: string[]): Promise<Locator> {
  const dialog = await confirmDialog(page, CONFIRM_TITLE);
  await expect(dialog).toContainText(body);
  await expect(dialog).toContainText("Affected members:");
  for (const name of names) {
    await expect(dialog, `确认框里必须列出 ${name}`).toContainText(name);
  }
  return dialog;
}

/** 盯着 /api/ 证明这段操作没发请求。取消确认框必须走这条。 */
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

test("批量改角色：取消什么都不改；确认之后选中的每一个人角色都变了", async ({ page, api, flow }) => {
  const [first, second] = await setUpPair(page, api);

  await batchButton(page, "Change Role").click();
  await page.getByRole("menuitem", { name: "Moderator", exact: true }).click();
  const dialog = await expectConfirm(
    page,
    "Update role to Moderator for 2 selected member(s)?",
    [first.username, second.username],
  );

  await expectNoApiCalls(page, async () => {
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expectNoDialog(page);
  });
  expect((await serverMember(api, first.id)).user.role, "取消之后角色必须原封不动").toBe("member");

  await batchButton(page, "Change Role").click();
  await page.getByRole("menuitem", { name: "Moderator", exact: true }).click();
  const again = await confirmDialog(page, CONFIRM_TITLE);
  await flow.click(again.getByRole("button", { name: "Save", exact: true }), BATCH_ROLE);

  for (const member of [first, second]) {
    await expect(memberRow(page, member.username).locator(".admin-cell-role")).toHaveText("Moderator");
    expect((await serverMember(api, member.id)).user.role, `${member.username} 的角色`).toBe("moderator");
  }
});

test("批量停用再批量启用：两个人的状态列和服务端一起翻转，一个都不能落下", async ({ page, api, flow }) => {
  const [first, second] = await setUpPair(page, api);

  await batchButton(page, "Deactivate").click();
  const stopDialog = await expectConfirm(
    page,
    "Deactivate 2 selected member(s)?",
    [first.username, second.username],
  );
  await flow.click(stopDialog.getByRole("button", { name: "Save", exact: true }), BATCH_DEACTIVATE);

  for (const member of [first, second]) {
    await expect(memberRow(page, member.username).locator(".admin-cell-status"))
      .toHaveClass(/admin-cell-status--inactive/);
    expect((await serverMember(api, member.id)).user.is_active, `${member.username} 应当已停用`).toBe(false);
  }

  /* 批量停用不会清空选中项，所以可以直接接着批量启用。 */
  await expect(selectionBar(page).locator(".admin-selbar__count")).toHaveText(/^Selected: 2 /);
  await batchButton(page, "Reactivate").click();
  const startDialog = await expectConfirm(
    page,
    "Reactivate 2 selected member(s)?",
    [first.username, second.username],
  );
  await flow.click(startDialog.getByRole("button", { name: "Save", exact: true }), BATCH_REACTIVATE);

  for (const member of [first, second]) {
    await expect(memberRow(page, member.username).locator(".admin-cell-status"))
      .toHaveClass(/admin-cell-status--active/);
    expect((await serverMember(api, member.id)).user.is_active, `${member.username} 应当已启用`).toBe(true);
  }
});

test("批量删除：确认之后两行一起从列表消失，服务端也查不到，选中态跟着清空", async ({ page, api, flow }) => {
  const [first, second] = await setUpPair(page, api);

  await batchButton(page, "Batch Delete").click();
  const dialog = await expectConfirm(
    page,
    "Delete 2 selected member(s)?",
    [first.username, second.username],
  );
  await flow.click(dialog.getByRole("button", { name: "Save", exact: true }), BATCH_DELETE);

  await expect(page.getByRole("row", { name: /member row$/ }), "两行都该消失").toHaveCount(0);
  await expect(selectionBar(page), "删完之后选中态必须清掉，否则后面的批量操作会打在幽灵 id 上")
    .toHaveCount(0);

  const remaining = await serverMembers(api);
  for (const member of [first, second]) {
    expect(
      remaining.some((row) => row.user.id === member.id),
      `${member.username} 删除后不该再出现在成员列表里`,
    ).toBe(false);
  }
});

test("多选时的行右键菜单：标题报出选中人数，只对单人有意义的项被禁用，批量不许改成管理员", async ({ page, api }) => {
  const [first] = await setUpPair(page, api);

  await memberRow(page, first.username).getByRole("button", { name: "Actions", exact: true }).click();
  const menu = page.locator("[data-admin-user-action-menu]");
  await expect(menu).toBeVisible();
  await expect(menu, "菜单标题要报出这一次操作打在几个人身上").toContainText("2 members selected");

  await expect(
    page.getByRole("menuitem", { name: "Detail", exact: true }),
    "详情一次只能看一个人，多选时必须禁用",
  ).toBeDisabled();

  await page.getByRole("menuitem", { name: "Change Role", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Admin", exact: true }),
    "批量提权到管理员是不可逆的高风险操作，这一项必须禁用",
  ).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "Moderator", exact: true })).toBeEnabled();
});
