import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { createThrowawayMember, uniqueTag } from "../../support/members";
import { expect, readJson, test } from "../../support/test";
import { dialogTitled, expectNoDialog, field, topDialog } from "../../support/ui";

/*
 * 后台「成员管理」页签里会写库的单人操作：新建成员弹窗、行操作菜单、成员详情弹窗。
 *
 * 靶子一律是本条用例自己造的一次性成员（support/members.ts 里说明了原因）：
 * 改角色和停用都不会被运行收尾还原，拿种子成员开刀等于把后面所有用例的前提改掉，
 * 而收尾指纹只数行数，这种「行数没变、内容变了」的污染一条都查不出来。
 *
 * 每条用例的验收都要走完整条链路：控件 → 请求发出且服务端接受 → 界面变了 →
 * 回读服务端数据也变了。只看界面等于没验——乐观更新和真正落库在界面上长得一模一样。
 */

const ROLE_CHANGE = { method: "PATCH", path: /^\/api\/admin\/users\/[^/]+\/role$/ } as const;
const DEACTIVATE = { method: "PATCH", path: /^\/api\/admin\/users\/[^/]+\/deactivate$/ } as const;
const REACTIVATE = { method: "PATCH", path: /^\/api\/admin\/users\/[^/]+\/reactivate$/ } as const;
const CREATE_MEMBER = { method: "POST", path: /^\/api\/admin\/users$/ } as const;
const SAVE_PROFILE = { method: "PATCH", path: /^\/api\/users\/[^/]+\/profile$/ } as const;

type ServerMember = {
  user: { id: string; username: string; role: string; is_active: boolean };
  profile: { power: number; notes: string | null };
};

function searchBox(page: Page): Locator {
  return page.getByRole("textbox", { name: "Search members", exact: true });
}
function memberRow(page: Page, username: string): Locator {
  return page.getByRole("row", { name: `${username} member row`, exact: true });
}
function actionMenu(page: Page): Locator {
  return page.locator("[data-admin-user-action-menu]");
}
function menuItem(page: Page, name: string): Locator {
  return page.getByRole("menuitem", { name, exact: true });
}
/**
 * 断言弹出了这句通知。
 * notifications.show({ message }) 渲染进的是 Notification 的 description 槽，不是 title；
 * 一次操作可能同时弹好几条（例如业务提示 + 全局错误提示），所以按文案挑，不按顺序取。
 */
async function expectNotified(page: Page, text: string): Promise<void> {
  await expect(
    page.locator(".mantine-Notification-description").filter({ hasText: text }),
    `没有弹出通知「${text}」`,
  ).toBeVisible();
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

/** 进成员页签并把列表缩到本条用例造的那几个成员上。 */
async function openMembers(page: Page, tag: string): Promise<void> {
  await page.goto("/admin");
  await expect(searchBox(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
  await searchBox(page).fill(tag);
}

/**
 * 打开某一行的操作菜单。
 * 「Actions」这个无障碍名在移动端卡片上还有一份（只是被 CSS 藏了，DOM 里一直在），
 * 所以必须限定在目标行里取，否则每次都撞 strict mode violation。
 */
async function openRowMenu(page: Page, username: string): Promise<void> {
  await memberRow(page, username).getByRole("button", { name: "Actions", exact: true }).click();
  await expect(actionMenu(page)).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  /* 重置密码和复制行都把结果写进剪贴板，没有这个权限那两条用例验不到终点。 */
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test("新建成员弹窗：用户名太短当场退回、一个请求都不发；填对之后建号、给临时密码、备注一起落库", async ({ page, api, flow }) => {
  const tag = uniqueTag("new");
  await openMembers(page, tag);
  await expect(page.getByRole("row", { name: /member row$/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Create Member", exact: true }).click();
  const dialog = dialogTitled(page, "Add Member");
  await expect(dialog).toBeVisible();

  const submit = dialog.getByRole("button", { name: "Create", exact: true });
  await expect(submit, "用户名为空时提交按钮就是禁用的").toBeDisabled();

  /* 前端自己拦下的非法用户名不该惊动服务端。 */
  await field(dialog, "Username").fill("ab");
  await expect(submit).toBeEnabled();
  await flow.clickWithoutApi(submit);
  await expectNotified(page, "Username must be 3-50 characters: letters, numbers, and underscores only.");
  await expect(dialog, "校验没过时弹窗必须留在原地").toBeVisible();

  const username = `e2e_${tag}_ui`;
  await field(dialog, "Username").fill(username);
  await field(dialog, "Notes").fill("created by e2e");
  await flow.click(submit, CREATE_MEMBER);

  /* 临时密码是这个流程唯一的产出物，看不到就等于建了个没人能登的号。 */
  await expect(dialog.getByText(`Member "${username}" created successfully.`)).toBeVisible();
  const temporaryPassword = await dialog.locator("input[readonly]").inputValue();
  expect(temporaryPassword.length, "临时密码不能是空的").toBeGreaterThan(0);

  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expectNoDialog(page);

  await expect(memberRow(page, username), "建完必须直接出现在表里，不用手动刷新").toBeVisible();
  const created = (await serverMembers(api)).find((row) => row.user.username === username);
  expect(created, "服务端必须真的多出这个成员").toBeTruthy();
  expect(created?.profile.notes, "备注框填的内容也要跟着落库").toBe("created by e2e");
  expect(created?.user.role).toBe("member");
  expect(created?.user.is_active).toBe(true);
});

test("行菜单改角色：表格里的角色胶囊和服务端的角色一起变", async ({ page, api, flow }) => {
  const tag = uniqueTag("role");
  const member = await createThrowawayMember(api, tag);
  await openMembers(page, tag);
  await expect(memberRow(page, member.username).locator(".admin-cell-role")).toHaveText("Member");

  await openRowMenu(page, member.username);
  await menuItem(page, "Change Role").click();
  await flow.click(menuItem(page, "Moderator"), ROLE_CHANGE);

  await expect(memberRow(page, member.username).locator(".admin-cell-role")).toHaveText("Moderator");
  expect((await serverMember(api, member.id)).user.role, "服务端的角色必须真的改了").toBe("moderator");
});

test("行菜单停用再启用：状态列、菜单项和服务端三处始终一致", async ({ page, api, flow }) => {
  const tag = uniqueTag("act");
  const member = await createThrowawayMember(api, tag);
  await openMembers(page, tag);

  const status = memberRow(page, member.username).locator(".admin-cell-status");
  await expect(status).toHaveClass(/admin-cell-status--active/);

  await openRowMenu(page, member.username);
  await expect(menuItem(page, "Reactivate"), "已启用的成员不该出现「启用」项").toHaveCount(0);
  await flow.click(menuItem(page, "Deactivate"), DEACTIVATE);

  await expect(status).toHaveClass(/admin-cell-status--inactive/);
  expect((await serverMember(api, member.id)).user.is_active).toBe(false);

  await openRowMenu(page, member.username);
  await expect(menuItem(page, "Deactivate"), "已停用的成员不该出现「停用」项").toHaveCount(0);
  await flow.click(menuItem(page, "Reactivate"), REACTIVATE);

  await expect(status).toHaveClass(/admin-cell-status--active/);
  expect((await serverMember(api, member.id)).user.is_active).toBe(true);
});

test("行菜单复制这一行：剪贴板里拿到的是这一行的五个字段，且不碰网络", async ({ page, api, flow }) => {
  const tag = uniqueTag("copy");
  const member = await createThrowawayMember(api, tag);
  await openMembers(page, tag);

  await openRowMenu(page, member.username);
  await flow.clickWithoutApi(menuItem(page, "Copy Row"));

  /* Windows 的剪贴板会把 LF 换成 CRLF，这是平台行为不是应用行为，先归一化再比。 */
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
  /*
   * 格式如实记录：用户名、职业、战力、角色、状态，逗号分隔，末尾一个换行。
   * 新建的成员没有职业、战力为 0，所以第二段是空的。
   * 角色这一段复制出来的是内部 id（member），而表格里显示的是名称（Member）——
   * 同一列在屏幕上和剪贴板里是两套写法，粘到别处对不上号。
   */
  expect(copied).toBe(`${member.username}, , 0, member, active\n`);
});

test("成员详情弹窗：改战力保存，资料确实落库；但状态那一步必定 409，整个保存被报成部分失败", async ({ page, api, flow }) => {
  const tag = uniqueTag("detail");
  const member = await createThrowawayMember(api, tag);
  await openMembers(page, tag);

  await memberRow(page, member.username).dblclick();
  const dialog = topDialog(page);
  await expect(
    dialog.getByRole("heading", { name: `Member Detail · ${member.username}`, exact: true }),
  ).toBeVisible();

  await field(dialog, "Power").fill("12345");
  /*
   * 保存是三个请求串起来的：资料 → 角色 → 启用状态（useAdminMutations.ts:227）。
   * 这里等的是第一个；后两个的成败只体现在提示上，所以必须回读服务端确认。
   */
  await flow.click(dialog.getByRole("button", { name: "Save Profile", exact: true }), SAVE_PROFILE);

  /*
   * 现状如实记录，这是一处缺陷，而且是每次保存都会撞上的：
   * 第三步无条件按开关当前的值发一次请求——开关是「启用」就调 reactivate，
   * 是「停用」就调 deactivate。可服务端对这两个接口都做了幂等拒绝
   * （AdminService.ts:493 "User is already active" / :480 "User already deactivated"），
   * 于是只要这次保存没有真的翻转状态，第三步必定 409。
   * 结果就是：资料和角色明明存好了，管理员每次看到的都是一句「部分失败」，
   * 外加一句全局的「Conflict detected. Please refresh and try again.」。
   * 该修的是那一步——只在状态真的变了时才发请求。修好之后把下面两行换成
   * 断言 "Member profile saved"。
   */
  await expectNotified(page, "Profile and role saved, but status update failed");
  await expectNotified(page, "Conflict detected. Please refresh and try again.");

  const saved = await serverMember(api, member.id);
  expect(saved.profile.power, "第三步失败不该连累前两步：战力必须真的落库了").toBe(12345);
  expect(saved.user.is_active, "状态本来就没改，应当还是启用").toBe(true);

  await page.keyboard.press("Escape");
  const unsavedDialog = dialogTitled(page, "Unsaved changes");
  await expect(
    unsavedDialog,
    "复合保存有一步失败时表单仍是 dirty，关闭必须先让管理员确认，不能静默丢弃",
  ).toBeVisible();
  await flow.clickWithoutApi(unsavedDialog.getByRole("button", { name: "Leave", exact: true }));
  await expectNoDialog(page);
  await expect(
    memberRow(page, member.username).locator("td[data-column-id='power']"),
    "列表要跟着刷新，不能还显示旧数字",
  ).toHaveText("12,345");
});
