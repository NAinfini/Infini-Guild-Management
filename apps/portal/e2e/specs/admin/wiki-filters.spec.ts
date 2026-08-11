import type { APIRequestContext, Locator, Page, Request } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test, type Flow } from "../../support/test";
import { ensureFiltersOpen, field, selectFilterOption } from "../../support/ui";

/*
 * Wiki 页顶部的筛选条：搜索、分类多选、状态分段器、置顶开关、重置。
 *
 * 这一排全是服务端筛选（改 state → 换 query key → 重新 GET /api/wiki/articles），
 * 所以每条用例都要求两件事同时成立：请求带着正确的参数发出去了，列表也真的变了。
 * 只看列表变短没有意义——前端在本地过滤同样能让列表变短，但翻页和总数会是错的，
 * 所以凡是能拿到请求 URL 的地方，这里都直接断言查询串。
 *
 * 一个必须知道的前提：列表用的是 useInfiniteQuery，staleTime 10 分钟
 * （useWikiPageController.ts:119）。把某个条件撤回到几秒前刚取过的组合时，
 * 命中的是缓存，不会再发请求。所以「撤回」方向的断言一律只验结果集，
 * 硬要求它发请求反而是把缓存当成了 bug。
 *
 * 三篇一次性文章覆盖三个维度：Alpha 置顶且在 A 分类，Beta 普通且在 B 分类，
 * Gamma 已归档。每个开关都能在「留下」和「滤掉」两个方向上被验证，不依赖种子数据。
 */

const ARTICLES = { method: "GET", path: /^\/api\/wiki\/articles$/ } as const;

type Fixture = { id: string; title: string };

let stamp: number;
let categoryA: { id: string; name: string };
let categoryB: { id: string; name: string };
let alpha: Fixture;
let beta: Fixture;
let gamma: Fixture;

test.beforeEach(async ({ page, api }) => {
  stamp = Date.now();

  categoryA = await createCategory(api, `${SYSTEM_TEST_CONTENT_MARKER} CatA ${stamp}`);
  categoryB = await createCategory(api, `${SYSTEM_TEST_CONTENT_MARKER} CatB ${stamp}`);

  alpha = await createArticle(api, `${SYSTEM_TEST_CONTENT_MARKER} Alpha ${stamp}`, categoryA.id, { pinned: true });
  beta = await createArticle(api, `${SYSTEM_TEST_CONTENT_MARKER} Beta ${stamp}`, categoryB.id);
  gamma = await createArticle(api, `${SYSTEM_TEST_CONTENT_MARKER} Gamma ${stamp}`, categoryB.id);
  await readJson(
    await api.patch(`/api/wiki/articles/${gamma.id}`, {
      data: { archived_at: new Date().toISOString() },
    }),
    "把 Gamma 预置成归档态",
  );

  await page.goto("/wiki");
  await expect(page.locator(".wiki-article-list-card")).toBeVisible();
});

async function createCategory(api: APIRequestContext, name: string): Promise<{ id: string; name: string }> {
  const created = await readJson(
    await api.post("/api/wiki/categories", { data: { name } }),
    `创建分类 ${name}`,
  ) as { id: string };
  return { id: created.id, name };
}

async function createArticle(
  api: APIRequestContext,
  title: string,
  categoryId: string,
  options: { pinned?: boolean } = {},
): Promise<Fixture> {
  const created = await readJson(
    await api.post("/api/wiki/articles", {
      data: {
        title,
        category_id: categoryId,
        /*
         * 正文不带 stamp：搜索同时匹配标题和正文（WikiService.ts:280），
         * 正文里再放一份会让「搜到几条」变成两个条件的叠加，
         * 出错时分不清是哪一边匹配上的。
         */
        body_json: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "wiki filter fixture" }] }],
        }),
        pinned: options.pinned ?? false,
      },
    }),
    `创建文章 ${title}`,
  ) as { id: string };
  return { id: created.id, title };
}

function searchBox(page: Page): Locator {
  return field(page, "Search wiki articles");
}

function items(page: Page): Locator {
  return page.locator(".wiki-article-item");
}

function item(page: Page, title: string): Locator {
  return page.getByRole("button", { name: `Open wiki article ${title}`, exact: true });
}

function filterToolbar(page: Page): Locator {
  return page.locator(".wiki-page-toolbar");
}

/** 置顶开关的无障碍名会随状态改变，所以按「当前是不是按下」取。 */
function pinnedToggle(page: Page, pressed: boolean): Locator {
  return page.getByRole("button", { name: pressed ? "Show All" : "Show Pinned", exact: true });
}

/** 记下下一次符合本次筛选维度的文章请求，避免把前一个条件的迟到请求记到当前操作。 */
function nextArticlesRequest(
  page: Page,
  matchesQuery: (url: URL) => boolean = () => true,
): Promise<Request> {
  return page.waitForRequest((candidate) => {
    if (candidate.method() !== "GET" || !candidate.url().includes("/api/wiki/articles?")) return false;
    return matchesQuery(new URL(candidate.url()));
  });
}

/** 把列表筛到本用例造的三篇。 */
async function searchThisRun(page: Page, flow: Flow): Promise<void> {
  await flow.act(() => searchBox(page).fill(String(stamp)), ARTICLES);
}

test("搜索框：条件送到服务端，只留下命中的文章", async ({ page, flow }) => {
  const request = nextArticlesRequest(page, (url) => url.searchParams.has("search"));
  await searchThisRun(page, flow);

  const url = new URL((await request).url());
  expect(url.searchParams.get("search"), "搜索词必须原样送到服务端").toBe(String(stamp));
  await expect(item(page, alpha.title)).toBeVisible();
  await expect(item(page, beta.title)).toBeVisible();
  await expect(items(page), "默认的 Active 档下归档的 Gamma 不该出现").toHaveCount(2);

  await flow.act(() => searchBox(page).fill(`nobody-${stamp}`), ARTICLES);
  await expect(items(page), "搜不到就该是空列表，而不是退回全量").toHaveCount(0);
});

test("分类多选：只留下该分类的文章，再选一个是并集", async ({ page, flow }) => {
  await searchThisRun(page, flow);
  await ensureFiltersOpen(filterToolbar(page));

  const categoryField = field(page, "Filter categories");
  const request = nextArticlesRequest(page, (url) => url.searchParams.getAll("category_id").length === 1);
  await flow.act(async () => {
    await categoryField.click();
    await page.getByRole("option", { name: categoryA.name, exact: true }).click();
  }, ARTICLES);

  const url = new URL((await request).url());
  expect(url.searchParams.getAll("category_id"), "选中的分类要按 id 送到服务端")
    .toEqual([categoryA.id]);
  await expect(item(page, alpha.title)).toBeVisible();
  await expect(items(page), "B 分类的 Beta 必须被滤掉").toHaveCount(1);

  const bothRequest = nextArticlesRequest(page, (url) => url.searchParams.getAll("category_id").length === 2);
  await ensureFiltersOpen(filterToolbar(page));
  await flow.act(async () => {
    await categoryField.click();
    await page.getByRole("option", { name: categoryB.name, exact: true }).click();
  }, ARTICLES);
  expect(
    new URL((await bothRequest).url()).searchParams.getAll("category_id").sort(),
    "多选要把两个分类都送出去，否则并集是前端拼的",
  ).toEqual([categoryA.id, categoryB.id].sort());
  await expect(items(page)).toHaveCount(2);
});

test("状态下拉：Active / Archived / All 三档各自成立", async ({ page, flow }) => {
  await searchThisRun(page, flow);
  await expect(item(page, gamma.title), "默认 Active 档不该显示归档文章").toHaveCount(0);

  const archivedRequest = nextArticlesRequest(page);
  await flow.act(
    () => selectFilterOption(page, filterToolbar(page), "Article status", "Archived"),
    ARTICLES,
  );
  expect(new URL((await archivedRequest).url()).searchParams.get("archived")).toBe("true");
  await expect(item(page, gamma.title)).toBeVisible();
  await expect(items(page), "未归档的两篇不该出现在 Archived 档").toHaveCount(1);

  const allRequest = nextArticlesRequest(page);
  await flow.act(
    () => selectFilterOption(page, filterToolbar(page), "Article status", "All"),
    ARTICLES,
  );
  expect(
    new URL((await allRequest).url()).searchParams.has("archived"),
    "All 档必须干脆不带 archived，带上任何一个值都会漏掉另一半",
  ).toBe(false);
  await expect(items(page), "All 档三篇都要在").toHaveCount(3);
});

test("置顶开关：按下只剩置顶文章，按钮状态跟着翻转", async ({ page, flow }) => {
  await searchThisRun(page, flow);
  await ensureFiltersOpen(filterToolbar(page));

  const toggle = pinnedToggle(page, false);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  const request = nextArticlesRequest(page, (url) => url.searchParams.get("pinned") === "true");
  await flow.act(() => toggle.click(), ARTICLES);
  expect(new URL((await request).url()).searchParams.get("pinned")).toBe("true");

  await expect(item(page, alpha.title)).toBeVisible();
  await expect(items(page), "没置顶的 Beta 必须被滤掉").toHaveCount(1);
  await expect(
    pinnedToggle(page, true),
    "筛选开着时按钮必须自报状态，否则用户不知道列表为何变短",
  ).toHaveAttribute("aria-pressed", "true");

  // 撤回到几秒前刚取过的组合，命中缓存，所以这里只验结果集回到两篇。
  await ensureFiltersOpen(filterToolbar(page));
  await pinnedToggle(page, true).click();
  await expect(items(page)).toHaveCount(2);
});

test("重置筛选：一次清掉四个条件，列表回到全量", async ({ page, flow }) => {
  await searchThisRun(page, flow);
  await flow.act(
    () => selectFilterOption(page, filterToolbar(page), "Article status", "All"),
    ARTICLES,
  );
  await ensureFiltersOpen(filterToolbar(page));
  await flow.act(() => pinnedToggle(page, false).click(), ARTICLES);
  await ensureFiltersOpen(filterToolbar(page));
  await flow.act(async () => {
    await field(page, "Filter categories").click();
    await page.getByRole("option", { name: categoryB.name, exact: true }).click();
  }, ARTICLES);
  await expect(items(page), "置顶的 Alpha 不属于 categoryB，四个条件叠加后应为空").toHaveCount(0);

  const reset = page.getByRole("button", { name: "Reset filters", exact: true });
  await expect(reset, "有条件在生效时才该出现重置按钮").toBeVisible();
  // 重置回的是进页面时就取过的空条件组合，同样命中缓存。
  await reset.click();

  await expect(searchBox(page), "搜索框要被一起清掉").toHaveValue("");
  await ensureFiltersOpen(filterToolbar(page));
  await expect(field(page, "Filter categories")).toHaveValue("");
  await expect(pinnedToggle(page, false)).toHaveAttribute("aria-pressed", "false");
  await expect(field(page, "Article status")).toHaveValue("Not archived");
  await expect(
    item(page, beta.title),
    "重置之后要重新显示未置顶的 B 分类文章，证明搜索、分类和置顶条件都撤了",
  ).toBeVisible();
  await expect(reset, "没有条件在生效时重置按钮该收起来").toHaveCount(0);
});
