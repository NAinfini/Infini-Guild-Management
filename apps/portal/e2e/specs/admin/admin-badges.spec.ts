import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { createThrowawayMember, uniqueTag } from "../../support/members";
import { expect, readJson, test } from "../../support/test";
import { confirmDialog, expectNoDialog, field } from "../../support/ui";

/*
 * 后台「徽章」页签：左边清单、右边详情的主从结构（和角色、职业共用 .admin-md），
 * 成员分配是详情里就地展开的面板，不再是弹窗。
 *
 * 靶子一律是本条用例自己建的徽章（POST /api/badges 会登记进本次运行的清理注册表）。
 * 分配关系那张表没有登记机制，所以凡是本用例挂上去的分配，都必须在同一条用例里摘下来——
 * 收尾指纹会数 member_badge_assignments 的行数，留一行整轮 e2e 就算「没清干净」。
 * 顺带这也正是「移除」这个控件本来就该验的事。
 */

const CREATE_BADGE = { method: "POST", path: /^\/api\/badges$/, status: 201 } as const;
const UPDATE_BADGE = { method: "PATCH", path: /^\/api\/badges\/[^/]+$/ } as const;
const DELETE_BADGE = { method: "DELETE", path: /^\/api\/badges\/[^/]+$/ } as const;
const ASSIGN_BADGE = { method: "POST", path: /^\/api\/badges\/[^/]+\/assign$/ } as const;
const UNASSIGN_BADGE = { method: "POST", path: /^\/api\/badges\/[^/]+\/unassign$/ } as const;

type ServerBadge = {
  id: string;
  name: string;
  label_html: string;
  color: string;
  description: string | null;
  sort_order: number;
};
type ServerAssignment = { user_id: string; username: string | null };

function sidebar(page: Page): Locator {
  return page.locator(".admin-md__master");
}
function detail(page: Page): Locator {
  return page.locator(".admin-md__detail");
}
function badgeItem(page: Page, name: string): Locator {
  return page.locator(".admin-md__item").filter({ hasText: name });
}
/* 分配面板：详情里的一块，不是弹窗，所以要断言「收起」而不是「不存在」。 */
function assignPanel(page: Page): Locator {
  return detail(page).locator(".admin-badge-assign");
}
/*
 * Mantine ColorInput 的预设色板在挂到 body 的下拉里，按钮的无障碍名就是色值本身。
 * 点完色板下拉不会自己关（closeOnColorSwatchClick 默认关闭），而它正好压在下面的
 * 提交按钮上——Esc 也收不掉，因为焦点这时在浮层里的色板按钮上，不在输入框上。
 * 只能点一下外面：详情标题栏离色板最远，点它不会误触任何控件。
 */
async function pickPresetColor(page: Page, hex: string): Promise<void> {
  await field(detail(page), "Color").click();
  await page.locator(`button[aria-label="${hex}"]`).click();
  await detail(page).locator(".admin-md__detail-head").click();
  await expect(field(detail(page), "Color")).toHaveValue(hex);
}
/* 侧栏那个「+」和详情里的提交按钮共用同一句译文，只能靠作用域区分。 */
function newBadgeButton(page: Page): Locator {
  return sidebar(page).getByRole("button", { name: "Create Badge", exact: true });
}
function submitCreateButton(page: Page): Locator {
  return detail(page).getByRole("button", { name: "Create Badge", exact: true });
}

async function serverBadges(api: APIRequestContext): Promise<ServerBadge[]> {
  return await readJson(await api.get("/api/badges"), "读取徽章列表") as ServerBadge[];
}

async function serverBadge(api: APIRequestContext, id: string): Promise<ServerBadge> {
  const found = (await serverBadges(api)).find((row) => row.id === id);
  expect(found, `服务端找不到徽章 ${id}`).toBeTruthy();
  return found as ServerBadge;
}

async function serverAssignments(api: APIRequestContext, id: string): Promise<ServerAssignment[]> {
  return await readJson(await api.get(`/api/badges/${id}/assignments`), "读取徽章分配") as ServerAssignment[];
}

/** 直接建一个徽章当靶子：建的过程另有用例专门验。 */
async function createServerBadge(api: APIRequestContext, name: string): Promise<ServerBadge> {
  return await readJson(
    await api.post("/api/badges", {
      data: { name, label_html: `★ ${name}`, color: "#D4A843", description: "e2e fixture", sort_order: 0 },
    }),
    `创建徽章 ${name}`,
  ) as ServerBadge;
}

async function openBadges(page: Page): Promise<void> {
  await page.goto("/admin?tab=badges");
  await expect(page.getByRole("tab", { name: /Badges/ })).toHaveAttribute("aria-selected", "true");
  await expect(sidebar(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
}

async function expectNotified(page: Page, text: string): Promise<void> {
  await expect(
    page.locator(".mantine-Notification-description").filter({ hasText: text }),
    `没有弹出通知「${text}」`,
  ).toBeVisible();
}

test("新建徽章：名称和标签都填了才让提交；建完自动选中，颜色和描述原样落库", async ({ page, api, flow }) => {
  const name = `E2E ${uniqueTag("badge")}`;
  await openBadges(page);

  await newBadgeButton(page).click();
  await expect(detail(page).getByText("New Badge", { exact: true })).toBeVisible();

  const submit = submitCreateButton(page);
  await expect(submit, "两个必填都空着时不该能提交").toBeDisabled();
  await field(detail(page), "Badge Name").fill(name);
  await expect(submit, "只填名称、没有标签，提交出来会是一枚看不见的徽章").toBeDisabled();
  await field(detail(page), "Label (HTML/Emoji)").fill(`★ ${name}`);
  await expect(submit).toBeEnabled();

  await field(detail(page), "Description (optional)").fill("e2e created");
  await pickPresetColor(page, "#22c55e");
  await expect(
    detail(page).locator(".admin-badge-preview__pill"),
    "填了标签就该出现预览，否则管理员看不出这枚徽章长什么样",
  ).toHaveText(`★ ${name}`);

  const created = await flow.click(submit, CREATE_BADGE) as ServerBadge;
  await expectNotified(page, "Badge created");

  const saved = await serverBadge(api, created.id);
  expect(saved.name).toBe(name);
  expect(saved.label_html).toBe(`★ ${name}`);
  expect(saved.color, "点过的色板要真的落库").toBe("#22c55e");
  expect(saved.description).toBe("e2e created");

  await expect(badgeItem(page, name), "建完要出现在左边清单里").toBeVisible();
  await expect(
    detail(page).getByText(name, { exact: true }),
    "建完应当直接选中它，而不是把人丢回空白页再找一遍",
  ).toBeVisible();
  await expect(detail(page).getByText("0 assigned", { exact: true })).toBeVisible();
});

test("新建取消：不发请求，右边回到未选中状态", async ({ page, api, flow }) => {
  await openBadges(page);
  const before = (await serverBadges(api)).length;

  await newBadgeButton(page).click();
  await field(detail(page), "Badge Name").fill("throwaway");
  await field(detail(page), "Label (HTML/Emoji)").fill("throwaway");
  await flow.clickWithoutApi(detail(page).getByRole("button", { name: "Cancel", exact: true }));

  await expect(detail(page).getByText("Select a badge to manage")).toBeVisible();
  expect((await serverBadges(api)).length, "取消不能留下任何一行").toBe(before);
});

test("编辑徽章：点清单选中，改名和改描述都落到服务端，取消则不动", async ({ page, api, flow }) => {
  const badge = await createServerBadge(api, `E2E ${uniqueTag("edit")}`);
  const renamed = `${badge.name} v2`;
  await openBadges(page);

  await badgeItem(page, badge.name).click();
  await expect(detail(page).getByText(badge.name, { exact: true }), "点清单要把详情切过去").toBeVisible();

  /* 先验取消。 */
  await detail(page).getByRole("button", { name: "Edit Badge", exact: true }).click();
  await field(detail(page), "Badge Name").fill("throwaway");
  await flow.clickWithoutApi(detail(page).getByRole("button", { name: "Cancel", exact: true }));
  expect((await serverBadge(api, badge.id)).name, "取消之后名字不能变").toBe(badge.name);

  await detail(page).getByRole("button", { name: "Edit Badge", exact: true }).click();
  await expect(
    field(detail(page), "Badge Name"),
    "打开编辑要带出现有值，而不是一张空表",
  ).toHaveValue(badge.name);
  await expect(field(detail(page), "Description (optional)")).toHaveValue("e2e fixture");

  await field(detail(page), "Badge Name").fill(renamed);
  await field(detail(page), "Description (optional)").fill("e2e updated");
  await flow.click(detail(page).getByRole("button", { name: "Save", exact: true }), UPDATE_BADGE);
  await expectNotified(page, "Badge updated");

  const saved = await serverBadge(api, badge.id);
  expect(saved.name).toBe(renamed);
  expect(saved.description).toBe("e2e updated");
  expect(saved.label_html, "没碰的字段不能被顺手改掉").toBe(badge.label_html);
  await expect(badgeItem(page, renamed), "左边清单要跟着刷新").toBeVisible();
});

test("分配与移除：勾人才让提交，分配后候选里不再出现他，移除后两边都归零", async ({ page, api, flow }) => {
  const badge = await createServerBadge(api, `E2E ${uniqueTag("assign")}`);
  const member = await createThrowawayMember(api, uniqueTag("bm"));
  await openBadges(page);
  await badgeItem(page, badge.name).click();
  await expect(detail(page).getByText("No members assigned to this badge.")).toBeVisible();

  const manage = detail(page).getByRole("button", { name: "Manage Members", exact: true });
  await expect(assignPanel(page), "没点之前面板是收起的").toBeHidden();
  await manage.click();
  const panel = assignPanel(page);
  await expect(panel).toBeVisible();
  const assignButton = panel.getByRole("button", { name: /^Assign \(\d+\)$/ });
  await expect(assignButton, "一个人都没勾时不该能提交").toBeDisabled();

  await panel.getByPlaceholder("Search members...").fill(member.username);
  await expect(panel.getByRole("checkbox"), "搜索要把候选收敛到那一个人").toHaveCount(1);
  await panel.getByRole("checkbox", { name: member.username, exact: true }).check();
  await expect(assignButton, "按钮上的数字就是将要分配的人数").toHaveText("Assign (1)");

  await flow.click(assignButton, ASSIGN_BADGE);
  await expectNotified(page, "Badge assigned to 1 member(s)");
  await expect(panel, "分配成功之后面板自己收起来").toBeHidden();

  expect(
    (await serverAssignments(api, badge.id)).map((row) => row.user_id),
    "服务端得真的挂上这条分配",
  ).toEqual([member.id]);
  await expect(detail(page).getByText("1 assigned", { exact: true })).toBeVisible();
  await expect(detail(page).getByText(member.username, { exact: true })).toBeVisible();

  /* 已经有这枚徽章的人不该再出现在候选里，否则会重复分配。 */
  await manage.click();
  await expect(panel).toBeVisible();
  await panel.getByPlaceholder("Search members...").fill(member.username);
  await expect(panel.getByRole("checkbox")).toHaveCount(0);
  await expect(panel.getByText("Every member already has this badge.")).toBeVisible();
  /*
   * 折进详情之后，候选空了也不再挡住下方的已有成员名单——这正是从弹窗改过来的理由，
   * 顺手在这里钉住。
   */
  await expect(detail(page).getByText(member.username, { exact: true })).toBeVisible();
  await flow.clickWithoutApi(panel.getByRole("button", { name: "Cancel", exact: true }));
  await expect(panel).toBeHidden();

  await flow.click(detail(page).getByRole("button", { name: "Remove", exact: true }), UNASSIGN_BADGE);
  await expectNotified(page, "Badge removed from 1 member(s)");
  expect(await serverAssignments(api, badge.id), "移除之后服务端不能再留着这条分配").toEqual([]);
  await expect(detail(page).getByText("0 assigned", { exact: true })).toBeVisible();
  await expect(detail(page).getByText("No members assigned to this badge.")).toBeVisible();
});

test("删除徽章：确认框取消什么都不做；确认之后清单、详情和服务端一起清干净", async ({ page, api, flow }) => {
  const badge = await createServerBadge(api, `E2E ${uniqueTag("del")}`);
  await openBadges(page);
  await badgeItem(page, badge.name).click();

  await detail(page).getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = await confirmDialog(page, "Delete badge?");
  await expect(dialog, "确认框要点名删的是哪一枚").toContainText(badge.name);
  await flow.clickWithoutApi(dialog.getByRole("button", { name: "Cancel", exact: true }));
  await expectNoDialog(page);
  await expect(badgeItem(page, badge.name), "取消之后它必须还在").toBeVisible();

  await detail(page).getByRole("button", { name: "Delete", exact: true }).click();
  const confirmed = await confirmDialog(page, "Delete badge?");
  await flow.click(confirmed.getByRole("button", { name: "Delete", exact: true }), DELETE_BADGE);
  await expectNotified(page, "Badge deleted");

  await expect(badgeItem(page, badge.name)).toHaveCount(0);
  await expect(
    detail(page).getByText("Select a badge to manage"),
    "删掉当前选中项之后，右边不能还停在一个已经不存在的徽章上",
  ).toBeVisible();
  expect(
    (await serverBadges(api)).some((row) => row.id === badge.id),
    "服务端也不能再查到它",
  ).toBe(false);
});
