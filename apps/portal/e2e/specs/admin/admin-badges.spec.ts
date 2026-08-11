import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { createThrowawayMember, uniqueTag } from "../../support/members";
import { expect, readJson, test } from "../../support/test";
import { confirmDialog, expectNoDialog, field, topDialog } from "../../support/ui";

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
const REORDER_BADGES = { method: "PATCH", path: /^\/api\/badges\/reorder$/ } as const;

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
/*
 * 详情的标题行。断言「右栏停在哪一枚」只认这里：正文里可能出现同名的标签预览，
 * 整个右栏范围内按文本找会撞上它。
 */
function detailHead(page: Page): Locator {
  return detail(page).locator(".admin-md__detail-head");
}
/*
 * 成员编辑没有独立面板：详情里那份名单换状态，标题行换成这条工具栏。
 * 它在查看态是不渲染的，所以断言「不存在」而不是「收起」。
 */
function memberToolbar(page: Page): Locator {
  return detail(page).locator(".pick-list__toolbar");
}
function memberList(page: Page): Locator {
  return detail(page).locator(".pick-list__body");
}
function memberRow(page: Page, username: string): Locator {
  return detail(page).locator(".pick-list__row").filter({ hasText: username });
}
/*
 * 标签和颜色只有样式编辑器这一个入口（成员称号用的是同一个弹窗）：文本、字号、
 * 粗细在里面调，挑中的色号既拼进 label_html，也当徽章药丸的底色存下来。
 * 色板按钮的无障碍名就是色值本身（Mantine ColorPicker 的 Swatches）。
 */
async function styleLabel(page: Page, text: string, hex: string): Promise<void> {
  await detail(page).getByRole("button", { name: "Open style editor", exact: true }).click();
  const editor = topDialog(page);
  await expect(editor.getByRole("heading", { name: "Badge Label Editor", exact: true })).toBeVisible();
  await field(editor, "Label text input").fill(text);
  await editor.locator(`button[aria-label="${hex}"]`).click();
  await editor.getByRole("button", { name: "Apply to badge", exact: true }).click();
  await expect(page.getByRole("dialog"), "应用之后弹窗该自己关掉").toHaveCount(0);
}
/* 侧栏那个「+」和详情里的提交按钮共用同一句译文，只能靠作用域区分。 */
function newBadgeButton(page: Page): Locator {
  return sidebar(page).locator('button[aria-label="Create Badge"]');
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
  const response = await readJson(
    await api.get(`/api/badges/${id}/assignments`),
    "读取徽章分配",
  ) as { data: ServerAssignment[] };
  return response.data;
}

/** 直接建一个徽章当靶子：建的过程另有用例专门验。 */
async function createServerBadge(api: APIRequestContext, name: string): Promise<ServerBadge> {
  return await readJson(
    await api.post("/api/badges", {
      /* 不带 sort_order：服务端排到末尾，正好是拖拽序里「新建的在最后」。 */
      data: { name, label_html: `★ ${name}`, color: "#D4A843", description: "e2e fixture" },
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

  await styleLabel(page, `★ ${name}`, "#16a34a");
  await expect(submit).toBeEnabled();

  await field(detail(page), "Description (optional)").fill("e2e created");
  await expect(
    detail(page).locator(".member-card__badge"),
    "应用回来就该出现预览，否则管理员看不出这枚徽章长什么样",
  ).toHaveText(`★ ${name}`);

  const created = await flow.click(submit, CREATE_BADGE) as ServerBadge;
  await expectNotified(page, "Badge created");

  const saved = await serverBadge(api, created.id);
  expect(saved.name).toBe(name);
  expect(saved.label_html, "编辑器生成的是带内联样式的 span，文本要原样在里面").toContain(`★ ${name}`);
  expect(saved.label_html, "字号是在编辑器里定的，落库的 HTML 里必须带着它").toMatch(/font-size:\s*\d+px/i);
  expect(saved.color, "点过的色板既是文字色，也是徽章药丸的底色").toBe("#16a34a");
  expect(saved.description).toBe("e2e created");

  await expect(badgeItem(page, name), "建完要出现在左边清单里").toBeVisible();
  await expect(
    detail(page).getByText(name, { exact: true }),
    "建完应当直接选中它，而不是把人丢回空白页再找一遍",
  ).toBeVisible();
  await expect(detail(page).getByText("0 assigned", { exact: true })).toBeVisible();
});

test("新建取消：不发请求，右边落回清单里真实存在的那一枚", async ({ page, api, flow }) => {
  await createServerBadge(api, `E2E ${uniqueTag("cancel-anchor")}`);
  await openBadges(page);
  const before = await serverBadges(api);
  /* 右栏的不变量是「永远停在一枚真实存在的徽章上」，进页面落在第一枚。 */
  const firstName = before[0]!.name;
  await expect(detailHead(page).getByText(firstName, { exact: true })).toBeVisible();

  await newBadgeButton(page).click();
  await field(detail(page), "Badge Name").fill("throwaway");
  await styleLabel(page, "throwaway", "#dc2626");
  await flow.clickWithoutApi(detail(page).getByRole("button", { name: "Cancel", exact: true }));

  await expect(submitCreateButton(page), "取消之后新建表单要收掉").toHaveCount(0);
  await expect(
    detailHead(page).getByText(firstName, { exact: true }),
    "取消之后右栏落回第一枚，而不是停在空白详情上",
  ).toBeVisible();
  expect((await serverBadges(api)).length, "取消不能留下任何一行").toBe(before.length);
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

  /* 改样式要从现有标签接着改：编辑器带出来的必须是这枚徽章现在的文本。 */
  await detail(page).getByRole("button", { name: "Open style editor", exact: true }).click();
  const editor = topDialog(page);
  await expect(field(editor, "Label text input"), "打开编辑器要带出现有标签，而不是样例文案")
    .toHaveValue(badge.label_html);
  await page.keyboard.press("Escape");
  await expectNoDialog(page);

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

test("成员名单：勾选即拥有，改动攒成差异一次保存；再打开时已有的人是勾上的", async ({ page, api, flow }) => {
  const badge = await createServerBadge(api, `E2E ${uniqueTag("assign")}`);
  /* 切换徽章要把面板收掉，得有第二枚可切；建在打开页面之前，否则清单里没有它。 */
  const other = await createServerBadge(api, `E2E ${uniqueTag("other")}`);
  const member = await createThrowawayMember(api, uniqueTag("bm"));
  await openBadges(page);
  await badgeItem(page, badge.name).click();
  await expect(detail(page).getByText("No members assigned to this badge.")).toBeVisible();

  const manage = detail(page).getByRole("button", { name: "Manage Members", exact: true });
  const toolbar = memberToolbar(page);
  await expect(toolbar, "查看态里没有编辑工具栏").toHaveCount(0);
  await expect(memberList(page).getByRole("checkbox"), "查看态里也不该有勾选框").toHaveCount(0);
  await manage.click();
  await expect(toolbar).toBeVisible();
  const save = toolbar.getByRole("button", { name: "Save changes", exact: true });
  await expect(save, "一个字都没改时没有可保存的东西").toBeDisabled();

  /*
   * 草稿只对进入编辑态时那一枚徽章有意义：带着它切到另一枚，保存出去就是拿这边的
   * 勾选去改那边的成员。切换必须退出编辑态。
   */
  await badgeItem(page, other.name).click();
  await expect(toolbar, "换了一枚徽章就该回到查看态").toHaveCount(0);
  await badgeItem(page, badge.name).click();
  await manage.click();
  await expect(toolbar).toBeVisible();

  await toolbar.getByRole("textbox", { name: "Search members…", exact: true }).fill(member.username);
  await expect(memberList(page).getByRole("checkbox"), "搜索要把名单收敛到那一个人").toHaveCount(1);
  const box = memberList(page).getByRole("checkbox", { name: member.username, exact: true });
  await expect(box, "还没给他徽章，所以是没勾的").not.toBeChecked();
  await box.check();
  await expect(save, "勾上一个人之后才有可保存的东西").toBeEnabled();

  await flow.click(save, ASSIGN_BADGE);
  await expectNotified(page, "Added 1, removed 0");
  await expect(toolbar, "保存成功之后回到查看态").toHaveCount(0);

  expect(
    (await serverAssignments(api, badge.id)).map((row) => row.user_id),
    "服务端得真的挂上这条分配",
  ).toEqual([member.id]);
  await expect(detail(page).getByText("1 assigned", { exact: true })).toBeVisible();
  await expect(memberRow(page, member.username), "已分配的人以卡片出现").toBeVisible();
  await expect(
    memberRow(page, member.username).getByText(/^Granted /),
    "授予时间后端一直在返回，名单上要看得到",
  ).toBeVisible();

  /* 已经有徽章的人仍在名单里，只是勾上了——取消勾选就是移除，不再是两份名单。 */
  await manage.click();
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("textbox", { name: "Search members…", exact: true }).fill(member.username);
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect(save, "取消勾选同样是一处改动，保存按钮要重新可用").toBeEnabled();

  /* 摘徽章是不可撤销的，和删除徽章一样要先确认。 */
  await save.click();
  const dialog = await confirmDialog(page, "Remove Badge Assignment");
  await expect(dialog, "确认框要点名是哪一枚徽章").toContainText(badge.name);
  await flow.click(dialog.getByRole("button", { name: "Remove", exact: true }), UNASSIGN_BADGE);
  await expectNotified(page, "Added 0, removed 1");

  expect(await serverAssignments(api, badge.id), "移除之后服务端不能再留着这条分配").toEqual([]);
  await expect(detail(page).getByText("0 assigned", { exact: true })).toBeVisible();
  await expect(detail(page).getByText("No members assigned to this badge.")).toBeVisible();
});

test("卡片上的移除：确认框取消什么都不做，确认之后两边一起归零", async ({ page, api, flow }) => {
  const badge = await createServerBadge(api, `E2E ${uniqueTag("unassign")}`);
  const member = await createThrowawayMember(api, uniqueTag("bm"));
  /* 靶子直接用接口挂上：面板那条路另有用例专门验，这里只看卡片上的移除。 */
  await api.post(`/api/badges/${badge.id}/assign`, { data: { user_ids: [member.id] } });

  await openBadges(page);
  await badgeItem(page, badge.name).click();
  const card = memberRow(page, member.username);
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: "Remove", exact: true }).click();
  await flow.clickWithoutApi(
    (await confirmDialog(page, "Remove Badge Assignment")).getByRole("button", { name: "Cancel", exact: true }),
  );
  await expectNoDialog(page);
  await expect(card, "取消之后这个人必须还在").toBeVisible();
  expect((await serverAssignments(api, badge.id)).length, "取消不能动服务端").toBe(1);

  await card.getByRole("button", { name: "Remove", exact: true }).click();
  const confirmed = await confirmDialog(page, "Remove Badge Assignment");
  await flow.click(confirmed.getByRole("button", { name: "Remove", exact: true }), UNASSIGN_BADGE);
  await expectNotified(page, "Badge removed from 1 member");

  expect(await serverAssignments(api, badge.id), "确认之后服务端不能再留着这条分配").toEqual([]);
  await expect(detail(page).getByText("No members assigned to this badge.")).toBeVisible();
});

test("删除徽章：确认框取消什么都不做；确认之后清单、详情和服务端一起清干净", async ({ page, api, flow }) => {
  await createServerBadge(api, `E2E ${uniqueTag("delete-anchor")}`);
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
  const remaining = await serverBadges(api);
  expect(remaining.some((row) => row.id === badge.id), "服务端也不能再查到它").toBe(false);
  expect(remaining.length, "本用例的对照徽章还在，删完不该只剩空清单").toBeGreaterThan(0);
  await expect(
    detailHead(page).getByText(remaining[0]!.name, { exact: true }),
    "删掉当前选中项之后，右栏落回第一枚，不能还停在一个已经不存在的徽章上",
  ).toBeVisible();
});

/*
 * 拖拽排序走整表重排接口，和职业目录同一套约定：请求体带的是**完整**的徽章 id
 * 顺序。用键盘（空格拿起 → 方向键 → 空格放下）而不是指针拖，理由写在
 * admin-classes.spec.ts 那条上，两处不重复一遍。
 *
 * 顺序会改到既有徽章的 sort_order，而收尾指纹只数行数，「行数没变、顺序变了」
 * 一条都查不出来，所以 finally 里必须把顺序放回去。
 */
test("拖拽排序：整张徽章表一次提交，顺序按下标重新发号落库；残缺的顺序一律回 409", async ({ page, api, flow }) => {
  /* 自己造两枚，不依赖站点预装徽章。 */
  await createServerBadge(api, `E2E ${uniqueTag("sortA")}`);
  await createServerBadge(api, `E2E ${uniqueTag("sortB")}`);
  const before = (await serverBadges(api)).map((row) => row.id);
  const expected = [before[1] as string, before[0] as string, ...before.slice(2)];

  try {
    await openBadges(page);
    const rows = sidebar(page).locator(".admin-md__row");
    await expect(rows).toHaveCount(before.length);

    const firstRow = rows.first();
    const transformOf = (row: Locator) => (
      () => row.evaluate((el) => (el as HTMLElement).style.transform)
    );
    const handle = firstRow.locator(".admin-md__grip");

    await handle.focus();
    await page.keyboard.press("Space");
    await expect(handle, "空格该把这一行拿起来").toHaveAttribute("aria-pressed", "true");
    await expect.poll(transformOf(firstRow), "拖拽上下文该接管这一行的位移了").not.toBe("");

    await page.keyboard.press("ArrowDown");
    await expect
      .poll(transformOf(rows.nth(1)), "第二行该被顶开，这才说明悬停目标定下来了")
      .not.toMatch(/translate3d\(0px, 0px/);

    const sent = await flow.act(
      () => page.keyboard.press("Space"),
      REORDER_BADGES,
    ) as ServerBadge[];
    await expect(handle, "再按一次空格该放下").not.toHaveAttribute("aria-pressed", "true");

    expect(
      sent.map((row) => row.id),
      "响应体要按新顺序回整张表，前端就是拿它当真相刷新的",
    ).toEqual(expected);
    expect(
      sent.map((row) => row.sort_order),
      "重排后按下标 * 10 重新发号，中间留出手工插值的空位",
    ).toEqual(expected.map((_, index) => index * 10));

    const saved = await serverBadges(api);
    expect(saved.map((row) => row.id), "刷新回来顺序还得是新的，不能只在内存里对").toEqual(expected);
    await expect(rows.first(), "界面上第一行确实换人了").toContainText(saved[0]?.name as string);

    const partial = await api.patch("/api/badges/reorder", { data: { order: expected.slice(1) } });
    expect(partial.status(), "残缺的顺序要回 409，不能悄悄写进去").toBe(409);
    expect(
      (await serverBadges(api)).map((row) => row.id),
      "被拒的那次不能改动任何一行",
    ).toEqual(expected);
  } finally {
    const restored = await api.patch("/api/badges/reorder", { data: { order: before } });
    expect(restored.ok(), "徽章排序恢复失败会污染后续用例与收尾指纹").toBe(true);
  }
});
