import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { uniqueTag } from "../../support/members";
import { expect, readJson, test } from "../../support/test";
import { confirmDialog, dialogTitled, expectNoDialog, field } from "../../support/ui";

/*
 * 后台「角色」页签：左边角色清单 + 右边权限面板。
 *
 * 这一页改的是全站的授权规则，验收必须落到服务端的权限记录上——界面里的勾选状态
 * 只是个草稿（drafts），不点保存永远不会落库，光看按钮亮没亮等于什么都没验。
 *
 * 靶子一律是本条用例自己建的自定义角色：内置角色（admin/moderator/member）改了
 * 不会被运行收尾还原，而收尾指纹只数行数，「行数没变、权限变了」这种污染查不出来，
 * 后面所有用例都会跑在一份被悄悄提权过的数据上。自建角色走 POST /api/admin/roles，
 * 会被登记进本次运行的清理注册表，收尾时按 id 删掉。
 */

const CREATE_ROLE = { method: "POST", path: /^\/api\/admin\/roles$/, status: 201 } as const;
const UPDATE_ROLE = { method: "PATCH", path: /^\/api\/admin\/roles\/[^/]+$/ } as const;
const DELETE_ROLE = { method: "DELETE", path: /^\/api\/admin\/roles\/[^/]+$/ } as const;

/* 自建角色的默认级别。必须低于 admin 自己的级别，服务端会挡（AdminService.ts:548）。 */
const CUSTOM_LEVEL = 100;

type ServerRole = {
  id: string;
  name: string;
  level: number;
  color: string | null;
  is_builtin: boolean;
  permissions: Record<string, boolean>;
  assigned_user_count: number;
};

/* 主从版式的三件套（.admin-md）由角色 / 徽章 / 职业共用，每个页签单独渲染，不会撞车。 */
function sidebar(page: Page): Locator {
  return page.locator(".admin-md__master");
}
function roleItem(page: Page, name: string): Locator {
  return page.locator(".admin-md__item").filter({ hasText: name });
}
function detail(page: Page): Locator {
  return page.locator(".admin-md__detail");
}
function saveButton(page: Page): Locator {
  return detail(page).getByRole("button", { name: "Save Role", exact: true });
}
/** 权限开关：无障碍名就是那条权限的说明文案，选中与否记在 aria-pressed 上。 */
function permission(page: Page, label: string): Locator {
  return detail(page).getByRole("button", { name: label, exact: true });
}

async function serverRoles(api: APIRequestContext): Promise<ServerRole[]> {
  return await readJson(await api.get("/api/admin/roles"), "读取角色列表") as ServerRole[];
}

async function serverRole(api: APIRequestContext, roleId: string): Promise<ServerRole> {
  const found = (await serverRoles(api)).find((role) => role.id === roleId);
  expect(found, `服务端找不到角色 ${roleId}`).toBeTruthy();
  return found as ServerRole;
}

/** 直接建一个自定义角色当靶子：本条用例要验的是编辑和删除，建的过程另有用例专门验。 */
async function createServerRole(api: APIRequestContext, name: string): Promise<ServerRole> {
  return await readJson(
    await api.post("/api/admin/roles", { data: { name, level: CUSTOM_LEVEL, color: null } }),
    `创建角色 ${name}`,
  ) as ServerRole;
}

async function openRoles(page: Page): Promise<void> {
  await page.goto("/admin?tab=roles");
  /* 页签在界面上叫「Permissions」，tab 参数才叫 roles。 */
  await expect(page.getByRole("tab", { name: /Permissions/ })).toHaveAttribute("aria-selected", "true");
  await expect(sidebar(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
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

test("新建角色：名字为空提交不了，建成之后是一个级别 100、一条权限都没有的空角色", async ({ page, api, flow }) => {
  const name = `E2E ${uniqueTag("role")}`;
  await openRoles(page);
  await expect(roleItem(page, name)).toHaveCount(0);

  await sidebar(page).getByRole("button", { name: "Create Role", exact: true }).click();
  const dialog = dialogTitled(page, "Create Role");
  await expect(dialog).toBeVisible();

  const submit = dialog.getByRole("button", { name: "Create Role", exact: true });
  await expect(submit, "名字为空时提交按钮就是禁用的").toBeDisabled();

  /* 只有空白字符同样不算名字，而且不该惊动服务端。 */
  await field(dialog, "Display Name").fill("   ");
  await expect(submit, "只填空格等于没填").toBeDisabled();

  await field(dialog, "Display Name").fill(name);
  await expect(submit).toBeEnabled();
  const created = await flow.click(submit, CREATE_ROLE) as ServerRole;
  await expectNotified(page, "Role created");
  await expectNoDialog(page);

  await expect(roleItem(page, name), "建完必须直接出现在清单里，不用手动刷新").toBeVisible();

  const saved = await serverRole(api, created.id);
  expect(saved.name, "服务端存的就是刚才填的名字").toBe(name);
  expect(saved.level, "新角色的默认级别").toBe(CUSTOM_LEVEL);
  expect(saved.is_builtin, "自建角色不能被标成内置的，否则它自己就再也删不掉了").toBe(false);
  expect(
    Object.values(saved.permissions).some(Boolean),
    "新角色必须是零权限的——默认给权限等于凭空造出一个提权入口",
  ).toBe(false);
  expect(saved.assigned_user_count, "刚建出来还没人").toBe(0);
});

test("编辑角色：没改动时保存是禁用的；改完名字、级别和权限，服务端三处一起变", async ({ page, api, flow }) => {
  const role = await createServerRole(api, `E2E ${uniqueTag("edit")}`);
  const renamed = `${role.name} renamed`;
  await openRoles(page);

  await roleItem(page, role.name).click();
  await expect(detail(page).getByText(`Assigned: ${role.assigned_user_count}`)).toBeVisible();
  await expect(saveButton(page), "什么都没改的时候保存必须是禁用的").toBeDisabled();

  const granted = "View member list";
  const untouched = "Delete members";
  await expect(permission(page, granted)).toHaveAttribute("aria-pressed", "false");

  await field(detail(page), "Display Name").fill(renamed);
  await field(detail(page), "Level").fill("250");
  await field(detail(page), "Color").fill("#22c55e");
  await permission(page, granted).click();

  await expect(permission(page, granted), "点一下就该翻成已授予").toHaveAttribute("aria-pressed", "true");
  /*
   * 清单上显示的始终是服务端存的名字，不是草稿里的——改名要到保存之后才会反映到左边，
   * 所以这里仍然按原名去找那一行。
   */
  await expect(
    roleItem(page, role.name).getByText("*", { exact: true }),
    "有未保存改动时清单上要有记号，否则切走就丢了也没人知道",
  ).toBeVisible();
  await expect(saveButton(page)).toBeEnabled();

  /* 改动到此为止都只在草稿里，服务端应当还是原样。 */
  const beforeSave = await serverRole(api, role.id);
  expect(beforeSave.name, "没点保存就落库的话，这一页就没有「取消」可言了").toBe(role.name);
  expect(beforeSave.permissions["admin.users.view"], "草稿里的勾选同样不该提前落库").toBe(false);

  await flow.click(saveButton(page), UPDATE_ROLE);
  await expectNotified(page, "Role configuration saved");

  const saved = await serverRole(api, role.id);
  expect(saved.name).toBe(renamed);
  expect(saved.level).toBe(250);
  expect(saved.color, "颜色也要跟着落库").toBe("#22c55e");
  expect(saved.permissions["admin.users.view"], "勾上的权限必须真的生效").toBe(true);
  expect(saved.permissions["admin.users.delete"], "没碰的权限一条都不能被顺手打开").toBe(false);

  await expect(saveButton(page), "存完之后草稿和服务端一致，保存该回到禁用").toBeDisabled();
  await expect(roleItem(page, renamed).getByText("*", { exact: true })).toHaveCount(0);
  await expect(permission(page, untouched)).toHaveAttribute("aria-pressed", "false");
});

test("内置角色只读：名称级别都不能改，权限按钮点不动，也没有删除入口", async ({ page }) => {
  await openRoles(page);

  await roleItem(page, "Admin").first().click();
  await expect(
    roleItem(page, "Admin").first().getByText("Built-in"),
    "清单上要标出这是内置角色",
  ).toBeVisible();

  await expect(field(detail(page), "Display Name"), "内置角色改名会让权限判定和界面对不上").toBeDisabled();
  await expect(field(detail(page), "Level")).toBeDisabled();
  await expect(
    detail(page).getByRole("button", { name: "Delete", exact: true }),
    "内置角色不该有删除入口——删掉 admin 就再也没人能进后台了",
  ).toHaveCount(0);

  const toggle = permission(page, "Manage roles");
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  /* 禁用的按钮点了本就不该有反应，这里连带确认它没有偷偷发请求。 */
  await expectNoApiCalls(page, () => toggle.click({ force: true }));
  await expect(toggle, "点完还是原来的样子").toHaveAttribute("aria-pressed", "true");
});

test("删除角色：确认框取消什么都不做；确认之后清单和服务端一起消失", async ({ page, api, flow }) => {
  const role = await createServerRole(api, `E2E ${uniqueTag("del")}`);
  await openRoles(page);
  await roleItem(page, role.name).click();

  await detail(page).getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = await confirmDialog(page, "Delete role?");
  await expect(dialog, "确认框要点名删的是哪一个").toContainText(role.name);

  await expectNoApiCalls(page, async () => {
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expectNoDialog(page);
  });
  await expect(roleItem(page, role.name), "取消之后角色必须原封不动").toBeVisible();
  expect((await serverRole(api, role.id)).name, "取消之后服务端也不能少东西").toBe(role.name);

  await detail(page).getByRole("button", { name: "Delete", exact: true }).click();
  const again = await confirmDialog(page, "Delete role?");
  await flow.click(again.getByRole("button", { name: "Delete", exact: true }), DELETE_ROLE);
  await expectNotified(page, "Role deleted");

  await expect(roleItem(page, role.name), "删完这一行就该从清单里消失").toHaveCount(0);
  expect(
    (await serverRoles(api)).some((row) => row.id === role.id),
    "服务端也不能再查到它，否则界面和授权规则就对不上了",
  ).toBe(false);
});

test("切换角色：右边跟着换人；但切走再切回来，没保存的改动被静默丢掉", async ({ page, api }) => {
  const first = await createServerRole(api, `E2E ${uniqueTag("swapA")}`);
  const second = await createServerRole(api, `E2E ${uniqueTag("swapB")}`);
  await openRoles(page);

  /* 角色清单是进页签时一次取回来的，切换纯前端，不该再发请求。 */
  await expectNoApiCalls(page, () => roleItem(page, first.name).click());
  await expect(field(detail(page), "Display Name")).toHaveValue(first.name);

  await field(detail(page), "Level").fill("321");
  await expect(roleItem(page, first.name).getByText("*", { exact: true })).toBeVisible();

  await expectNoApiCalls(page, () => roleItem(page, second.name).click());
  await expect(field(detail(page), "Display Name")).toHaveValue(second.name);
  await expect(
    field(detail(page), "Level"),
    "另一个角色的级别不能被上一个的草稿带跑",
  ).toHaveValue(String(CUSTOM_LEVEL));

  await roleItem(page, first.name).click();
  /*
   * 现状如实记录，这是一处缺陷：
   * 那个重建草稿的 effect 把 selectedRoleId 也列进了依赖（AdminRolesSection.tsx:282-291），
   * 于是每选一次角色，所有角色的草稿都被服务端数据整个覆盖一遍。
   * 结果就是：改了级别、勾了权限，只要手一滑点到清单里另一个角色，改动当场消失，
   * 连那个专门用来提醒「有未保存改动」的星号也跟着没了——提醒和被提醒的东西一起被抹掉。
   * 修的时候把 effect 的依赖收敛成 [roles]（选中项的兜底另用一个 effect），
   * 然后把下面两行换成断言级别仍是 321、保存按钮仍可点。
   */
  await expect(
    field(detail(page), "Level"),
    "切回来时草稿已经被重置回服务端的值",
  ).toHaveValue(String(CUSTOM_LEVEL));
  await expect(saveButton(page), "改动没了，保存自然也就灰了").toBeDisabled();

  /* 无论如何，这条用例没点过保存，服务端必须还是原样。 */
  expect((await serverRole(api, first.id)).level).toBe(CUSTOM_LEVEL);
});
