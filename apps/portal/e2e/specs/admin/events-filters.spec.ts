import type { APIRequestContext, Locator, Page, Request } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import {
  clearButton,
  dialogTitled,
  ensureFiltersOpen,
  selectFilterOption,
  selectSegmentedControlOption,
} from "../../support/ui";

/*
 * 活动页的筛选条：搜索、类型、状态分段器、置顶/锁定开关、视图切换、新建按钮。
 *
 * 这一排控件全都是服务端筛选（改 URL → 改 query key → 重新拉 GET /api/events），
 * 所以每条用例都要求「请求真的发出去了」+「结果集真的变了」两件事同时成立。
 * 只断言列表变短是不够的：前端完全可以在本地过滤，那样翻页和总数就会是错的。
 *
 * 两个互补的一次性活动由用例自己建：Alpha 置顶且锁定，Beta 两者都不是，
 * 这样每个开关都能在「留下」和「滤掉」两个方向上被验证，不依赖种子数据。
 */

const EVENTS_REQUEST = { method: "GET", path: /^\/api\/events$/ } as const;

type Fixture = { id: string; title: string };

let stamp: number;
let alpha: Fixture;
let beta: Fixture;

test.beforeEach(async ({ page, api }) => {
  stamp = Date.now();
  alpha = await createEvent(api, `${SYSTEM_TEST_CONTENT_MARKER} Alpha ${stamp}`, "social");
  beta = await createEvent(api, `${SYSTEM_TEST_CONTENT_MARKER} Beta ${stamp}`, "other");
  // 置顶和锁定不在创建 schema 里，只能建完再补一刀。
  await readJson(
    await api.patch(`/api/events/${alpha.id}`, { data: { pinned: true, signup_locked: true } }),
    "把 Alpha 标成置顶且锁定",
  );

  await page.goto("/events");
  await expect(card(page, alpha.title)).toHaveCount(1);
  await expect(card(page, beta.title)).toHaveCount(1);
});

test.afterEach(async ({ api }) => {
  for (const fixture of [alpha, beta]) {
    const response = await api.delete(`/api/events/${fixture.id}/destroy`);
    expect([200, 204, 404], `清理活动 ${fixture.title} 返回 ${response.status()}`)
      .toContain(response.status());
  }
});

async function createEvent(api: APIRequestContext, title: string, type: string): Promise<Fixture> {
  const created = await readJson(
    await api.post("/api/events", {
      data: {
        type,
        title,
        start_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        end_at: new Date(Date.now() + 26 * 60 * 60_000).toISOString(),
      },
    }),
    `创建一次性活动 ${title}`,
  ) as { id: string };
  return { id: created.id, title };
}

function card(page: Page, title: string): Locator {
  return page.locator(".event-card").filter({ hasText: title });
}

function toggle(page: Page, label: string): Locator {
  return page.getByRole("button", { name: label, exact: true });
}

async function expectNoApiCalls(page: Page, action: () => Promise<void>): Promise<void> {
  const calls: string[] = [];
  const record = (request: Request): void => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/")) calls.push(`${request.method()} ${path}`);
  };
  page.on("request", record);
  try {
    await action();
    await page.waitForTimeout(500);
  } finally {
    page.off("request", record);
  }
  expect(calls, "这个视图切换本应是纯前端的，却发了请求").toEqual([]);
}

test("搜索框：命中项留下，其余滤掉，条件写进 URL", async ({ page, flow }) => {
  await flow.act(
    () => page.getByLabel("Search events…", { exact: true }).fill(`Alpha ${stamp}`),
    EVENTS_REQUEST,
  );

  await expect(card(page, alpha.title)).toHaveCount(1);
  await expect(card(page, beta.title), "没命中的活动必须消失").toHaveCount(0);
  // 条件进 URL 才能被分享和刷新保留，这是筛选条的隐含契约。
  await expect(page).toHaveURL(/search=/);
});

test("类型下拉：只留下该类型，清空后两个都回来", async ({ page, flow }) => {
  await flow.act(
    () => selectFilterOption(page, page, "Filter events by type", "Other"),
    EVENTS_REQUEST,
  );
  await expect(card(page, beta.title)).toHaveCount(1);
  await expect(card(page, alpha.title), "Social 类型不该出现在 Other 筛选里").toHaveCount(0);

  /*
   * 清空是「退回一个刚取过的查询」：staleTime 是 5 分钟（apps/portal/router.tsx:251），
   * 这条键几秒前刚填过，直接命中缓存不再发请求。所以只断言结果回到全量。
   */
  await ensureFiltersOpen(page);
  await clearButton(page, "Filter events by type").click();
  await expect(card(page, alpha.title)).toHaveCount(1);
  await expect(card(page, beta.title)).toHaveCount(1);
});

test("状态分段器：Active/Archived/All 三档各自成立", async ({ page, flow, api }) => {
  // 归档走的是 DELETE /api/events/:id（软归档），这里用 API 预置一个归档态。
  expect((await api.delete(`/api/events/${alpha.id}`)).ok(), "预置归档失败").toBe(true);
  await page.reload();

  await expect(card(page, alpha.title), "默认的 Active 档不该显示已归档活动").toHaveCount(0);
  await expect(card(page, beta.title)).toHaveCount(1);

  await ensureFiltersOpen(page);
  await flow.act(() => selectSegmentedControlOption(page, "Archived"), EVENTS_REQUEST);
  await expect(card(page, alpha.title)).toHaveCount(1);
  await expect(card(page, beta.title), "未归档的活动不该出现在 Archived 档").toHaveCount(0);

  await ensureFiltersOpen(page);
  await flow.act(() => selectSegmentedControlOption(page, "All"), EVENTS_REQUEST);
  await expect(card(page, alpha.title)).toHaveCount(1);
  await expect(card(page, beta.title)).toHaveCount(1);
});

test("置顶筛选：按下后只剩置顶活动，按钮状态同步翻转", async ({ page, flow }) => {
  await ensureFiltersOpen(page);
  const pinned = toggle(page, "Pinned only");
  await expect(pinned).toHaveAttribute("aria-pressed", "false");

  await flow.act(() => pinned.click(), EVENTS_REQUEST);

  await expect(pinned, "筛选开着时按钮必须自报状态，否则用户不知道列表为何变短")
    .toHaveAttribute("aria-pressed", "true");
  await expect(card(page, alpha.title)).toHaveCount(1);
  await expect(card(page, beta.title)).toHaveCount(0);
});

test("锁定筛选：按下后只剩锁定报名的活动", async ({ page, flow }) => {
  await ensureFiltersOpen(page);
  const locked = toggle(page, "Locked only");
  await flow.act(() => locked.click(), EVENTS_REQUEST);

  await expect(locked).toHaveAttribute("aria-pressed", "true");
  await expect(card(page, alpha.title)).toHaveCount(1);
  await expect(card(page, beta.title)).toHaveCount(0);
});

test("视图切换：卡片与月历互斥，选择写进 URL，且不重新拉数据", async ({ page }) => {
  /*
   * 换视图只是换同一份数据的呈现方式，不该再打一次服务端。
   * 这里钉死这一点：哪天有人把它改成每次切换都重新拉全量，这条用例会立刻变红。
   */
  await expectNoApiCalls(page, () => selectSegmentedControlOption(page, "Month"));
  await expect(page).toHaveURL(/view=month/);
  await expect(page.locator(".event-card"), "月历视图下不该还留着卡片列表").toHaveCount(0);

  await expectNoApiCalls(page, () => selectSegmentedControlOption(page, "Cards"));
  await expect(card(page, alpha.title)).toHaveCount(1);
});

test("新建按钮：打开创建弹窗，此时不该产生任何请求", async ({ page, flow }) => {
  await flow.clickWithoutApi(page.getByRole("button", { name: "Create Event", exact: true }));
  await expect(dialogTitled(page, "Create Event")).toBeVisible();
});
