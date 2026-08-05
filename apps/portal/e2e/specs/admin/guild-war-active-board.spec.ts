import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { confirmDialog, expectNoDialog, field } from "../../support/ui";

/*
 * 公会战「Active」标签的作战板：选活动、加人进池、建队/改名/上锁/删队、
 * 拖拽调人、搜索定位、成员详情。
 *
 * 板子上的改动分两类，断言方式不同：
 *  - 人员归属（进池、换队、移出）走 POST /api/guild-war/move，点完立刻发；
 *  - 队伍本身（新增、改名、上锁、顺序、删除）走 POST /api/guild-war/save-teams，
 *    由 useGuildWarActiveController 的 350ms 自动保存兜住，没有「保存」按钮。
 * 两类都不看 toast——成功提示挂在 onSuccess 上，服务端写没写进去它并不知道，
 * 所以每条用例都回读 GET /api/guild-war/active?event_id=… 逐字段对。
 *
 * 池子里的人有两种来源：war_pool_members 里的真行，以及「活动报名了但还没被分配」
 * 的虚拟项（GuildWarActiveService.getActive 的 virtualPool）。用例里两种都用到了，
 * 注释里会写清当前那一条依赖的是哪种。
 */

const MOVE_MEMBER = { method: "POST", path: /^\/api\/guild-war\/move$/ } as const;
const SAVE_TEAMS = { method: "POST", path: /^\/api\/guild-war\/save-teams$/ } as const;

const START_OFFSET_MS = 400 * 24 * 60 * 60_000;
const END_OFFSET_MS = START_OFFSET_MS + 2 * 60 * 60_000;

type ActiveTeamMember = { user_id: string; role_tag: string | null };
type ActiveTeam = {
  id: string;
  team_name: string;
  sort_order: number;
  is_locked: boolean;
  notes: string | null;
  members: ActiveTeamMember[];
};
type ActiveBoard = {
  teams: ActiveTeam[];
  pool: Array<{ id: string; userId: string }>;
  participants: Array<{ user_id: string }>;
};

let stamp: number;
let title: string;
let eventId: string;
let viewer: { id: string; username: string };
let member: { id: string; username: string };

test.beforeEach(async ({ api }) => {
  stamp = Date.now();
  title = `${SYSTEM_TEST_CONTENT_MARKER} War ${stamp}`;

  const session = await readJson(await api.get("/api/auth/me"), "回读当前会话") as {
    user: { id: string; username: string };
  };
  viewer = session.user;

  const users = await readJson(
    await api.get("/api/users?page=1&limit=500&include_total=false"),
    "回读成员名单",
  ) as { data: Array<{ user: { id: string; username: string } }> };
  const found = users.data.find((entry) => entry.user.username === "member_01");
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
});

test.afterEach(async ({ api }) => {
  /* destroy 会连带清掉 war_team_members / war_teams / war_pool_members / event_participants，
     所以板子上造出来的东西不需要单独收尾——但这也意味着漏删一条活动就会留下一整套残留。 */
  const list = await readJson(
    await api.get(`/api/events?search=${stamp}&limit=50`),
    "回读待清理的活动",
  ) as { data: { id: string }[] };
  for (const entry of list.data) {
    const response = await api.delete(`/api/events/${entry.id}/destroy`);
    expect([200, 204, 404], `清理活动返回 ${response.status()}`).toContain(response.status());
  }
});

/**
 * 等一次 save-teams 之后的板子重取落地。
 *
 * 存完队伍，控制器会作废并重取作战板（GuildWarService.ts:104-112）。
 * 而 save-teams 是整表替换，重取回来的队伍 id 全是新的，于是整列队伍被重新挂载。
 * 两个控件操作之间不等这次重挂，下一次点击就可能落在即将被替换掉的旧节点上——
 * 实测的表现是「上锁」那一下点到了它旁边的复制按钮，锁自然没生效，
 * 用例一路等 save-teams 等到超时。
 *
 * 必须在触发保存之前就把等待挂上：重取是紧跟着 POST 响应发的，
 * 等 flow.click 返回再挂就可能已经错过了。
 */
function boardReloaded(page: Page): Promise<unknown> {
  return page.waitForResponse((response) =>
    response.request().method() === "GET"
    && new URL(response.url()).pathname === "/api/guild-war/active");
}

async function readBoard(api: APIRequestContext): Promise<ActiveBoard> {
  return await readJson(
    await api.get(`/api/guild-war/active?event_id=${eventId}`),
    "回读作战板",
  ) as ActiveBoard;
}

async function joinEvent(api: APIRequestContext, userId: string): Promise<void> {
  const response = await api.post(`/api/events/${eventId}/participants`, { data: { user_ids: [userId] } });
  expect(response.ok(), `报名 ${userId} 返回 ${response.status()}: ${await response.text()}`).toBe(true);
}

/** 打开 Active 标签并把本用例造的那场战选中。选中会触发一次 active 查询。 */
async function openBoard(page: Page): Promise<void> {
  await page.goto("/guild-war");
  const select = field(page, "Select guild war event");
  await expect(select).toBeVisible();
  await select.click();
  await page.getByRole("option", { name: new RegExp(escapeForRegExp(title)) }).click();
  await expect(select).toHaveValue(new RegExp(escapeForRegExp(title)));
  await expect(poolColumn(page)).toBeVisible();
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function poolColumn(page: Page): Locator {
  return page.locator(".guild-war-dnd-pool .guild-war-column-card");
}

function teamColumns(page: Page): Locator {
  return page.locator(".guild-war-dnd-teams .guild-war-column-card");
}

/** 作战板上的一张成员卡。板子上能点开详情时它的无障碍名是「Open member details for …」。 */
function memberCard(scope: Locator | Page, username: string): Locator {
  return scope.getByRole("button", { name: `Open member details for ${username}`, exact: true });
}

/** 右侧 Readiness 面板上的一项计数。它是这块板子唯一的汇总视图，必须跟着数据一起动。 */
function readiness(page: Page, label: string): Locator {
  return page.locator(".guild-war-readiness__entry").filter({ hasText: label }).locator("dd");
}

/**
 * 打开某一列右上角的操作菜单。
 * 必须先等网络安静：save-teams 成功后会 invalidate 掉 active 查询，重新拉回来的
 * 队伍是新 id，整列会被重建——菜单如果开在重建之前，会跟着旧节点一起消失，
 * 表现成「点了菜单没弹出来」。
 */
async function openColumnMenu(page: Page, column: Locator): Promise<void> {
  await page.waitForLoadState("networkidle");
  await column.getByRole("button", { name: "Open column actions", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

/**
 * 用鼠标做一次 dnd-kit 拖拽。
 * MouseSensor 的 activationConstraint 是 distance: 5——按下之后必须先真的挪开几像素，
 * 一步跳到终点会被它当成点击忽略，表现成「拖了没反应」。
 * 碰撞检测是 pointerWithin，所以落点必须落在目标元素内部，贴边不算。
 */
async function dragCardTo(page: Page, card: Locator, target: Locator): Promise<void> {
  const from = await card.boundingBox();
  expect(from, "拖拽源不在视口里").toBeTruthy();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + from!.width / 2 + 16, from!.y + from!.height / 2 + 16, { steps: 5 });

  /* 目标框要在拖拽开始之后再量：回收区平时是 display:none，拖起来才占位。
     而且必须先等它真的出现——按下之后立刻量，量到的是还没重渲染的那一帧，返回 null。 */
  await expect(target, "拖拽开始后目标应当可见").toBeVisible();

  /*
   * 分两段落点，不是重试，是因为第一段本身会改变排版：
   * 回收区一出现就占位，把下面的列往上顶；拖拽浮层也会让列高变化。
   * 第一段先把指针带到「量到的位置」，等排版因此稳定下来，第二段再重量一次落点。
   * 只量一次就直接松手，正是这条用例偶发失败的成因——落点算的是上一帧的坐标。
   */
  await moveToCenterOf(page, target, 12);
  await moveToCenterOf(page, target, 4);

  /*
   * 松手前必须让应用自己承认「我是当前落点」：dnd-kit 的 isOver 会给目标挂上
   * `xxx--over`（GuildWarDragBoardSections.tsx:278 的列、:465 的回收区）。
   * 少了这一步，指针打偏时会静默地投放到别处或原地落回，用例在后面某条断言上
   * 报一个和成因毫无关系的错。这里失败就直接指向「没拖到目标上」。
   */
  await expect(target, "松手前目标必须已经是 dnd-kit 认定的落点").toHaveClass(/(^|\s)[\w-]+--over(\s|$)/);
  await page.mouse.up();
}

async function moveToCenterOf(page: Page, target: Locator, steps: number): Promise<void> {
  const box = await target.boundingBox();
  expect(box, "拖拽目标不在视口里").toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps });
}

test("加人进池：选完人确认后池子和服务端一起加一", async ({ page, flow, api }) => {
  await openBoard(page);

  expect((await readBoard(api)).pool, "刚建的战里应该一个人都没有").toEqual([]);
  await expect(readiness(page, "In pool")).toHaveText("0");

  await poolColumn(page).getByRole("button", { name: "Add to pool", exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();

  const confirm = modal.getByRole("button", { name: /^Add \d+ members? to pool$/ });
  await expect(confirm, "一个人都没选就能提交，等于放行一次空操作").toBeDisabled();

  await field(modal, "Available members").fill(member.username);
  await page.getByRole("option", { name: member.username, exact: true }).click();
  await expect(modal.getByText("1 selected", { exact: true })).toBeVisible();
  // MultiSelect 选完不会自己收起下拉（还要继续选人），而下拉正好盖住确认按钮。
  await page.keyboard.press("Escape");

  await flow.click(modal.getByRole("button", { name: "Add 1 member to pool", exact: true }), MOVE_MEMBER);
  await expectNoDialog(page);

  const board = await readBoard(api);
  expect(board.pool.map((entry) => entry.userId), "服务端的池子里必须真的多出这个人").toEqual([member.id]);
  await expect(readiness(page, "In pool")).toHaveText("1");
  await expect(memberCard(poolColumn(page), member.username)).toBeVisible();
});

test("建队、改名、上锁、删队：每一步都被自动保存写回服务端", async ({ page, flow, api }) => {
  await openBoard(page);
  expect((await readBoard(api)).teams, "刚建的战里不该有队伍").toEqual([]);

  let reloaded = boardReloaded(page);
  await flow.click(page.getByRole("button", { name: "Add Team", exact: true }), SAVE_TEAMS);
  await reloaded;

  let teams = (await readBoard(api)).teams;
  expect(teams, "新增的队伍必须落库，否则刷新就没了").toHaveLength(1);
  expect(teams[0]!.team_name).toBe("Team 1");
  const teamId = teams[0]!.id;
  await expect(teamColumns(page)).toHaveCount(1);
  await expect(readiness(page, "Teams")).toHaveText("1");

  // 改名：点标题进入编辑态，回车提交。名字只存在草稿里，靠 350ms 自动保存落库。
  const renamed = `Vanguard ${stamp}`;
  await teamColumns(page).getByRole("button", { name: "Edit team name Team 1", exact: true }).click();
  /* 只能按前缀取：这个输入框的无障碍名是「Team name for <当前名字>」，
     名字又是随输入实时变的，敲第一个字它就不再叫 Team 1 了。 */
  const nameInput = teamColumns(page).getByLabel(/^Team name for /);
  reloaded = boardReloaded(page);
  await flow.act(async () => {
    await nameInput.fill(renamed);
    await nameInput.press("Enter");
  }, SAVE_TEAMS);
  await reloaded;

  teams = (await readBoard(api)).teams;
  expect(teams[0]!.team_name, "改名必须真的写回服务端").toBe(renamed);
  expect(teams[0]!.id, "自动保存不得更换已有队伍 id").toBe(teamId);
  expect(teams, "改名不该顺手多出或少掉队伍").toHaveLength(1);
  await expect(teamColumns(page)).toContainText(renamed);

  // 上锁：锁住的队伍不允许拖入拖出，这个状态同样必须落库。
  reloaded = boardReloaded(page);
  await flow.click(
    teamColumns(page).getByRole("button", { name: "Open", exact: true }),
    SAVE_TEAMS,
  );
  await reloaded;
  expect((await readBoard(api)).teams[0]!.is_locked, "锁状态必须真的写回服务端").toBe(true);
  await expect(teamColumns(page).getByText("LOCKED", { exact: true })).toBeVisible();

  // 删队：取消什么都不做。
  await openColumnMenu(page, teamColumns(page));
  await page.getByRole("menuitem", { name: "Delete Team", exact: true }).click();
  await (await confirmDialog(page, "Delete Team"))
    .getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await readBoard(api)).teams, "取消确认后队伍必须还在").toHaveLength(1);

  await openColumnMenu(page, teamColumns(page));
  await page.getByRole("menuitem", { name: "Delete Team", exact: true }).click();
  await flow.act(async () => {
    await (await confirmDialog(page, "Delete Team"))
      .getByRole("button", { name: "Delete", exact: true }).click();
  }, SAVE_TEAMS);

  expect((await readBoard(api)).teams, "确认后服务端必须真的删掉").toEqual([]);
  await expect(teamColumns(page)).toHaveCount(0);
  await expect(readiness(page, "Teams")).toHaveText("0");
});

test("拖拽调人：从池子拖进队伍，再拖到回收区移出这场战", async ({ page, flow, api }) => {
  /* 这里的池子成员来自活动报名（virtualPool）：报了名还没被分配的人会直接出现在池子里。 */
  await joinEvent(api, member.id);
  await openBoard(page);
  await expect(memberCard(poolColumn(page), member.username)).toBeVisible();

  await flow.click(page.getByRole("button", { name: "Add Team", exact: true }), SAVE_TEAMS);
  await expect(teamColumns(page)).toHaveCount(1);

  await flow.act(
    () => dragCardTo(page, memberCard(poolColumn(page), member.username), teamColumns(page)),
    MOVE_MEMBER,
  );

  let board = await readBoard(api);
  expect(board.teams[0]!.members.map((entry) => entry.user_id), "拖进队伍就该在队伍里").toEqual([member.id]);
  expect(board.pool, "同一个人不能既在队里又在池里").toEqual([]);
  await expect(memberCard(teamColumns(page), member.username)).toBeVisible();
  await expect(readiness(page, "Assigned")).toHaveText("1");
  await expect(readiness(page, "In pool")).toHaveText("0");

  // 拖到回收区是「退出这场战」，比换队重，所以要过确认框；取消不该动数据。
  await dragCardTo(page, memberCard(teamColumns(page), member.username), page.locator(".guild-war-trash-zone"));
  await (await confirmDialog(page, "Remove from War"))
    .getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await readBoard(api)).teams[0]!.members, "取消后人必须还在队里").toHaveLength(1);
  /* 确认框退场比 role="dialog" 卸载晚：遮罩还在的时候按下鼠标，
     按下的是遮罩，拖拽根本不会启动，表现成「拖了没反应」。 */
  await expectNoDialog(page);

  await flow.act(async () => {
    await dragCardTo(page, memberCard(teamColumns(page), member.username), page.locator(".guild-war-trash-zone"));
    await (await confirmDialog(page, "Remove from War"))
      .getByRole("button", { name: "Remove", exact: true }).click();
  }, MOVE_MEMBER);

  board = await readBoard(api);
  expect(board.teams[0]!.members, "移出之后队里不能还留着他").toEqual([]);
  expect(board.pool, "也不该被顺手退回池子").toEqual([]);
  expect(
    board.participants.map((entry) => entry.user_id),
    "移出战争同时要退掉这场活动的报名，否则他会又变成虚拟池成员回来",
  ).toEqual([]);
  await expect(memberCard(page, member.username)).toHaveCount(0);
});

test("搜索定位：只在前端高亮匹配的成员卡，不碰服务端", async ({ page, flow, api }) => {
  await joinEvent(api, member.id);
  await joinEvent(api, viewer.id);
  await openBoard(page);
  await expect(poolColumn(page).locator(".guild-war-member-card")).toHaveCount(2);

  const search = field(page, "Search active guild war members");
  await flow.clickWithoutApi(search);
  await search.fill(member.username);

  await expect(
    poolColumn(page).locator(".guild-war-member-card--matched"),
    "搜索是纯前端定位：命中的应当只是被高亮，而不是把别人过滤掉",
  ).toHaveCount(1);
  await expect(poolColumn(page).locator(".guild-war-member-card")).toHaveCount(2);
  await expect(page.getByText("Match 1 / 1", { exact: true })).toBeVisible();

  /*
   * 搜不到人时，计数条整个消失。
   * 注意这不是「显示 No matches」——GuildWarActiveTopCard 的渲染条件是
   * `activeSearch && hasMatches`，而 matchLabel 只有在一个匹配都没有时才等于
   * "No matches"，两个条件互斥，那句文案在现有代码里永远显示不出来。
   * 这里按现状如实断言，没有替产品改行为。
   */
  await search.fill(`nobody-${stamp}`);
  await expect(poolColumn(page).locator(".guild-war-member-card--matched")).toHaveCount(0);
  await expect(poolColumn(page).locator(".guild-war-member-card")).toHaveCount(2);
  await expect(page.locator(".guild-war-active-top-card__matches")).toHaveCount(0);
});

test("成员详情：点开卡片能看到他在这场战里的归属和统计", async ({ page, api }) => {
  await joinEvent(api, member.id);
  await openBoard(page);

  await memberCard(poolColumn(page), member.username).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("heading", { name: member.username, exact: true })).toBeVisible();
  await expect(
    modal.locator(".guild-war-member-detail__assignment"),
    "还没分队的人，归属就该显示池子",
  ).toContainText("Pool");
  const stats = modal.locator(".guild-war-member-detail__stat");
  await expect(stats.filter({ hasText: /^Kills\s*0$/ })).toHaveCount(1);
  await expect(stats.filter({ hasText: /^Deaths\s*0$/ })).toHaveCount(1);
  await expect(stats.filter({ hasText: /^Assists\s*0$/ })).toHaveCount(1);
  await expect(stats.filter({ hasText: /^KDA\s*0\.00$/ })).toHaveCount(1);
});
