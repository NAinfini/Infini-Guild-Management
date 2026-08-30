import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { expectNoDialog, field, pageSubnavItem, selectOption } from "../../support/ui";

/*
 * 「结束战争」弹窗：把一场进行中的公会战封档成战史。
 *
 * 这是整个公会战里唯一一个不可逆的写操作，服务端做的事也远不止插一行：
 * concludeWar 会把 war_teams / war_pool_members 从 event_id 上摘下来改挂到
 * war_history_id，再把弹窗里填的成员数据写回 war_team_members.stats。
 * 所以只断言「弹窗关了、toast 弹了」等于什么都没验——每条用例都回读
 * GET /api/guild-war/history（列表）和 /history/:id（明细）逐字段对。
 *
 * 清理要特别注意：删活动并不会删战史。EventCrudService.destroyEvent 对 war_history
 * 只做 `SET event_id = NULL`，行本身连同挂上去的队伍都会留下来。因此 afterEach
 * 必须先按本用例登记的 id 删除战史（它会连带删掉 war_teams / war_team_members /
 * war_pool_members），再去销毁活动。顺序反了就会
 * 在库里留下一堆无主战史。
 */

const CONCLUDE = { method: "POST", path: /^\/api\/guild-war\/conclude$/ } as const;

const START_OFFSET_MS = 400 * 24 * 60 * 60_000;
const END_OFFSET_MS = START_OFFSET_MS + 2 * 60 * 60_000;

type HistoryRow = {
  id: string;
  event_id: string | null;
  war_name: string;
  enemy_name: string | null;
  result: string | null;
  own_stats: Record<string, number> | null;
  enemy_stats: Record<string, number> | null;
  duration_minutes: number | null;
};
type HistoryDetail = HistoryRow & {
  member_stats: Array<{ user_id: string; stats: Record<string, number> | null }>;
};

let stamp: number;
let title: string;
let eventId: string;
let ownedEventIds = new Set<string>();
let ownedHistoryIds = new Set<string>();
let viewer: { id: string; display_name: string };
let member: { id: string; display_name: string };

test.beforeEach(async ({ api }) => {
  ownedEventIds = new Set();
  ownedHistoryIds = new Set();
  stamp = Date.now();
  title = `${SYSTEM_TEST_CONTENT_MARKER} War ${stamp}`;

  const session = await readJson(await api.get("/api/auth/me"), "回读当前会话") as {
    user: { id: string; display_name: string };
  };
  viewer = session.user;

  const users = await readJson(
    await api.get("/api/users?page=1&limit=500&include_total=false"),
    "回读成员名单",
  ) as { data: Array<{ user: { id: string; display_name: string } }> };
  const found = users.data.find((entry) => entry.user.display_name === "member_01");
  expect(found, "种子数据里必须有 member_01，否则这条用例验的不是真人").toBeTruthy();
  member = found!.user;

  const created = await readJson(
    await api.post("/api/events", {
      data: {
        type: "guild_war",
        title,
        start_at: new Date(Date.now() + START_OFFSET_MS).toISOString(),
        end_at: new Date(Date.now() + END_OFFSET_MS).toISOString(),
      },
    }),
    "创建公会战活动",
  ) as { id: string };
  eventId = created.id;
  ownedEventIds.add(eventId);

  /*
   * 再造一场谁也不会去结束的公会战。
   * 可选列表一旦空掉，GuildWarActiveTab 会整块换成空状态，连活动下拉都不渲染；
   * 那样「结束后这场战从下拉里消失了」就分不清是被过滤掉了，还是整块没了。
   * 留一场垫底的，下拉就一定还在，断言才落在「过滤」这件事上。
   */
  const decoy = await readJson(
    await api.post("/api/events", {
      data: {
        type: "guild_war",
        title: `${SYSTEM_TEST_CONTENT_MARKER} Decoy ${stamp}`,
        start_at: new Date(Date.now() + START_OFFSET_MS).toISOString(),
        end_at: new Date(Date.now() + END_OFFSET_MS).toISOString(),
      },
    }),
    "创建垫底的公会战活动",
  ) as { id: string };
  ownedEventIds.add(decoy.id);
});

test.afterEach(async ({ api }) => {
  if (ownedHistoryIds.size > 0) {
    const response = await api.post("/api/guild-war/history/batch-delete", {
      data: { ids: [...ownedHistoryIds] },
    });
    expect(response.ok(), `清理战史返回 ${response.status()}: ${await response.text()}`).toBe(true);
  }

  for (const id of ownedEventIds) {
    const response = await api.delete(`/api/events/${id}/destroy`);
    expect([200, 204, 404], `清理活动返回 ${response.status()}`).toContain(response.status());
  }
});

/**
 * 直接用接口把编队摆好。
 * 拖拽建队本身在 guild-war-active-board.spec.ts 里已经验过，这里它只是前置条件；
 * 用接口摆能让这条用例专注在「结束战争」这一个控件上。
 */
async function seedTeam(api: APIRequestContext, userIds: string[]): Promise<void> {
  const joined = await api.post(`/api/events/${eventId}/participants`, { data: { user_ids: userIds } });
  expect(joined.ok(), `预置参战成员返回 ${joined.status()}: ${await joined.text()}`).toBe(true);
  const response = await api.post("/api/guild-war/save-teams", {
    data: {
      event_id: eventId,
      teams: [
        {
          team_name: "Alpha",
          sort_order: 0,
          members: userIds.map((userId, index) => ({ user_id: userId, sort_order: index })),
        },
      ],
      pool_members: [],
    },
  });
  expect(response.ok(), `预置编队返回 ${response.status()}: ${await response.text()}`).toBe(true);
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function eventSelect(page: Page): Locator {
  return field(page, "Select guild war event");
}

async function openBoard(page: Page): Promise<void> {
  await page.goto("/guild-war");
  const select = eventSelect(page);
  await expect(select).toBeVisible();
  await select.click();
  await page.getByRole("option", { name: new RegExp(escapeForRegExp(title)) }).click();
  await expect(select).toContainText(title);
  await expect(page.locator(".guild-war-dnd-pool .guild-war-column-card")).toBeVisible();
}

function concludeButton(page: Page): Locator {
  return page.getByRole("button", { name: "Conclude War", exact: true });
}

/** 打开「结束战争」弹窗。标题带战名，用它取弹窗比 .last() 稳。 */
async function openConcludeModal(page: Page): Promise<Locator> {
  await concludeButton(page).click();
  const modal = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: `Conclude: ${title}`, exact: true }),
  });
  await expect(modal).toBeVisible();
  return modal;
}

async function readHistories(api: APIRequestContext): Promise<HistoryRow[]> {
  const list = await readJson(
    await api.get(`/api/guild-war/history?search=${stamp}&limit=20`),
    "回读战史列表",
  ) as { data: HistoryRow[] };
  return list.data;
}

test("没人编进队伍时不允许结束，并且说清楚为什么", async ({ page }) => {
  await openBoard(page);

  await expect(
    concludeButton(page),
    "一支队伍都没有就结束，会写出一条没有任何成员的战史",
  ).toBeDisabled();

  /* 禁用的按钮本身收不到鼠标事件，Tooltip 的目标是外面那层 span——
     原因必须真的能被看到，否则用户只知道按钮是灰的。 */
  await page.locator(".guild-war-active-top-card__danger > span").hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "At least one team must have members before concluding the war",
  );
});

test("结束战争：填完的每一项都落进战史，活动同时退出可选列表", async ({ page, flow, api }) => {
  await seedTeam(api, [member.id]);
  await openBoard(page);
  expect(await readHistories(api), "开始之前不该有这场战的战史").toEqual([]);

  const modal = await openConcludeModal(page);
  const submit = modal.getByRole("button", { name: "Conclude & Archive", exact: true });
  await expect(
    submit,
    "结果是战史里唯一必填项，没选就能提交等于放行一条无结论的记录",
  ).toBeDisabled();

  await field(modal, "Enemy Guild").fill(`Crimson ${stamp}`);
  await selectOption(modal, "Result", "Win");
  await expect(submit, "选完结果就该允许提交").toBeEnabled();

  await field(modal, "Duration (minutes)").fill("42");
  await field(modal, "Our Kills").fill("7");
  await field(modal, "Enemy Kills").fill("3");
  await field(modal, `${member.display_name} — Kills`).fill("5");
  await field(modal, `${member.display_name} — Deaths`).fill("1");

  const concludedResult = await flow.click(submit, CONCLUDE) as { war_history_id: string };
  ownedHistoryIds.add(concludedResult.war_history_id);
  await expectNoDialog(page);

  const histories = await readHistories(api);
  expect(histories, "结束之后必须正好落一条战史").toHaveLength(1);
  const history = histories[0]!;
  expect(history.id, "结束接口返回的战史 id 必须可用于精确清理").toBe(concludedResult.war_history_id);
  expect(history.war_name, "战名取自活动标题").toBe(title);
  expect(history.enemy_name).toBe(`Crimson ${stamp}`);
  expect(history.result).toBe("win");
  expect(history.duration_minutes, "时长明确标注分钟，存的必须是纯数字").toBe(42);
  expect(history.own_stats?.kills, "己方战果必须逐项写进去").toBe(7);
  expect(history.enemy_stats?.kills).toBe(3);
  /* 没填的目标不该被当成 0 混进去：前端只上送非 null 的项，这是「未记录」和
     「记录为 0」的区别，战史后续的统计会按这个区分。 */
  expect(Object.keys(history.own_stats ?? {}), "没填的目标不应被补成 0").toEqual(["kills"]);

  const detail = await readJson(
    await api.get(`/api/guild-war/history/${history.id}`),
    "回读战史明细",
  ) as HistoryDetail;
  const entry = detail.member_stats.find((row) => row.user_id === member.id);
  expect(entry, "队里的人必须出现在战史成员统计里").toBeTruthy();
  expect(entry!.stats?.kills, "成员统计要按填的数字落库").toBe(5);
  expect(entry!.stats?.deaths).toBe(1);

  const concluded = await readJson(
    await api.get("/api/guild-war/concluded-event-ids"),
    "回读已结束的活动 id",
  ) as { data: string[] };
  expect(concluded.data, "结束后这场活动必须进已结束名单").toContain(eventId);

  /* 结束成功会把选中项清空，随后 GuildWarPage 的兜底 effect 会自动选上第一场还能打的战
     （见 GuildWarPage.tsx 的 activeSelectedEventId effect）。所以这里不是「变空」，
     而是「不再停在这场已经封档的战上」。 */
  await expect(eventSelect(page), "结束之后不该还停在这场战上").not.toContainText(title);
  await eventSelect(page).click();
  await expect(
    page.getByRole("option", { name: new RegExp(escapeForRegExp(title)) }),
    "已结束的战不该还能被选中，否则能被结束第二次",
  ).toHaveCount(0);
  await expect(
    page.getByRole("option", { name: new RegExp(escapeForRegExp(`Decoy ${stamp}`)) }),
    "过滤掉的应该只有已结束的那一场，别的战必须还在",
  ).toHaveCount(1);
  await page.keyboard.press("Escape");

  await pageSubnavItem(page, "Guild war workspace", "History").click();
  await expect(
    page.getByRole("button", { name: `Open war record ${title}`, exact: true }),
    "刚封档的战必须立刻出现在战史列表里",
  ).toBeVisible();
});

test("取消结束：不发请求也不落库；清掉结果后提交按钮重新禁用", async ({ page, flow, api }) => {
  await seedTeam(api, [member.id]);
  await openBoard(page);

  let modal = await openConcludeModal(page);
  const submit = () => modal.getByRole("button", { name: "Conclude & Archive", exact: true });

  await selectOption(modal, "Result", "Loss");
  await expect(submit()).toBeEnabled();
  await selectOption(modal, "Result", "Result");
  await expect(
    submit(),
    "结果被清掉之后必须重新禁用，否则会提交一条 result 为空的记录",
  ).toBeDisabled();

  await flow.clickWithoutApi(modal.getByRole("button", { name: "Cancel", exact: true }));
  await expectNoDialog(page);
  expect(await readHistories(api), "取消之后不能留下任何战史").toEqual([]);

  // 取消不该破坏现场：重新打开时输入应当是空的，战争也还在可以结束的状态。
  modal = await openConcludeModal(page);
  await expect(field(modal, "Enemy Guild")).toHaveValue("");
  await expect(submit()).toBeDisabled();
});

test("成员统计网格：回车往右、上下键换人，纯前端移动焦点", async ({ page, api }) => {
  await seedTeam(api, [member.id, viewer.id]);
  await openBoard(page);

  const modal = await openConcludeModal(page);
  const rows = modal.locator(".conclude-war-modal__table tbody tr");
  await expect(rows).toHaveCount(2);
  const firstMember = (await rows.nth(0).innerText()).split("\n")[0]!.trim();
  const secondMember = (await rows.nth(1).innerText()).split("\n")[0]!.trim();
  expect(firstMember, "两行必须是两个不同的人").not.toBe(secondMember);

  const focusedLabel = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");

  await field(modal, `${firstMember} — Kills`).focus();
  await page.keyboard.press("Enter");
  expect(await focusedLabel(), "回车应当移到同一个人的下一项").toBe(`${firstMember} — Deaths`);

  await page.keyboard.press("ArrowDown");
  expect(await focusedLabel(), "下键应当保持同一项、换到下一个人").toBe(`${secondMember} — Deaths`);

  await page.keyboard.press("ArrowUp");
  expect(await focusedLabel(), "上键应当换回上一个人").toBe(`${firstMember} — Deaths`);
});
