import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { createThrowawayMember, uniqueTag } from "../../support/members";
import { expect, readJson, test, type Flow } from "../../support/test";
import { field, selectOption, toggleInput } from "../../support/ui";

/*
 * 公会战「Analytics」标签：模式切换、战集与日期预设、成员/队伍/指标选择、
 * 排行榜的聚合与阈值、归一化、数据表的展示控件。
 *
 * ── 为什么夹具要这么造 ──
 * 分析口径受两件事影响，不钉死就没法断言任何一个数字：
 *   1. 归一化 = 原值 / 战斗时长 × 参考时长。夹具把时长设成参考时长的两倍，
 *      于是「开归一化」正好是原值的一半——开关到底有没有生效一眼可辨。
 *   2. 难度系数由服务端按 own/enemy 的目标数据算（GuildWarAnalyticsService
 *      的 computeWarModifier）。夹具让双方目标完全相等，系数恒为 1，
 *      归一化就只剩时长这一个变量。beforeEach 结尾会把这两条前提回读断言，
 *      站点配置一改就当场炸，而不是让下面的期望值悄悄失真。
 *
 * ── 为什么要先去 History 标签搜一下 ──
 * 分析用的战集就是 History 列表当前那一页（GuildWarPage 把同一个 historyQuery
 * 传给了两个标签）。不先筛掉别的战史，选项里混着开发库里的历史数据，
 * 行数和排名断言全都不确定。
 *
 * ── 网络断言的边界 ──
 * 分析查询的 staleTime 是 Infinity：同一组战 id 只会取一次，回头路一律走缓存。
 * 所以只有「第一次出现的战集」才用 flow 断言网络，其余控件（模式、指标、聚合、
 * 归一化、热力图……）本来就是纯前端计算，断言落在表格和图表上。
 */

const ANALYTICS = { method: "GET", path: /^\/api\/guild-war\/analytics$/ } as const;
const HISTORY_LIST = { method: "GET", path: /^\/api\/guild-war\/history$/ } as const;

const START_OFFSET_MS = 400 * 24 * 60 * 60_000;
const END_OFFSET_MS = START_OFFSET_MS + 2 * 60 * 60_000;

/** 双方目标完全相等 → 难度系数恒为 1。 */
const OWN_STATS = { kills: 10, towers: 4 } as const;
const ENEMY_STATS = { kills: 10, towers: 4 } as const;

type Member = { id: string; username: string };

let stamp: number;
let warATitle: string;
let warBTitle: string;
let warAId: string;
let warBId: string;
let referenceDuration: number;
let m1: Member;
let m2: Member;
let m3: Member;
/** 空状态里「Select first member」会选中的那个人：可选成员按 user id 排序后的第一个。 */
let firstSelectable: Member;

test.beforeEach(async ({ api }) => {
  stamp = Date.now();
  warATitle = `${SYSTEM_TEST_CONTENT_MARKER} WarA ${stamp}`;
  warBTitle = `${SYSTEM_TEST_CONTENT_MARKER} WarB ${stamp}`;

  const settings = await readJson(
    await api.get("/api/admin/analytics-settings"),
    "回读分析设置",
  ) as { reference_duration_minutes: number };
  referenceDuration = settings.reference_duration_minutes;
  expect(referenceDuration, "参考时长必须是正数，否则归一化没有基准").toBeGreaterThan(0);

  const users = await readJson(
    await api.get("/api/users?page=1&limit=500&include_total=false"),
    "回读成员名单",
  ) as { data: Array<{ user: Member }> };
  const shared = users.data.find((entry) => entry.user.username === "member_01");
  expect(shared, "fresh E2E fixture 必须提供共享成员 member_01").toBeTruthy();
  m1 = shared!.user;
  m2 = await createThrowawayMember(api, uniqueTag("gwa2"));
  m3 = await createThrowawayMember(api, uniqueTag("gwa3"));
  firstSelectable = [m1, m2, m3].sort((left, right) => (left.id < right.id ? -1 : 1))[0]!;

  warAId = await seedWar(api, {
    title: warATitle,
    result: "win",
    teams: [{ team_name: "Alpha", members: [m1, m2] }],
    memberStats: [
      { user_id: m1.id, stats: { damage: 1000, kills: 4, deaths: 2, assists: 2 } },
      { user_id: m2.id, stats: { damage: 600, kills: 2, deaths: 4, assists: 0 } },
    ],
  });
  /* B 比 A 晚结束，所以 B 是最新的一场；时间轴按 created_at 升序排，A 在前。 */
  warBId = await seedWar(api, {
    title: warBTitle,
    result: "loss",
    teams: [
      { team_name: "Alpha", members: [m1, m2] },
      { team_name: "Bravo", members: [m3] },
    ],
    memberStats: [
      { user_id: m1.id, stats: { damage: 2000, kills: 6, deaths: 1, assists: 3 } },
      { user_id: m2.id, stats: { damage: 400, kills: 1, deaths: 5, assists: 1 } },
      { user_id: m3.id, stats: { damage: 800, kills: 3, deaths: 3, assists: 3 } },
    ],
  });

  const analytics = await readJson(
    await api.get(`/api/guild-war/analytics?war_ids=${warAId},${warBId}`),
    "回读分析口径",
  ) as { wars: Array<{ war_name: string; modifier: number; duration_minutes: number | null }> };
  expect(analytics.wars, "两场战都必须进得了分析接口").toHaveLength(2);
  for (const war of analytics.wars) {
    expect(
      war.modifier,
      `${war.war_name} 的难度系数不是 1，下面所有期望值都会跟着偏——多半是站点配置改了 modifier_weights`,
    ).toBe(1);
    expect(war.duration_minutes, `${war.war_name} 的时长必须是参考时长的两倍`).toBe(referenceDuration * 2);
  }
});

test.afterEach(async ({ api }) => {
  /* 先删战史再删活动：destroyEvent 对 war_history 只做 event_id = NULL，
     顺序反了战史会留在库里，下一次运行的排名和行数就全乱了。 */
  const histories = await readJson(
    await api.get(`/api/guild-war/history?search=${stamp}&limit=20`),
    "回读待清理的战史",
  ) as { data: Array<{ id: string }> };
  if (histories.data.length > 0) {
    const response = await api.post("/api/guild-war/history/batch-delete", {
      data: { ids: histories.data.map((entry) => entry.id) },
    });
    expect(response.ok(), `清理战史返回 ${response.status()}: ${await response.text()}`).toBe(true);
  }

  const events = await readJson(
    await api.get(`/api/events?search=${stamp}&limit=50`),
    "回读待清理的活动",
  ) as { data: Array<{ id: string }> };
  for (const entry of events.data) {
    const response = await api.delete(`/api/events/${entry.id}/destroy`);
    expect([200, 204, 404], `清理活动返回 ${response.status()}`).toContain(response.status());
  }
});

type SeedWarInput = {
  title: string;
  result: "win" | "loss" | "draw";
  teams: Array<{ team_name: string; members: Member[] }>;
  memberStats: Array<{ user_id: string; stats: Record<string, number> }>;
};

/** 用接口结束一场真战：只有这样造出来的战史才带队伍和成员数据。 */
async function seedWar(api: APIRequestContext, input: SeedWarInput): Promise<string> {
  const created = await readJson(
    await api.post("/api/events", {
      data: {
        type: "guild_war",
        title: input.title,
        start_at: new Date(Date.now() + START_OFFSET_MS).toISOString(),
        end_at: new Date(Date.now() + END_OFFSET_MS).toISOString(),
      },
    }),
    `创建活动 ${input.title}`,
  ) as { id: string };

  const participantIds = [...new Set(input.teams.flatMap((team) => team.members.map((member) => member.id)))];
  const joined = await api.post(`/api/events/${created.id}/participants`, {
    data: { user_ids: participantIds },
  });
  expect(joined.ok(), `预置参战成员返回 ${joined.status()}: ${await joined.text()}`).toBe(true);

  const saved = await api.post("/api/guild-war/save-teams", {
    data: {
      event_id: created.id,
      teams: input.teams.map((team, teamIndex) => ({
        team_name: team.team_name,
        sort_order: teamIndex,
        members: team.members.map((member, memberIndex) => ({
          user_id: member.id,
          sort_order: memberIndex,
        })),
      })),
      pool_members: [],
    },
  });
  expect(saved.ok(), `预置编队返回 ${saved.status()}: ${await saved.text()}`).toBe(true);

  const concluded = await readJson(
    await api.post("/api/guild-war/conclude", {
      data: {
        event_id: created.id,
        war_info: {
          enemy_name: `Rivals ${stamp}`,
          result: input.result,
          duration_minutes: referenceDuration * 2,
          own_stats: OWN_STATS,
          enemy_stats: ENEMY_STATS,
        },
        member_stats: input.memberStats,
      },
    }),
    `结束战争 ${input.title}`,
  ) as { war_history_id: string };
  return concluded.war_history_id;
}

// ── 定位器 ──

function consoleField(page: Page, label: string): Locator {
  return page.locator(".gwa-field").filter({
    has: page.locator(".gwa-field__label", { hasText: new RegExp(`^${label}$`) }),
  });
}

/**
 * 打开控制台里的一个折叠区。
 * 这些区是手风琴：同时只有一个能开着，所以点开一个等于关掉别的。
 */
async function openConsoleField(page: Page, label: string): Promise<Locator> {
  const section = consoleField(page, label);
  const head = section.locator(".gwa-field__head");
  await expect(head, `控制台上没有「${label}」这一项`).toBeVisible();
  if ((await head.getAttribute("aria-expanded")) !== "true") {
    await head.click();
  }
  const body = section.locator(".gwa-field__body");
  await expect(body).toBeVisible();
  return body;
}

function fieldSummary(page: Page, label: string): Locator {
  return consoleField(page, label).locator(".gwa-field__summary");
}

/** Mantine 的 SegmentedControl 把 radio 藏起来了，只有 label 可点。 */
function segment(scope: Locator | Page, label: string): Locator {
  return scope.locator("label.mantine-SegmentedControl-label").filter({
    hasText: new RegExp(`^${label}$`),
  });
}

function toolbar(page: Page): Locator {
  return page.locator(".gwa-toolbar");
}

/** 当前选中的分段值：读被选中的那个隐藏 radio。 */
function checkedSegmentValue(page: Page, value: string): Locator {
  return toolbar(page).locator(`input[type='radio'][value='${value}']`);
}

function listboxOption(page: Page, listboxLabel: string, text: string): Locator {
  return page.getByRole("listbox", { name: listboxLabel }).getByRole("option").filter({ hasText: text });
}

function tableColumns(page: Page): Locator {
  return page.locator(".gwa-table-wrap thead th");
}

function tableRows(page: Page): Locator {
  return page.locator(".gwa-table-wrap tbody tr");
}

function rowCells(page: Page, index: number): Locator {
  return tableRows(page).nth(index).locator("td");
}

function chartHeading(page: Page): Locator {
  return page.locator(".gwa-chart__heading");
}

function emptyState(page: Page): Locator {
  return page.locator(".gwa-chart__empty");
}

/**
 * 打开 Analytics 标签，并把战集筛到本条用例造的那两场。
 * 先在 History 标签搜一次，是因为两个标签共用同一个列表查询。
 */
async function openAnalyticsTab(page: Page, flow: Flow): Promise<void> {
  await page.goto("/guild-war");
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await flow.act(
    () => field(page, "Search war records").fill(String(stamp)),
    HISTORY_LIST,
  );
  await expect(page.locator(".war-history-rail-item"), "列表必须只剩本用例的两场战").toHaveCount(2);

  await flow.act(
    () => page.getByRole("tab", { name: "Analytics", exact: true }).click(),
    ANALYTICS,
  );
  await expect(page.locator(".gwa-console")).toBeVisible();
}

/** 选中一个成员（列表项是按钮，再点一次就是取消选中）。 */
async function toggleMember(page: Page, username: string): Promise<void> {
  await listboxOption(page, "Select player analytics members", username).click();
}

test("战集与日期预设：换一组战就重新向服务端取数，显式选战会把预设顶成 All", async ({ page, flow }) => {
  await openAnalyticsTab(page, flow);

  await expect(checkedSegmentValue(page, "10"), "默认预设是最近 10 场").toBeChecked();
  await expect(chartHeading(page), "默认把筛出来的两场都算进去").toContainText("2 wars");
  await expect(fieldSummary(page, "War Set")).toHaveText("2 wars");

  const warSet = await openConsoleField(page, "War Set");
  await expect(
    warSet.getByRole("option"),
    "战集列表里应当只有本用例筛出来的两场",
  ).toHaveCount(2);

  // 只挑一场：查询键变了，必须真的重新向服务端取数，而且只带这一场的 id。
  const requested = page.waitForRequest(
    (request) => request.method() === "GET"
      && new URL(request.url()).pathname === "/api/guild-war/analytics",
  );
  await flow.act(() => warSet.getByRole("option").filter({ hasText: warATitle }).click(), ANALYTICS);
  expect(
    new URL((await requested).url()).searchParams.get("war_ids"),
    "请求里带的应当正好是被选中的那一场",
  ).toBe(warAId);

  await expect(warSet.getByRole("option").filter({ hasText: warATitle })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(fieldSummary(page, "War Set")).toHaveText("1 wars");
  await expect(chartHeading(page)).toContainText("1 wars");
  await expect(
    checkedSegmentValue(page, "all"),
    "手动挑战之后日期预设必须自己变成 All——否则界面在说「最近 10 场」，算的却是 1 场",
  ).toBeChecked();

  /* 回到预设：显式选择被清空，战集回到两场。这一步命中的是已经取过的查询键
     （staleTime: Infinity），不会再发请求，所以只断言界面。 */
  await segment(toolbar(page), "Last 5").click();
  await expect(checkedSegmentValue(page, "5")).toBeChecked();
  await expect(fieldSummary(page, "War Set")).toHaveText("2 wars");
  await expect(
    warSet.getByRole("option").filter({ hasText: warATitle }),
    "换预设必须把手动挑的那一场也放开，否则两个控件会互相打架",
  ).toHaveAttribute("aria-selected", "false");
});

test("玩家模式：空状态引导选人，选中谁表格就出谁的列", async ({ page, flow }) => {
  await openAnalyticsTab(page, flow);

  // 一个人都没选时，图表位给的是引导，不是空图。
  await expect(emptyState(page)).toContainText("Choose data to chart");
  await expect(emptyState(page)).toContainText("Select a member in the left panel");
  await expect(page.locator(".gwa-chart canvas"), "空状态下不该还画着图").toHaveCount(0);

  await emptyState(page).getByRole("button", { name: "Select first member", exact: true }).click();
  await expect(page.locator(".gwa-chart canvas"), "引导按钮点完就该出图").toBeVisible();
  await expect(tableColumns(page)).toHaveText([
    "War",
    "Date",
    "Result",
    `${firstSelectable.username} - Damage`,
  ]);

  const members = await openConsoleField(page, "Members");
  await expect(members.getByRole("option"), "可选成员就是这两场战里出现过的三个人").toHaveCount(3);
  await expect(
    members.getByRole("option").filter({ hasText: firstSelectable.username }),
    "引导按钮选的那个人要在列表里显示成已选",
  ).toHaveAttribute("aria-selected", "true");

  // 再点一次取消：选择清空后又退回空状态，说明这个列表项是真正的双向开关。
  await toggleMember(page, firstSelectable.username);
  await expect(emptyState(page)).toContainText("Choose data to chart");

  await toggleMember(page, m1.username);
  await expect(tableColumns(page)).toHaveText(["War", "Date", "Result", `${m1.username} - Damage`]);
  await expect(tableRows(page), "两场战各一行").toHaveCount(2);
  await expect(page.getByText("Data Table (2 rows)", { exact: true })).toBeVisible();

  // 时间轴按 created_at 升序：先 A 后 B。数值是归一化之后的（原值的一半）。
  await expect(rowCells(page, 0).nth(0)).toHaveText(warATitle);
  await expect(rowCells(page, 0).nth(3)).toHaveText("500");
  await expect(rowCells(page, 1).nth(0)).toHaveText(warBTitle);
  await expect(rowCells(page, 1).nth(3)).toHaveText("1000");

  /* 现状记录，不是我认为对的样子：玩家模式的日期格直接铺了原始 ISO 串
     （analyticsPlayerRows 用的是 war.created_at 本身），战争模式那张表却截到了天。
     结果格同理，这里是没翻译的 "win"，战争模式里是 "Win"。 */
  await expect(rowCells(page, 0).nth(1)).toHaveText(/^\d{4}-\d{2}-\d{2}T/);
  await expect(rowCells(page, 0).nth(2)).toHaveText("win");
});

test("玩家模式：「只看参战过的活动」真的把没上场的那一场从表里去掉", async ({ page, flow }) => {
  await openAnalyticsTab(page, flow);
  await openConsoleField(page, "Members");
  // m3 只打了 B 那一场。
  await toggleMember(page, m3.username);

  await expect(
    tableRows(page),
    "默认开着「只看参战过的活动」，没上场的那一场不该占一行",
  ).toHaveCount(1);
  await expect(rowCells(page, 0).nth(0)).toHaveText(warBTitle);
  await expect(rowCells(page, 0).nth(3)).toHaveText("400");

  await toggleInput(page, "Only include wars the selected player participated in").uncheck();
  await expect(tableRows(page), "关掉之后没上场的那一场也要列出来").toHaveCount(2);
  await expect(rowCells(page, 0).nth(0)).toHaveText(warATitle);
  await expect(rowCells(page, 0).nth(3), "没上场的格子给的是占位符，不是 0").toHaveText("-");

  await toggleInput(page, "Only include wars the selected player participated in").check();
  await expect(tableRows(page)).toHaveCount(1);
});

test("指标最多选五个：选满之后第六个点不动，退掉一个又能选", async ({ page, flow }) => {
  await openAnalyticsTab(page, flow);
  await openConsoleField(page, "Members");
  await toggleMember(page, m1.username);

  const metrics = await openConsoleField(page, "Metrics");
  const metricOption = (name: string): Locator =>
    metrics.getByRole("option").filter({ hasText: new RegExp(`^${name}$`) });

  // 默认已经选了 Damage，再补四个凑满五个。
  await expect(metricOption("Damage")).toHaveAttribute("aria-selected", "true");
  for (const name of ["Healing", "Credits", "Kills", "Deaths"]) {
    await metricOption(name).click();
  }
  await expect(tableColumns(page), "三列固定列加上五个指标列").toHaveCount(8);

  await expect(
    metricOption("Assists"),
    "选满五个之后，剩下的选项必须禁用——不然点了没反应就成了哑控件",
  ).toBeDisabled();

  await metricOption("Deaths").click();
  await expect(metricOption("Assists"), "退掉一个之后必须重新可选").toBeEnabled();
  await expect(tableColumns(page)).toHaveCount(7);
});

test("排行榜模式：聚合方式、Top N 与最少场次各自改变榜单", async ({ page, flow }) => {
  await openAnalyticsTab(page, flow);
  await segment(toolbar(page), "Rankings").click();

  await expect(tableColumns(page)).toHaveText([
    "#",
    "Member",
    "Wars",
    "Rostered",
    "Excused",
    "Attendance %",
    "Score",
    "±σ",
  ]);

  /* 归一化后的伤害：A 场 m1 500 / m2 300，B 场 m1 1000 / m2 200 / m3 400。
     合计口径下 m1 1500 > m2 500 > m3 400。 */
  await expect(tableRows(page)).toHaveCount(3);
  await expect(rowCells(page, 0).nth(1)).toHaveText(m1.username);
  await expect(rowCells(page, 0).nth(2), "m1 两场都在").toHaveText("2");
  await expect(rowCells(page, 0).nth(6)).toHaveText("1500");
  await expect(rowCells(page, 1).nth(1)).toHaveText(m2.username);
  await expect(rowCells(page, 1).nth(6)).toHaveText("500");
  await expect(rowCells(page, 2).nth(1)).toHaveText(m3.username);
  await expect(rowCells(page, 2).nth(6)).toHaveText("400");

  await openConsoleField(page, "Rankings setup");
  // 换成平均：m1 750、m3 400、m2 250——名次也跟着换，不只是数字变小。
  await selectOption(page, "Select rankings aggregation", "Average");
  await expect(rowCells(page, 0).nth(6)).toHaveText("750");
  await expect(rowCells(page, 1).nth(1), "平均口径下只打了一场的 m3 应当反超 m2").toHaveText(
    m3.username,
  );
  await expect(rowCells(page, 1).nth(6)).toHaveText("400");
  await expect(rowCells(page, 2).nth(6)).toHaveText("250");

  await selectOption(page, "Select rankings aggregation", "Best");
  await expect(rowCells(page, 0).nth(6), "最好一场：m1 的 B 场 1000").toHaveText("1000");
  await expect(rowCells(page, 2).nth(6), "m2 最好的一场是 A 场 300").toHaveText("300");

  await selectOption(page, "Select rankings aggregation", "Total");

  await field(page, "Select rankings top N").fill("1");
  await expect(tableRows(page), "Top 1 就只留榜首").toHaveCount(1);
  await expect(chartHeading(page)).toContainText("Top 1");

  await field(page, "Select rankings top N").fill("10");
  await expect(tableRows(page)).toHaveCount(3);

  await field(page, "Set the minimum number of wars played").fill("2");
  await expect(tableRows(page), "只打过一场的 m3 要被门槛挡掉").toHaveCount(2);
  await expect(page.getByText("Data Table (2 rows)", { exact: true })).toBeVisible();
});

test("队伍模式：队伍筛选与合计/平均两种口径", async ({ page, flow }) => {
  await openAnalyticsTab(page, flow);
  await segment(toolbar(page), "Teams").click();

  await expect(tableColumns(page)).toHaveText(["Team", "Wars", "Total", "Average"]);
  await expect(tableRows(page)).toHaveCount(2);

  /* Alpha 两场都在：A 场 500+300=800，B 场 1000+200=1200；Bravo 只有 B 场 400。 */
  await expect(rowCells(page, 0).nth(0)).toHaveText("Alpha");
  await expect(rowCells(page, 0).nth(1)).toHaveText("2");
  await expect(rowCells(page, 0).nth(2)).toHaveText("2000");
  await expect(rowCells(page, 0).nth(3)).toHaveText("1000");
  await expect(rowCells(page, 1).nth(0)).toHaveText("Bravo");
  await expect(rowCells(page, 1).nth(1)).toHaveText("1");
  await expect(rowCells(page, 1).nth(2)).toHaveText("400");

  // 队内口径换成平均：Alpha 每场变成人均（400 / 600），合计跟着变成 1000。
  await segment(page.locator(".gwa-console"), "Average").click();
  await expect(rowCells(page, 0).nth(2)).toHaveText("1000");
  await expect(rowCells(page, 0).nth(3)).toHaveText("500");
  await expect(rowCells(page, 1).nth(2), "Bravo 只有一个人，两种口径一样").toHaveText("400");

  await segment(page.locator(".gwa-console"), "Total").click();
  await expect(rowCells(page, 0).nth(2)).toHaveText("2000");

  const teams = await openConsoleField(page, "Teams");
  await teams.getByRole("option").filter({ hasText: "Alpha" }).click();
  await expect(tableRows(page), "只勾 Alpha 就只剩 Alpha").toHaveCount(1);
  await expect(rowCells(page, 0).nth(0)).toHaveText("Alpha");
  await expect(chartHeading(page)).toContainText("1 teams");
});

test("战争模式：胜负汇总、目标切换与双方比分", async ({ page, flow }) => {
  await openAnalyticsTab(page, flow);
  await segment(toolbar(page), "Wars").click();

  const summary = page.locator(".gwa-war-summary");
  await expect(summary).toContainText("Win 1");
  await expect(summary).toContainText("Loss 1");
  await expect(summary).toContainText("Draw 0");
  await expect(summary, "一胜一负就是五成").toContainText("Win rate 50%");

  await expect(tableColumns(page)).toHaveText([
    "War",
    "Date",
    "Opponent",
    "Result",
    "Own",
    "Enemy",
    "Margin",
  ]);
  await expect(tableRows(page)).toHaveCount(2);
  await expect(rowCells(page, 0).nth(0)).toHaveText(warATitle);
  await expect(rowCells(page, 0).nth(1), "这张表的日期截到了天").toHaveText(/^\d{4}-\d{2}-\d{2}$/);
  await expect(rowCells(page, 0).nth(3), "这张表的结果是翻译过的").toHaveText("Win");
  await expect(rowCells(page, 1).nth(3)).toHaveText("Loss");

  // 默认目标是击杀：双方各 10，差额 0（夹具刻意让双方相等，见文件头）。
  await expect(rowCells(page, 0).nth(4)).toHaveText("10");
  await expect(rowCells(page, 0).nth(5)).toHaveText("10");
  await expect(rowCells(page, 0).nth(6)).toHaveText("0");

  await openConsoleField(page, "War objective");
  await selectOption(page, "War objective", "Towers");
  await expect(rowCells(page, 0).nth(4), "换目标之后读的是另一项数据").toHaveText("4");
  await expect(rowCells(page, 0).nth(5)).toHaveText("4");
  await expect(chartHeading(page)).toContainText("Towers");

  await selectOption(page, "War objective", "Base HP");
  await expect(
    rowCells(page, 0).nth(4),
    "这场战没填基地血量，应当显示占位符而不是 0",
  ).toHaveText("-");
});

test("归一化：开关一按整表数值改写，权重滑块目前只是展示", async ({ page, flow }) => {
  await openAnalyticsTab(page, flow);
  await openConsoleField(page, "Members");
  await toggleMember(page, m1.username);

  const note = page.locator(".gwa-chart__note");
  await expect(note, "归一化开着就必须在图表头上说明白").toHaveText(
    `Values normalized to a ${referenceDuration}-minute baseline`,
  );
  await expect(rowCells(page, 0).nth(3)).toHaveText("500");

  /* 关掉：战斗时长是参考时长的两倍，所以原值正好是现在的两倍。
     点的是轨道而不是 input——Mantine 把 aria-hidden 的轨道盖在 input 上，
     直接点 input 会被判定成「被别的元素挡住」，重试到超时。轨道在 <label> 里，
     点它就是用户真实的点法。 */
  const normSwitch = toggleInput(page, "Enable normalization");
  await flow.clickWithoutApi(page.locator(".gwa-norm .mantine-Switch-track"));
  await expect(normSwitch).not.toBeChecked();
  await expect(note, "关掉之后那行提示必须消失").toHaveCount(0);
  await expect(rowCells(page, 0).nth(3)).toHaveText("1000");
  await expect(rowCells(page, 1).nth(3)).toHaveText("2000");

  await page.locator(".gwa-norm .mantine-Switch-track").click();
  await expect(normSwitch).toBeChecked();
  await expect(rowCells(page, 0).nth(3)).toHaveText("500");

  // 展开权重面板（只有开着归一化时才展得开）。
  await page.locator(".gwa-norm-toggle__expand").click();
  const weights = page.locator(".gwa-norm-weights");
  await expect(weights).toBeVisible();
  await expect(weights.getByRole("slider"), "五个权重各一根滑块").toHaveCount(5);

  const firstWeight = weights.getByRole("slider").first();
  const firstValue = weights.locator("> div").first();
  const before = await firstValue.innerText();
  await firstWeight.press("ArrowRight");
  await expect(firstValue, "滑块要能动").not.toHaveText(before);

  /*
   * 现状记录，等确认：难度系数是服务端按站点配置算好一起返回的
   * （GuildWarAnalyticsService.computeWarModifier），前端这份 modifierWeights
   * 只喂给了这几根滑块自己，既不参与任何计算，界面上也没有保存入口。
   * 所以拖动之后表格一个数字都不会变，刷新即还原——要么接上
   * PATCH /api/admin/analytics-settings，要么把滑块撤掉。
   */
  await expect(
    rowCells(page, 0).nth(3),
    "现状：拖权重不影响任何数值，因为难度系数是服务端算的",
  ).toHaveText("500");
});

test("数据表与图表的展示控件：热力图、复制 CSV、展开图表、折叠表格", async ({ page, flow }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await openAnalyticsTab(page, flow);
  await openConsoleField(page, "Members");
  await toggleMember(page, m1.username);

  // 热力图：只给数值列上底色，文字列不动。
  const shaded = page.locator(".gwa-table-wrap td[style*='background']");
  await expect(shaded, "没开热力图之前不该有底色").toHaveCount(0);
  await toggleInput(page, "Heatmap").check();
  await expect(shaded, "两行数值格各上一层底色").toHaveCount(2);
  await toggleInput(page, "Heatmap").uncheck();
  await expect(shaded).toHaveCount(0);

  await page.getByRole("button", { name: "Copy CSV", exact: true }).click();
  await expect(page.getByText("CSV copied to clipboard", { exact: true })).toBeVisible();
  const csv = await page.evaluate(() => navigator.clipboard.readText());
  // Windows 剪贴板会把 \n 换成 \r\n，按 \n 硬切会在行尾留下 \r。
  const [header, firstRow] = csv.split(/\r?\n/);
  /* 现状记录：表头写的是内部字段名（user0_metric0），不是表格上那列的标题
     「member_01 - Damage」。粘到聊天窗里没人看得懂这一列是谁的什么数据。 */
  expect(header, "现状：CSV 表头用的是内部字段名").toBe(
    "war_name,created_at,result,user0_metric0",
  );
  expect(firstRow, "第一行必须是表格里看到的那一行").toContain(warATitle);
  expect(firstRow).toContain("\"500\"");

  // 展开图表：控制台整块让位给图，按钮的无障碍名跟着翻面。
  await page.getByRole("button", { name: "Expand chart", exact: true }).click();
  await expect(page.locator(".gwa-console"), "展开之后控制台应当收起来").toHaveCount(0);
  await page.getByRole("button", { name: "Collapse chart", exact: true }).click();
  await expect(page.locator(".gwa-console")).toBeVisible();

  // 折叠数据表：表本身收起来，标题行还在（要能再展开）。
  const tableWrap = page.locator(".gwa-table-wrap");
  await expect(tableWrap).toBeVisible();
  await page.locator(".gwa-table-toggle__expand").click();
  await expect(tableWrap).not.toBeVisible();
  await page.locator(".gwa-table-toggle__expand").click();
  await expect(tableWrap).toBeVisible();
});
