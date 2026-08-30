import type { APIRequestContext, Locator, Page, Request } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";

/*
 * 活动页的筛选条：搜索、类型、状态分段器、置顶/锁定开关、视图切换、新建按钮。
 *
 * 这一排控件全都是服务端筛选（改 URL → 改 query key → 重新拉 GET /api/events），
 * 所以每条筛选用例都要求首次切换时「请求真的发出去了」+「结果集真的变了」。
 * 返回已经缓存过的筛选条件可以直接复用 TanStack Query 缓存，但 URL 和结果仍必须恢复。
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
    await api.patch(`/api/events/${alpha.id}`, {
      data: {
        pinned: true,
        signup_locked: true,
        expected_updated_at: await currentEventUpdatedAt(api, alpha.id),
      },
    }),
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

async function currentEventUpdatedAt(api: APIRequestContext, id: string): Promise<string> {
  const event = await readJson(await api.get(`/api/events/${id}`), `读取活动 ${id} 的当前版本`) as {
    updated_at?: unknown;
  };
  expect(typeof event.updated_at, `活动 ${id} 缺少更新版本`).toBe("string");
  return event.updated_at as string;
}

function card(page: Page, title: string): Locator {
  return page.locator(".event-card").filter({ hasText: title });
}

async function filtersPanel(page: Page): Promise<Locator> {
  const toggle = page.getByRole("button", { name: /^Filters(?: \(\d+\))?$/ }).first();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  const panel = page.getByRole("dialog", { name: /^Filters(?: \(\d+\))?$/ });
  await expect(panel).toBeVisible();
  return panel;
}

function filterGroup(panel: Locator, label: string): Locator {
  return panel.getByRole("region", { name: label, exact: true });
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

test("类型单选：只留下该类型，重置为 All 后两个都回来", async ({ page, flow }) => {
  const typeFilters = filterGroup(await filtersPanel(page), "Event type");
  await flow.act(
    () => typeFilters.getByText("Other", { exact: true }).click(),
    EVENTS_REQUEST,
  );
  await expect(card(page, beta.title)).toHaveCount(1);
  await expect(card(page, alpha.title), "Social 类型不该出现在 Other 筛选里").toHaveCount(0);

  const allTypeFilters = filterGroup(await filtersPanel(page), "Event type");
  const allTypes = allTypeFilters.getByRole("radio", { name: "All", exact: true });
  await allTypes.click();
  await expect(allTypes).toBeChecked();
  await expect.poll(() => new URL(page.url()).searchParams.get("type")).toBeNull();
  await expect(card(page, alpha.title)).toHaveCount(1);
  await expect(card(page, beta.title)).toHaveCount(1);
});

test("状态分段器：Active/Archived/All 三档各自成立", async ({ page, flow, api }) => {
  // 归档走的是 DELETE /api/events/:id（软归档），这里用 API 预置一个归档态。
  expect((await api.delete(`/api/events/${alpha.id}`)).ok(), "预置归档失败").toBe(true);
  await page.reload();

  await expect(card(page, alpha.title), "默认的 Active 档不该显示已归档活动").toHaveCount(0);
  await expect(card(page, beta.title)).toHaveCount(1);

  const statusFilters = filterGroup(await filtersPanel(page), "Event status");
  await flow.act(
    () => statusFilters.getByText("Archived", { exact: true }).click(),
    EVENTS_REQUEST,
  );
  await expect(card(page, alpha.title)).toHaveCount(1);
  await expect(card(page, beta.title), "未归档的活动不该出现在 Archived 档").toHaveCount(0);

  const allStatusFilters = filterGroup(await filtersPanel(page), "Event status");
  await flow.act(
    () => allStatusFilters.getByText("All", { exact: true }).click(),
    EVENTS_REQUEST,
  );
  await expect(card(page, alpha.title)).toHaveCount(1);
  await expect(card(page, beta.title)).toHaveCount(1);
});

test("置顶筛选：打开后只剩置顶活动，开关状态同步", async ({ page, flow }) => {
  const options = filterGroup(await filtersPanel(page), "Options");
  const pinned = options.getByRole("switch", { name: "Pinned only", exact: true });
  await expect(pinned).not.toBeChecked();

  await flow.act(() => pinned.click(), EVENTS_REQUEST);

  await expect(pinned, "筛选开着时开关必须自报状态，否则用户不知道列表为何变短").toBeChecked();
  await expect(card(page, alpha.title)).toHaveCount(1);
  await expect(card(page, beta.title)).toHaveCount(0);
});

test("锁定筛选：打开后只剩锁定报名的活动", async ({ page, flow }) => {
  const options = filterGroup(await filtersPanel(page), "Options");
  const locked = options.getByRole("switch", { name: "Locked only", exact: true });
  await flow.act(() => locked.click(), EVENTS_REQUEST);

  await expect(locked).toBeChecked();
  await expect(card(page, alpha.title)).toHaveCount(1);
  await expect(card(page, beta.title)).toHaveCount(0);
});

test("视图切换：卡片与月历互斥，选择写进 URL，且不重新拉数据", async ({ page }) => {
  /*
   * 换视图只是换同一份数据的呈现方式，不该再打一次服务端。
   * 这里钉死这一点：哪天有人把它改成每次切换都重新拉全量，这条用例会立刻变红。
   */
  await expectNoApiCalls(page, () => page.getByText("Month", { exact: true }).click());
  await expect(page).toHaveURL(/view=month/);
  await expect(page.locator(".event-card"), "月历视图下不该还留着卡片列表").toHaveCount(0);

  await expectNoApiCalls(page, () => page.getByText("Cards", { exact: true }).click());
  await expect(card(page, alpha.title)).toHaveCount(1);
});

test("新建按钮：进入 /events/new 并呈现路由编辑器", async ({ page }) => {
  await page.getByRole("button", { name: "Create Event", exact: true }).click();
  await expect(page).toHaveURL(/\/events\/new$/);
  const editor = page.locator(".event-editor-page");
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("button", { name: "Create Event", exact: true })).toBeDisabled();
});
