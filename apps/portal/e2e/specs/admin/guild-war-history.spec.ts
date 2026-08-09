import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test, type Flow } from "../../support/test";
import { confirmDialog, expectNoDialog, field, selectOption } from "../../support/ui";

/*
 * 公会战「History」标签：战史列表（搜索、日期筛选、翻页、每页条数）、明细面板
 * （比分、队伍快照、表格/图表切换）、成员数据编辑、删除、导出。
 *
 * 前置数据是用接口结束一场真战造出来的（POST /api/guild-war/conclude）——
 * 结束流程本身在 guild-war-conclude.spec.ts 里已经逐控件验过，这里它只是夹具。
 * 只有这样造出来的战史才带队伍和成员，成员数据编辑才有东西可改。
 *
 * 列表查询有 10 分钟的 staleTime：回到一个已经取过的筛选条件时 TanStack Query
 * 直接给缓存，不再发请求。所以只有「第一次出现的条件」才用 flow 断言网络，
 * 回头路一律只断言界面结果——把缓存命中当成「控件没反应」是本文件最容易踩的坑。
 *
 * 清理同样要先删战史再删活动：destroyEvent 对 war_history 只做 event_id = NULL。
 */

const HISTORY_LIST = { method: "GET", path: /^\/api\/guild-war\/history$/ } as const;
const SAVE_MEMBER_STATS = {
  method: "PATCH",
  path: /^\/api\/guild-war\/history\/[^/]+\/member-stats\/batch$/,
} as const;
const DELETE_HISTORY = { method: "DELETE", path: /^\/api\/guild-war\/history\/[^/]+$/ } as const;
const EXPORT = { method: "GET", path: /^\/api\/guild-war\/export$/ } as const;

const START_OFFSET_MS = 400 * 24 * 60 * 60_000;
const END_OFFSET_MS = START_OFFSET_MS + 2 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

type HistoryRow = { id: string; war_name: string; result: string | null };
type HistoryDetail = HistoryRow & {
  member_stats: Array<{ user_id: string; username?: string; stats: Record<string, number> | null }>;
};

let stamp: number;
let title: string;
let enemyName: string;
let eventId: string;
let historyId: string;
let member: { id: string; username: string };

test.beforeEach(async ({ api }) => {
  stamp = Date.now();
  title = `${SYSTEM_TEST_CONTENT_MARKER} War ${stamp}`;
  enemyName = `Crimson ${stamp}`;

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

  /* 再留一场没结束的战。导出按钮会带上 Active 标签当前选中的活动（见导出那条用例
     里的说明），可选列表空掉时选中项也会空掉，两种情况下导出的过滤条件完全不同。
     固定留一场，导出的行为才是确定的。 */
  await readJson(
    await api.post("/api/events", {
      data: {
        type: "guild_war",
        title: `${SYSTEM_TEST_CONTENT_MARKER} Decoy ${stamp}`,
        start_at: new Date(Date.now() + START_OFFSET_MS).toISOString(),
        end_at: new Date(Date.now() + END_OFFSET_MS).toISOString(),
      },
    }),
    "创建垫底的公会战活动",
  );

  const saved = await api.post("/api/guild-war/save-teams", {
    data: {
      event_id: eventId,
      teams: [{ team_name: "Alpha", sort_order: 0, members: [{ user_id: member.id, sort_order: 0 }] }],
      pool_members: [],
    },
  });
  expect(saved.ok(), `预置编队返回 ${saved.status()}: ${await saved.text()}`).toBe(true);

  const concluded = await readJson(
    await api.post("/api/guild-war/conclude", {
      data: {
        event_id: eventId,
        war_info: {
          enemy_name: enemyName,
          result: "win",
          duration_minutes: 42,
          own_stats: { kills: 7, towers: 2 },
          enemy_stats: { kills: 3, towers: 1 },
        },
        member_stats: [{ user_id: member.id, stats: { kills: 3, deaths: 2, assists: 1 } }],
      },
    }),
    "结束战争造出战史",
  ) as { war_history_id: string };
  historyId = concluded.war_history_id;
});

test.afterEach(async ({ api }) => {
  const histories = await readJson(
    await api.get(`/api/guild-war/history?search=${stamp}&limit=100`),
    "回读待清理的战史",
  ) as { data: HistoryRow[] };
  const ids = histories.data.map((entry) => entry.id);
  for (let index = 0; index < ids.length; index += 50) {
    const response = await api.post("/api/guild-war/history/batch-delete", {
      data: { ids: ids.slice(index, index + 50) },
    });
    expect(response.ok(), `清理战史返回 ${response.status()}: ${await response.text()}`).toBe(true);
  }

  const events = await readJson(
    await api.get(`/api/events?search=${stamp}&limit=50`),
    "回读待清理的活动",
  ) as { data: { id: string }[] };
  for (const entry of events.data) {
    const response = await api.delete(`/api/events/${entry.id}/destroy`);
    expect([200, 204, 404], `清理活动返回 ${response.status()}`).toContain(response.status());
  }
});

async function readDetail(api: APIRequestContext): Promise<HistoryDetail> {
  return await readJson(
    await api.get(`/api/guild-war/history/${historyId}`),
    "回读战史明细",
  ) as HistoryDetail;
}

function railItems(page: Page): Locator {
  return page.locator(".war-history-rail-item");
}

function railItem(page: Page, name: string): Locator {
  return page.getByRole("button", { name: `Open war record ${name}`, exact: true });
}

function detailPanel(page: Page): Locator {
  return page.locator(".war-history-detail-panel");
}

function searchBox(page: Page): Locator {
  return field(page, "Search war records");
}

/** 打开 History 标签，等列表卡片渲染出来。 */
async function gotoHistoryTab(page: Page): Promise<void> {
  await page.goto("/guild-war");
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(page.locator(".war-history-list-card")).toBeVisible();
}

/**
 * 打开 History 标签，并把列表筛到本条用例造的那一条。
 * 全局列表里还有别的战史，不筛掉后面的行数断言就不确定。
 */
async function openThisWar(page: Page, flow: Flow): Promise<void> {
  await gotoHistoryTab(page);
  await flow.act(() => searchBox(page).fill(String(stamp)), HISTORY_LIST);
  await expect(railItems(page)).toHaveCount(1);
  await expect(railItem(page, title)).toBeVisible();
  // 列表只剩一条时明细面板会自动选中它。
  await expect(detailPanel(page)).toContainText(title);
}

test("搜索与日期筛选：条件都送到服务端，列表跟着变", async ({ page, flow }) => {
  await openThisWar(page, flow);

  await flow.act(() => searchBox(page).fill(`nobody-${stamp}`), HISTORY_LIST);
  await expect(railItems(page), "搜不到就该是空列表，而不是退回全量").toHaveCount(0);
  await expect(page.getByText("No war records found.", { exact: true })).toBeVisible();

  // 回到刚才那个条件：结果由缓存直接给出，所以这里只对界面，不等请求。
  await searchBox(page).fill(String(stamp));
  await expect(railItems(page)).toHaveCount(1);

  // 起始日期挪到明天：今天造的这条必须被筛掉。
  const tomorrow = new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);
  await flow.act(() => field(page, "Guild war history date from").fill(tomorrow), HISTORY_LIST);
  await expect(railItems(page), "起始日期在它之后，这条战史不该还留在列表里").toHaveCount(0);

  await page.getByRole("button", { name: "Clear dates", exact: true }).click();
  await expect(field(page, "Guild war history date from")).toHaveValue("");
  await expect(railItems(page), "清掉日期之后必须重新出现").toHaveCount(1);
});

test("深链接 ?warName=：仪表盘点进来时列表要按战名预筛，纯数字的战名也不能把路由打崩", async ({ page, api }) => {
  /* 仪表盘的「上一场战」卡片就是这么跳过来的（LastWarCard 的 onOpenHistory 直接传战名）。
     TanStack 的默认搜索参数解析会先拿 JSON.parse 试一遍，"1785..." 这种纯数字战名
     会被解析成 number，再进 zod 校验——所以这里特意造一个纯数字名字的战史。 */
  const numericName = String(stamp);
  const created = await api.post("/api/guild-war/history", {
    data: { war_name: numericName, result: "draw" },
  });
  expect(created.ok(), `预置纯数字战名的战史返回 ${created.status()}`).toBe(true);

  await page.goto(`/guild-war?warName=${numericName}`);

  await expect(
    page.getByRole("tab", { name: "History", exact: true }),
    "带着战名进来就应该直接落在 History 标签",
  ).toHaveAttribute("aria-selected", "true");
  await expect(searchBox(page), "搜索框要预填成链接里的战名").toHaveValue(numericName);
  await expect(railItems(page), "预筛之后只剩名字里带这串数字的两条").toHaveCount(2);
  await expect(railItem(page, numericName)).toBeVisible();
});

test("明细面板：比分、队伍快照与表格/图表切换", async ({ page, flow }) => {
  await openThisWar(page, flow);

  const detail = detailPanel(page);
  const scoreboard = detail.locator("[data-testid='war-history-scoreboard']");
  await expect(scoreboard, "记分板正中就是双方击杀").toContainText("7");
  await expect(scoreboard).toContainText("3");
  await expect(scoreboard).toContainText("Win");
  await expect(scoreboard, "对手名要显示出来，否则这条记录看不出打的是谁").toContainText(enemyName);

  await expect(detail.locator(".whd-team__name")).toContainText("Alpha");
  await expect(detail.locator(".whd-chip")).toContainText(member.username);

  const table = detail.locator(".war-history-detail-table-wrap");
  await expect(table).toContainText(member.username);
  await expect(table.locator("input"), "没点编辑之前整张表都不该是输入框").toHaveCount(0);

  // 表格 / 图表切换是纯前端的。Mantine 的 SegmentedControl 把 radio 藏了，只能点 label。
  await flow.clickWithoutApi(
    detail.locator("label.mantine-SegmentedControl-label", { hasText: "Chart" }),
  );
  await expect(detail.locator(".whd-chart-wrap canvas")).toBeVisible();
  await expect(table).toHaveCount(0);

  // 图表模式下才出现的指标选择器，同样不碰网络。
  await expect(field(detail, "Chart metric")).toBeVisible();
  await selectOption(detail, "Chart metric", "Healing");

  await flow.clickWithoutApi(
    detail.locator("label.mantine-SegmentedControl-label", { hasText: "Table" }),
  );
  await expect(detail.locator(".war-history-detail-table-wrap")).toBeVisible();
});

test("编辑成员数据：取消回退不落库，保存才写回服务端", async ({ page, flow, api }) => {
  await openThisWar(page, flow);

  const detail = detailPanel(page);
  const killsLabel = `${member.username} — Kills`;

  await flow.clickWithoutApi(detail.getByRole("button", { name: "Edit Data", exact: true }));
  await expect(field(detail, killsLabel), "进入编辑态后这一格才是输入框").toHaveValue("3");

  // 改一个数字再取消：必须弹确认框（改动会被丢掉），确认后回退到原值。
  await field(detail, killsLabel).fill("99");
  await expect(detail.getByText("You have unsaved member stat changes.").first()).toBeVisible();

  await flow.clickWithoutApi(detail.getByRole("button", { name: "Cancel", exact: true }));
  await flow.clickWithoutApi(
    (await confirmDialog(page, "You have unsaved member stat changes."))
      .getByRole("button", { name: "Discard Changes", exact: true }),
  );
  await expectNoDialog(page);
  await expect(field(detail, killsLabel), "丢弃之后要退回只读态").toHaveCount(0);
  expect(
    (await readDetail(api)).member_stats.find((row) => row.user_id === member.id)!.stats?.kills,
    "取消不能写库",
  ).toBe(3);

  // 再改一次并保存：这次必须发批量更新并真的落库。
  await flow.clickWithoutApi(detail.getByRole("button", { name: "Edit Data", exact: true }));
  await expect(field(detail, killsLabel), "草稿必须已经退回基线").toHaveValue("3");
  await field(detail, killsLabel).fill("9");
  await flow.click(
    detail.getByRole("button", { name: "Save Changes", exact: true }),
    SAVE_MEMBER_STATS,
  );

  const saved = (await readDetail(api)).member_stats.find((row) => row.user_id === member.id);
  expect(saved!.stats?.kills, "保存必须把新数字写回服务端").toBe(9);
  expect(saved!.stats?.deaths, "没动过的指标不该被顺手改掉").toBe(2);
  await expect(
    detail.getByRole("button", { name: "Edit Data", exact: true }),
    "保存即退出编辑态",
  ).toBeVisible();
});

test("删除战史：取消什么都不做，确认后服务端和列表一起消失", async ({ page, flow, api }) => {
  await openThisWar(page, flow);

  const detail = detailPanel(page);
  await detail.getByRole("button", { name: "Delete", exact: true }).click();
  await (await confirmDialog(page, "Delete War Record"))
    .getByRole("button", { name: "Cancel", exact: true }).click();
  await expectNoDialog(page);
  expect(
    (await api.get(`/api/guild-war/history/${historyId}`)).status(),
    "取消之后这条战史必须还在",
  ).toBe(200);

  await detail.getByRole("button", { name: "Delete", exact: true }).click();
  await flow.act(async () => {
    await (await confirmDialog(page, "Delete War Record"))
      .getByRole("button", { name: "Delete", exact: true }).click();
  }, DELETE_HISTORY);

  expect(
    (await api.get(`/api/guild-war/history/${historyId}`)).status(),
    "确认之后服务端必须真的删掉",
  ).toBe(404);
  await expect(railItems(page)).toHaveCount(0);
  await expect(page.getByText("No war records found.", { exact: true })).toBeVisible();
});

test("导出：两种格式都真的下载下来，但导出范围不受列表筛选影响", async ({ page, flow }) => {
  await openThisWar(page, flow);

  for (const [label, extension] of [["Export CSV", "csv"], ["Export JSON", "json"]] as const) {
    const downloading = page.waitForEvent("download");
    /* 这里不能用 flow.click：它会读一遍响应体，而下载响应的体已经被浏览器接管，
       读出来是空的（JSON 导出会直接抛 "Unexpected end of JSON input"）。
       所以只等响应本身，落盘内容改由 download 对象去读。 */
    const responded = page.waitForResponse(
      (response) => response.request().method() === EXPORT.method
        && EXPORT.path.test(new URL(response.url()).pathname),
    );
    await detailPanel(page).getByRole("button", { name: new RegExp(`^${label}:`) }).click();
    const response = await responded;
    expect(response.status(), `${label} 的导出请求返回 ${response.status()}`).toBe(200);

    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`^guild-war-history-\\d{4}-\\d{2}-\\d{2}\\.${extension}$`),
    );

    const path = await download.path();
    expect(path, "下载没有落到磁盘上").toBeTruthy();
    const content = readFileSync(path, "utf8");
    /*
     * 这里断言的是现状，不是我认为对的行为：
     * 导出请求带的是 Active 标签当前选中的 event_id（GuildWarPage 把 activeSelectedEventId
     * 传给了 useGuildWarMutations），而刚被结束的这场战已经不在可选列表里了，
     * 选中的是另一场没结束的战——于是从 History 标签点导出，导出的恰恰不是
     * 列表里正在看的这条。搜索框同样不参与导出（服务端 exportHistory 根本不收 search）。
     * 已记为待确认的产品问题；改行为超出「补测试」的范围，等确认后再动。
     */
    expect(
      content.includes(title),
      "现状：导出被 Active 标签选中的活动过滤掉了，列表里看到的这条并不在文件里",
    ).toBe(false);
  }
});

test("翻页与每页条数：页码、上下页与每页条数都重新向服务端取数", async ({ page, flow, api }) => {
  // 默认每页 20 条，凑够 21 条才会出现分页控件。
  for (let index = 0; index < 20; index += 1) {
    const response = await api.post("/api/guild-war/history", {
      data: { war_name: `${SYSTEM_TEST_CONTENT_MARKER} Bulk ${index} ${stamp}`, result: "loss" },
    });
    expect(response.ok(), `预置第 ${index} 条战史返回 ${response.status()}`).toBe(true);
  }

  await gotoHistoryTab(page);
  await flow.act(() => searchBox(page).fill(String(stamp)), HISTORY_LIST);
  await expect(railItems(page), "第一页应当铺满 20 条").toHaveCount(20);

  const firstPage = page.getByRole("button", { name: "First page", exact: true });
  const prevPage = page.getByRole("button", { name: "Previous page", exact: true });
  const nextPage = page.getByRole("button", { name: "Next page", exact: true });
  const lastPage = page.getByRole("button", { name: "Last page", exact: true });

  await expect(firstPage, "已经在第一页").toBeDisabled();
  await expect(prevPage, "已经在第一页").toBeDisabled();

  await flow.click(nextPage, HISTORY_LIST);
  await expect(railItems(page), "21 条数据的第二页只剩 1 条").toHaveCount(1);
  await expect(railItem(page, title), "最早造的那条排在最后一页").toBeVisible();
  await expect(nextPage, "已经在最后一页").toBeDisabled();
  await expect(lastPage, "已经在最后一页").toBeDisabled();

  // 回第一页与直接填页码都走缓存（同一个 queryKey 已经取过），只对界面。
  await firstPage.click();
  await expect(railItems(page)).toHaveCount(20);

  /* 页码输入框没有可访问名，只能按结构取——这是这块分页条上的一个无障碍缺口。 */
  await page.locator(".war-history-pagination__pages input").fill("2");
  await expect(railItems(page)).toHaveCount(1);

  // 每页 50：21 条并成一页，分页控件整组消失。
  const perPage = page.locator(".war-history-pagination input[aria-haspopup='listbox']");
  await flow.act(async () => {
    await perPage.click();
    await page.getByRole("option", { name: "50", exact: true }).click();
  }, HISTORY_LIST);
  await expect(railItems(page), "每页 50 之后 21 条应当在同一页").toHaveCount(21);
  await expect(page.locator(".war-history-pagination")).toHaveCount(0);
});
