import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { confirmDialog, dialogTitled, expectNoDialog } from "../../support/ui";

/*
 * 活动卡片上的操作：管理菜单（编辑/复制/置顶/锁定/归档/删除）、复制点名、报名与退出。
 *
 * 这些按钮全都有服务端后果，所以每条用例都要求三件事同时成立：
 * 请求真的发出去、服务端的那一行数据真的变了、卡片上的呈现跟着变。
 * 只看 toast 是不够的——成功提示挂在 onSuccess 上，服务端写没写进去它并不知道。
 *
 * 活动的开始时间放在一年以后：报名时如果和已加入的活动时间重叠，
 * 会先弹时间冲突确认框（useEventsParticipantMutations.handleJoin），
 * 那样用例就会依赖数据库里已有的报名情况。推远之后这个分支不会被误触。
 * 页面一律带 search=<stamp> 打开，保证卡片一定在第一页，不受既有数据量影响。
 */

const PATCH_EVENT = { method: "PATCH", path: /^\/api\/events\/[^/]+$/ } as const;
const CREATE_EVENT = { method: "POST", path: /^\/api\/events$/ } as const;
const ARCHIVE_EVENT = { method: "DELETE", path: /^\/api\/events\/[^/]+$/ } as const;
const DESTROY_EVENT = { method: "DELETE", path: /^\/api\/events\/[^/]+\/destroy$/ } as const;
const JOIN_EVENT = { method: "POST", path: /^\/api\/events\/[^/]+\/join$/ } as const;
const LEAVE_EVENT = { method: "DELETE", path: /^\/api\/events\/[^/]+\/leave$/ } as const;

const START_OFFSET_MS = 400 * 24 * 60 * 60_000;
const END_OFFSET_MS = START_OFFSET_MS + 2 * 60 * 60_000;

type ServerEvent = {
  id: string;
  title: string;
  start_at: string;
  pinned: boolean;
  signup_locked: boolean;
  archived_at: string | null;
  participants: { user_id: string }[];
};

let stamp: number;
let title: string;
let eventId: string;
let viewer: { id: string; username: string };

test.beforeEach(async ({ page, api }) => {
  stamp = Date.now();
  title = `${SYSTEM_TEST_CONTENT_MARKER} Card ${stamp}`;

  const session = await readJson(await api.get("/api/auth/me"), "回读当前会话") as {
    user: { id: string; username: string };
  };
  viewer = session.user;

  const created = await readJson(
    await api.post("/api/events", {
      data: {
        type: "social",
        title,
        start_at: new Date(Date.now() + START_OFFSET_MS).toISOString(),
        end_at: new Date(Date.now() + END_OFFSET_MS).toISOString(),
      },
    }),
    "创建一次性活动",
  ) as { id: string };
  eventId = created.id;

  await openWorkbench(page);
});

test.afterEach(async ({ api }) => {
  /*
   * 复制（Duplicate）会额外造一条「… (Copy)」，用例本身拿不到它的 id，
   * 所以清理按标记搜，把这一轮造出来的全部彻底删掉，而不是只删 fixture。
   */
  const list = await readJson(
    await api.get(`/api/events?search=${stamp}&limit=50`),
    "回读待清理的活动",
  ) as { data: { id: string }[] };
  for (const entry of list.data) {
    const response = await api.delete(`/api/events/${entry.id}/destroy`);
    expect([200, 204, 404], `清理活动返回 ${response.status()}`).toContain(response.status());
  }
});

async function openWorkbench(page: Page, extraSearch = ""): Promise<void> {
  await page.goto(`/events?search=${stamp}${extraSearch}`);
  await expect(card(page)).toHaveCount(1);
}

function card(page: Page): Locator {
  return page.locator(".event-card").filter({ hasText: title });
}

/** 打开卡片右上角的管理菜单。菜单本身是纯前端的，打开不该发请求。 */
async function openMenu(page: Page): Promise<void> {
  await card(page).getByRole("button", { name: "Event actions", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

function menuItem(page: Page, name: string): Locator {
  return page.getByRole("menuitem", { name, exact: true });
}

async function readEvent(api: APIRequestContext, id: string): Promise<ServerEvent> {
  return await readJson(await api.get(`/api/events/${id}`), `回读活动 ${id}`) as ServerEvent;
}

/** 卡片上的状态图标是 role="img" + aria-label，悬浮卡里的标题就是它的无障碍名。 */
function statusIcon(page: Page, label: string): Locator {
  return card(page).getByRole("img", { name: label, exact: true });
}

test("管理菜单：编辑打开编辑弹窗并预填当前标题，这一步不该产生请求", async ({ page, flow }) => {
  await openMenu(page);
  await flow.clickWithoutApi(menuItem(page, "Edit"));

  const modal = dialogTitled(page, "Edit Event");
  await expect(modal).toBeVisible();
  await expect(
    modal.getByLabel(/^Event title\s*\*?$/),
    "编辑态必须带出这条活动的现值，否则保存会把别的字段覆盖成空",
  ).toHaveValue(title);
});

test("置顶开关：菜单项与卡片标记随服务端字段一起翻转", async ({ page, flow, api }) => {
  expect((await readEvent(api, eventId)).pinned, "新建的活动不该是置顶的").toBe(false);
  await expect(statusIcon(page, "Pinned")).toHaveCount(0);

  await openMenu(page);
  await flow.click(menuItem(page, "Pin"), PATCH_EVENT);

  expect((await readEvent(api, eventId)).pinned, "服务端必须真的置顶").toBe(true);
  await expect(statusIcon(page, "Pinned"), "置顶后卡片必须自报状态").toHaveCount(1);

  // 菜单项要跟着变成反向操作，否则用户会以为再点一次还是置顶。
  await openMenu(page);
  await expect(menuItem(page, "Pin")).toHaveCount(0);
  await flow.click(menuItem(page, "Unpin"), PATCH_EVENT);

  expect((await readEvent(api, eventId)).pinned).toBe(false);
  await expect(statusIcon(page, "Pinned")).toHaveCount(0);
});

test("报名锁定：锁上之后服务端字段、卡片标记和报名按钮三者同时生效", async ({ page, flow, api }) => {
  await expect(card(page).getByRole("button", { name: "Join", exact: true })).toBeEnabled();

  await openMenu(page);
  await flow.click(menuItem(page, "Lock Signup"), PATCH_EVENT);

  expect((await readEvent(api, eventId)).signup_locked, "服务端必须真的锁上").toBe(true);
  await expect(statusIcon(page, "Signups Locked")).toHaveCount(1);
  await expect(
    card(page).getByRole("button", { name: "Join", exact: true }),
    "锁定的意义就是报不了名，按钮必须禁用",
  ).toBeDisabled();

  await openMenu(page);
  await flow.click(menuItem(page, "Unlock Signup"), PATCH_EVENT);

  expect((await readEvent(api, eventId)).signup_locked).toBe(false);
  await expect(statusIcon(page, "Signups Locked")).toHaveCount(0);
  await expect(card(page).getByRole("button", { name: "Join", exact: true })).toBeEnabled();
});

test("复制活动：新建一条「(Copy)」并顺延一周，原活动分毫不动", async ({ page, flow, api }) => {
  const original = await readEvent(api, eventId);

  await openMenu(page);
  const duplicated = await flow.click(menuItem(page, "Duplicate"), CREATE_EVENT) as ServerEvent;

  expect(duplicated.title, "副本要能一眼认出来").toBe(`${title} (Copy)`);
  expect(
    Date.parse(duplicated.start_at) - Date.parse(original.start_at),
    "副本默认顺延一周（useEventsMutations.duplicateEvent）",
  ).toBe(7 * 24 * 60 * 60_000);

  const after = await readEvent(api, eventId);
  expect(after.start_at, "复制不该动原活动").toBe(original.start_at);
  expect(after.title).toBe(original.title);

  // 副本标题里带同一个 stamp，所以它也在这次搜索结果里，列表必须变成两张卡。
  await expect(page.locator(".event-card").filter({ hasText: `${title} (Copy)` })).toHaveCount(1);
});

test("归档与取消归档：取消确认什么都不做，确认后卡片退出 Active 档", async ({ page, flow, api }) => {
  await openMenu(page);
  await menuItem(page, "Archive").click();
  await (await confirmDialog(page, "Archive Event"))
    .getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await readEvent(api, eventId)).archived_at, "取消确认后不该归档").toBeNull();

  await openMenu(page);
  await menuItem(page, "Archive").click();
  await flow.act(
    async () => {
      await (await confirmDialog(page, "Archive Event"))
        .getByRole("button", { name: "Archive", exact: true }).click();
    },
    ARCHIVE_EVENT,
  );

  expect((await readEvent(api, eventId)).archived_at, "确认后服务端必须记下归档时间").not.toBeNull();
  await expect(card(page), "归档的活动不该继续留在默认的 Active 档").toHaveCount(0);

  // 取消归档只能在能看见它的档位里做。
  await openWorkbench(page, "&status=all");
  await expect(statusIcon(page, "Archived")).toHaveCount(1);

  await openMenu(page);
  await flow.click(menuItem(page, "Unarchive"), PATCH_EVENT);

  expect((await readEvent(api, eventId)).archived_at, "取消归档必须把时间写回 null").toBeNull();
  await expect(statusIcon(page, "Archived")).toHaveCount(0);
});

test("删除活动：取消无请求，确认后服务端查不到且卡片消失", async ({ page, flow, api }) => {
  await openMenu(page);
  await menuItem(page, "Delete").click();
  await (await confirmDialog(page, "Delete event?"))
    .getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await api.get(`/api/events/${eventId}`)).status(), "取消后活动必须还在").toBe(200);

  await openMenu(page);
  await menuItem(page, "Delete").click();
  await flow.act(
    async () => {
      await (await confirmDialog(page, "Delete event?"))
        .getByRole("button", { name: "Confirm", exact: true }).click();
    },
    DESTROY_EVENT,
  );

  expect((await api.get(`/api/events/${eventId}`)).status(), "确认后必须彻底删掉").toBe(404);
  await expectNoDialog(page);
  await expect(card(page)).toHaveCount(0);
});

test("复制点名：没人报名时按不动，报名后剪贴板里拿到真的 @用户名", async ({ page, flow, api }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  const copyButton = card(page).getByRole("button", { name: "Copy Mentions", exact: true });
  await expect(copyButton, "没有参与者时点名没有意义，必须禁用").toBeDisabled();

  await flow.click(card(page).getByRole("button", { name: "Join", exact: true }), JOIN_EVENT);
  await expect(copyButton).toBeEnabled();

  /*
   * 报名成功后 onSettled 会重新拉 batch-details，这些请求会拖到点击之后才回来。
   * 不等干净就断言「点名不发请求」，抓到的是上一步的尾巴，不是这个按钮的行为。
   */
  await page.waitForLoadState("networkidle");
  await flow.clickWithoutApi(copyButton);

  /*
   * 这里必须读真剪贴板。只断言弹了「Mentions copied」是验不出问题的：
   * 那句提示在 clipboard.copy 之后无条件执行，内容拼错了它照样弹。
   */
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText, "点名文本要带上活动名和参与者").toBe(`${title}: @${viewer.username}`);

  const detail = await readEvent(api, eventId);
  expect(detail.participants.map((entry) => entry.user_id)).toEqual([viewer.id]);
});

test("报名与退出：人数、服务端参与者名单和按钮状态一起变", async ({ page, flow, api }) => {
  const capacity = card(page).locator(".event-card__capacity");
  await expect(capacity).toHaveText("0/∞");

  await flow.click(card(page).getByRole("button", { name: "Join", exact: true }), JOIN_EVENT);

  expect(
    (await readEvent(api, eventId)).participants.map((entry) => entry.user_id),
    "服务端参与者名单里必须出现当前用户",
  ).toEqual([viewer.id]);
  await expect(capacity, "人数要跟着加一").toHaveText("1/∞");

  const leaveButton = card(page).getByRole("button", { name: "Cancel signup", exact: true });
  await expect(leaveButton).toHaveAttribute("aria-pressed", "true");

  // 退出要过确认框；取消不该动名单。
  await leaveButton.click();
  await (await confirmDialog(page, "Leave event?"))
    .getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await readEvent(api, eventId)).participants, "取消后仍应保留报名").toHaveLength(1);

  await leaveButton.click();
  await flow.act(
    async () => {
      await (await confirmDialog(page, "Leave event?"))
        .getByRole("button", { name: "Confirm", exact: true }).click();
    },
    LEAVE_EVENT,
  );

  expect((await readEvent(api, eventId)).participants, "退出后名单必须清空").toEqual([]);
  await expect(capacity).toHaveText("0/∞");
  await expect(card(page).getByRole("button", { name: "Join", exact: true })).toBeVisible();
});
