import type { APIRequestContext, Locator, Page, Request } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test, type Flow } from "../../support/test";
import { webpUpload } from "../../support/files";
import {
  clearButton,
  ensureFiltersOpen,
  field,
  selectOption,
  selectSegmentedControlOption,
} from "../../support/ui";

/*
 * 画廊页顶部的筛选条：搜索、类型下拉、新旧分段器、起止日期、清除日期、重置。
 *
 * 这一排全是服务端筛选（改 state → 换 query key → 重新 GET /api/gallery），
 * 所以每条用例都要求两件事同时成立：参数带对了发出去，结果集也真的变了。
 * 只看条目数变少没有意义——前端本地过滤同样能让它变少，但翻页和排序会是错的。
 *
 * 两个必须知道的前提：
 *   1. 列表是 useInfiniteQuery，staleTime 5 分钟（useGalleryPageController.ts:154）。
 *      把条件撤回到几秒前刚取过的组合时命中缓存，不会再发请求；
 *      所以「撤回」方向一律只验结果集，硬要求它发请求就是把缓存当成 bug。
 *   2. 进页面时种子有 28 条、每页 20 条，页尾那个 IntersectionObserver
 *      （GalleryPage.tsx:21）会自动去取第二页。所以每条用例都先用 stamp 搜到
 *      只剩自己造的三条——此时 next_cursor 为空，后续不再有翻页请求；
 *      nextGalleryRequest 也据此把带 cursor 的请求排除掉，免得等到的是翻页而不是筛选。
 *
 * 三件一次性素材覆盖两个维度：alpha / beta 是视频、gamma 是真上传的图片，
 * 且按这个顺序创建（created_at 精确到毫秒），所以排序方向能被稳定断言。
 */

const GALLERY = { method: "GET", path: /^\/api\/gallery$/ } as const;

type Fixture = { id: string; caption: string };

let stamp: number;
let alpha: Fixture;
let beta: Fixture;
let gamma: Fixture;

test.beforeEach(async ({ page, api }) => {
  stamp = Date.now();

  alpha = await createVideo(api, `${SYSTEM_TEST_CONTENT_MARKER} Alpha ${stamp}`, `https://youtu.be/e2e-alpha-${stamp}`);
  beta = await createVideo(api, `${SYSTEM_TEST_CONTENT_MARKER} Beta ${stamp}`, `https://youtu.be/e2e-beta-${stamp}`);
  gamma = await uploadImage(api, `${SYSTEM_TEST_CONTENT_MARKER} Gamma ${stamp}`);

  await page.goto("/gallery");
  await expect(page.getByRole("list", { name: "Gallery items" })).toBeVisible();
});

test.afterEach(async ({ api }) => {
  for (const fixture of [alpha, beta, gamma]) {
    const response = await api.delete(`/api/gallery/${fixture.id}`);
    expect([200, 204, 404], `清理 ${fixture.caption} 返回 ${response.status()}`)
      .toContain(response.status());
  }
});

async function createVideo(api: APIRequestContext, caption: string, url: string): Promise<Fixture> {
  const created = await readJson(
    await api.post("/api/gallery/videos", { data: { type: "video", url, caption } }),
    `创建视频 ${caption}`,
  ) as { id: string };
  return { id: created.id, caption };
}

/*
 * 图片素材走真正的上传接口，而不是直接往库里塞一行：
 * 类型筛选要能在「留下」和「滤掉」两个方向上被验证，就得有一条真图片，
 * 而 R2 对象和 gallery 行是一起建、一起删的，绕开接口造出来的行清理时会留下孤儿对象。
 */
async function uploadImage(api: APIRequestContext, caption: string): Promise<Fixture> {
  const uploaded = await readJson(
    await api.post("/api/gallery/images", {
      multipart: { files: webpUpload(`gallery-filters-${stamp}.webp`), captions: caption },
    }),
    `上传图片 ${caption}`,
  ) as { data: Array<{ id: string }> };
  const id = uploaded.data[0]?.id;
  expect(id, "上传接口必须回一条图片记录").toBeTruthy();
  return { id: id as string, caption };
}

function searchBox(page: Page): Locator {
  return field(page, "Search gallery caption or uploader");
}

function items(page: Page): Locator {
  return page.locator(".gallery-grid__item");
}

function itemByCaption(page: Page, caption: string): Locator {
  return items(page).filter({ hasText: caption });
}

/** 卡片脚注里的第一行就是说明文字，按 DOM 顺序读出来即是当前排序。 */
function captions(page: Page): Locator {
  return page.locator(".gallery-grid__item .gallery-card__meta > *:first-child");
}

function filterToolbar(page: Page): Locator {
  return page.locator(".gallery-filters");
}

function dateFrom(page: Page): Locator {
  return field(page, "Gallery date from");
}

function dateTo(page: Page): Locator {
  return field(page, "Gallery date to");
}

function selectCheckbox(page: Page, id: string): Locator {
  return page.getByRole("checkbox", { name: `Select gallery item ${id}`, exact: true });
}

/**
 * 等下一次「换条件」的列表请求。
 * 带 cursor 的是翻页，不是筛选——不排掉的话等到的可能是上一次条件的第二页，
 * 断言查询串时就会莫名其妙地对不上。
 */
function nextGalleryRequest(page: Page): Promise<Request> {
  return page.waitForRequest((candidate) => {
    if (candidate.method() !== "GET") return false;
    const url = new URL(candidate.url());
    return url.pathname === "/api/gallery" && !url.searchParams.has("cursor");
  });
}

/** 服务端按 UTC 的整天边界解释 date_from / date_to（gallery.ts:33），所以这里也按 UTC 算。 */
function dayOffset(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** 把列表筛到本用例造的三件。 */
async function searchThisRun(page: Page, flow: Flow): Promise<void> {
  await flow.act(() => searchBox(page).fill(String(stamp)), GALLERY);
  await expect(items(page), "搜索之后应当只剩本用例造的三件").toHaveCount(3);
}

test("搜索框：条件按归一化后的形态送到服务端，只留下命中的条目", async ({ page, flow }) => {
  const request = nextGalleryRequest(page);
  /* 故意带大写和前后空格：控件会 trim + toLowerCase 之后再发（useGalleryPageController.ts:108）。 */
  await flow.act(() => searchBox(page).fill(`  Alpha ${stamp}  `), GALLERY);

  expect(
    new URL((await request).url()).searchParams.get("search"),
    "搜索词要按归一化后的形态送出去，否则服务端的 LIKE 比对会漏掉大小写不同的说明",
  ).toBe(`alpha ${stamp}`);
  await expect(itemByCaption(page, alpha.caption)).toBeVisible();
  await expect(items(page), "另外两件说明里没有 Alpha，必须被滤掉").toHaveCount(1);

  await flow.act(() => searchBox(page).fill(`nobody-${stamp}`), GALLERY);
  await expect(items(page), "搜不到就该是空列表，而不是退回全量").toHaveCount(0);
  await expect(page.getByText("No media matches your filters.")).toBeVisible();
});

test("类型下拉：只留下该类型，清除按钮把条件撤回", async ({ page, flow }) => {
  await searchThisRun(page, flow);
  await ensureFiltersOpen(filterToolbar(page));

  const request = nextGalleryRequest(page);
  await flow.act(() => selectOption(page, "Filter gallery by type", "Video"), GALLERY);

  expect(new URL((await request).url()).searchParams.get("type")).toBe("video");
  await expect(items(page)).toHaveCount(2);
  await expect(itemByCaption(page, gamma.caption), "图片必须被滤掉").toHaveCount(0);

  // 撤回到刚取过的「只有搜索词」组合，命中缓存，所以这里只验结果集。
  await ensureFiltersOpen(filterToolbar(page));
  await clearButton(page, "Filter gallery by type").click();
  await expect(field(page, "Filter gallery by type"), "清除按钮要把下拉一起清空").toHaveValue("");
  await expect(items(page)).toHaveCount(3);
});

test("新旧分段器：order 送到服务端，卡片顺序跟着整个翻过来", async ({ page, flow }) => {
  await searchThisRun(page, flow);
  await expect(captions(page), "默认按创建时间倒序，最后造的排最前")
    .toHaveText([gamma.caption, beta.caption, alpha.caption]);

  await ensureFiltersOpen(filterToolbar(page));
  const request = nextGalleryRequest(page);
  await flow.act(() => selectSegmentedControlOption(page, "Oldest"), GALLERY);

  expect(new URL((await request).url()).searchParams.get("order")).toBe("asc");
  await expect(captions(page), "顺序必须由服务端给出，前端不该自己倒一遍")
    .toHaveText([alpha.caption, beta.caption, gamma.caption]);
});

test("起止日期：两个条件分别送到服务端，清除按钮一次清掉两个", async ({ page, flow }) => {
  await searchThisRun(page, flow);
  await ensureFiltersOpen(filterToolbar(page));

  const clearDates = page.getByRole("button", { name: "Clear dates", exact: true });
  await expect(clearDates, "一个日期都没设时不该能点").toBeDisabled();

  const fromRequest = nextGalleryRequest(page);
  await flow.act(() => dateFrom(page).fill(dayOffset(0)), GALLERY);
  expect(new URL((await fromRequest).url()).searchParams.get("date_from")).toBe(dayOffset(0));
  await expect(items(page), "三件都是刚造的，起点定在今天不该滤掉任何一件").toHaveCount(3);

  await ensureFiltersOpen(filterToolbar(page));
  const toRequest = nextGalleryRequest(page);
  await flow.act(() => dateTo(page).fill(dayOffset(-1)), GALLERY);
  expect(new URL((await toRequest).url()).searchParams.get("date_to")).toBe(dayOffset(-1));
  await expect(items(page), "截止到昨天，今天造的三件都该被滤掉").toHaveCount(0);

  await ensureFiltersOpen(filterToolbar(page));
  await expect(clearDates, "设了日期之后清除按钮才该亮起来").toBeEnabled();
  await clearDates.click();
  await expect(dateFrom(page)).toHaveValue("");
  await expect(dateTo(page), "只清掉一个的话用户会以为筛选还在生效").toHaveValue("");
  await expect(items(page)).toHaveCount(3);
});

test("重置筛选：一次清掉搜索、类型和两个日期，列表回到全量", async ({ page, flow }) => {
  await searchThisRun(page, flow);
  await ensureFiltersOpen(filterToolbar(page));
  await flow.act(() => selectOption(page, "Filter gallery by type", "Video"), GALLERY);
  await ensureFiltersOpen(filterToolbar(page));
  await flow.act(() => dateFrom(page).fill(dayOffset(1)), GALLERY);
  await expect(items(page), "起点定在明天，结果集应当是空的").toHaveCount(0);

  const reset = page.getByRole("button", { name: "Reset filters", exact: true });
  await expect(reset, "有条件在生效且结果为空时才该出现重置入口").toBeVisible();
  // 重置回的是进页面时就取过的空条件组合，同样命中缓存。
  await reset.click();

  await expect(searchBox(page)).toHaveValue("");
  await expect(field(page, "Filter gallery by type")).toHaveValue("");
  await expect(dateFrom(page)).toHaveValue("");
  await expect(dateTo(page)).toHaveValue("");
  /*
   * 认种子说明的形状，不认具体某一条：28 条种子数据是一次 batchInsert 建的，
   * created_at 可能落在同一毫秒，此时排序由 id 兜底，哪 20 条落在第一页是随机的。
   */
  await expect(
    captions(page).filter({ hasText: /^Seed (image|video) \d+$/ }).first(),
    "重置之后应当能看到本用例之外的条目，说明筛选真的撤了",
  ).toBeVisible();
});

test("换筛选条件：已勾选的条目必须跟着清掉", async ({ page, flow }) => {
  await searchThisRun(page, flow);

  const bulkDelete = page.getByRole("button", { name: "Delete Selected", exact: true });
  await expect(bulkDelete, "没选任何条目时批量删除该是灰的").toBeDisabled();

  await selectCheckbox(page, alpha.id).check();
  await expect(bulkDelete, "选中一条之后批量删除才该可用").toBeEnabled();

  await ensureFiltersOpen(filterToolbar(page));
  await flow.act(() => selectSegmentedControlOption(page, "Oldest"), GALLERY);

  await expect(selectCheckbox(page, alpha.id), "换了结果集，旧的勾选不能留着").not.toBeChecked();
  await expect(
    bulkDelete,
    "勾选如果跨结果集残留，用户会在自己看不见的条目上执行批量删除",
  ).toBeDisabled();
});
