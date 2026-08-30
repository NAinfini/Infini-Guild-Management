import type { APIRequestContext, Locator, Page, Request } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test, type Flow } from "../../support/test";
import { ensureFiltersOpen, field, selectFilterOption } from "../../support/ui";

/*
 * 公告目录：筛选条（搜索 / 状态 / 重置）、置顶展示、内容预览卡与独立详情路由。
 *
 * 筛选全在服务端：改 state → 换 query key → 重新 GET /api/announcements。
 * 所以每条用例都同时钉两层——请求带对了参数，列表也真的变了。只看列表变短说明不了
 * 什么，前端在本地再过一遍同样能让列表变短，但分页总数会是错的。
 *
 * 前提一：列表是 useInfiniteQuery，staleTime 10 分钟（useAnnouncementsController.ts:186）。
 * 把条件撤回到刚取过的组合命中缓存，不再发请求，所以「撤回」方向只验结果集。
 *
 * 三条一次性公告覆盖三种状态：Alpha 已发布且置顶，Beta 草稿，Gamma 归档。
 * 每个开关都能在「留下」和「滤掉」两个方向上验证，不依赖种子数据的具体条数。
 */

const ANNOUNCEMENTS = { method: "GET", path: /^\/api\/announcements$/ } as const;

type Fixture = { id: string; title: string };

let stamp: number;
let alpha: Fixture;
let beta: Fixture;
let gamma: Fixture;

test.beforeEach(async ({ page, api }) => {
  stamp = Date.now();

  alpha = await createAnnouncement(api, `${SYSTEM_TEST_CONTENT_MARKER} Alpha ${stamp}`, {
    status: "published",
    pinned: true,
  });
  beta = await createAnnouncement(api, `${SYSTEM_TEST_CONTENT_MARKER} Beta ${stamp}`, { status: "draft" });
  gamma = await createAnnouncement(api, `${SYSTEM_TEST_CONTENT_MARKER} Gamma ${stamp}`, { status: "published" });
  /*
   * 归档走 DELETE /api/announcements/:id 而不是直接 status: "archived"：
   * 建的时候塞归档状态，archived_at 会留空（AnnouncementService.create 不写这一列），
   * 那是产品里根本产生不出来的状态，拿它当素材等于在测一个不存在的场景。
  */
  const archiveEtag = await currentAnnouncementEtag(api, gamma.id, "归档 Gamma");
  if (!archiveEtag) throw new Error("刚创建的 Gamma 公告在归档前不存在");
  await readJson(await api.delete(`/api/announcements/${gamma.id}`, {
    headers: { "If-Match": archiveEtag },
  }), `把 Gamma 预置成归档态`);

  await page.goto("/announcements");
  await expect(catalog(page)).toBeVisible();
});

test.afterEach(async ({ api }) => {
  for (const fixture of [alpha, beta, gamma]) {
    const etag = await currentAnnouncementEtag(api, fixture.id, `清理公告 ${fixture.title}`);
    if (!etag) continue;
    const response = await api.delete(`/api/announcements/${fixture.id}/permanent`, {
      headers: { "If-Match": etag },
    });
    expect([200, 204, 404], `清理公告 ${fixture.title} 返回 ${response.status()}`)
      .toContain(response.status());
  }
});

async function currentAnnouncementEtag(
  api: APIRequestContext,
  id: string,
  action: string,
): Promise<string | null> {
  const response = await api.get(`/api/announcements/${id}`);
  if (response.status() === 404) return null;
  await readJson(response, `读取 ${action} 的当前公告`);
  const etag = response.headers().etag;
  expect(etag, `${action} 前必须取得详情的当前 ETag`).toBeTruthy();
  return etag!;
}

async function createAnnouncement(
  api: APIRequestContext,
  title: string,
  options: { status: string; pinned?: boolean },
): Promise<Fixture> {
  const created = await readJson(
    await api.post("/api/announcements", {
      data: {
        title,
        /*
         * 正文里不放 stamp：搜索同时匹配标题和正文（AnnouncementService.list），
         * 正文再带一份会让「搜到几条」变成两个条件叠加，出错时分不清是哪边命中的。
         */
        body_json: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "announcement filter fixture" }] }],
        }),
        category: "announcement",
        pinned: options.pinned ?? false,
        status: options.status,
        ...(options.status === "published" ? { publish_at: new Date().toISOString() } : {}),
      },
    }),
    `创建公告 ${title}`,
  ) as { id: string };
  return { id: created.id, title };
}

function searchBox(page: Page): Locator {
  return field(page, "Search announcements");
}

function pinnedSection(page: Page): Locator {
  return page.locator(".content-pinned-section");
}

function catalog(page: Page): Locator {
  return page.locator(".announcements-catalog");
}

function pinnedItems(page: Page): Locator {
  return pinnedSection(page).locator(".content-preview-card--announcements");
}

function catalogItems(page: Page): Locator {
  return catalog(page).locator(".content-preview-card--announcements");
}

/* CSS selector list returns document order: the pinned section is emitted before the catalog. */
function items(page: Page): Locator {
  return page.locator(
    ".content-pinned-section .content-preview-card--announcements, .announcements-catalog .content-preview-card--announcements",
  );
}

/** 按标题取列表项。标题是精确文本节点，用 hasText 会把「Alpha」误伤成「Alpha 的续篇」。 */
function item(page: Page, title: string): Locator {
  return items(page).filter({ has: page.getByText(title, { exact: true }) });
}

function pinnedItem(page: Page, title: string): Locator {
  return pinnedItems(page).filter({ has: page.getByText(title, { exact: true }) });
}

function catalogItem(page: Page, title: string): Locator {
  return catalogItems(page).filter({ has: page.getByText(title, { exact: true }) });
}

function filterToolbar(page: Page): Locator {
  return page.locator(".announcements-filter-toolbar");
}

/** 记下下一次匹配本次筛选维度的公告请求，不能把并行的置顶展示请求算进来。 */
function nextListRequest(
  page: Page,
  matchesQuery: (url: URL) => boolean = () => true,
): Promise<Request> {
  return page.waitForRequest((candidate) => {
    if (candidate.method() !== "GET" || !candidate.url().includes("/api/announcements?")) return false;
    return matchesQuery(new URL(candidate.url()));
  });
}

/** 把列表筛到本用例造的三条。 */
async function searchThisRun(page: Page, flow: Flow): Promise<void> {
  await flow.act(() => searchBox(page).fill(String(stamp)), ANNOUNCEMENTS);
  await expect(items(page)).toHaveCount(3);
}

async function expectPinnedPresentation(page: Page): Promise<void> {
  const pinned = pinnedSection(page);
  const announcementCatalog = catalog(page);
  const workspaceSections = page.locator(
    ".announcements-page__workspace > .content-pinned-section, .announcements-page__workspace > .content-catalog-layout",
  );

  await expect(pinned).toBeVisible();
  await expect(pinnedItem(page, alpha.title), "Alpha 只应在置顶区出现一次").toHaveCount(1);
  await expect(pinnedItem(page, alpha.title)).toBeVisible();
  await expect(catalogItem(page, alpha.title), "置顶 Alpha 不能在目录中重复").toHaveCount(0);
  await expect(pinnedItems(page)).toHaveCount(1);
  await expect(catalogItems(page)).toHaveCount(2);
  await expect(items(page), "页面上三张卡必须各自只呈现一次").toHaveCount(3);

  await expect(workspaceSections).toHaveCount(2);
  await expect(workspaceSections.nth(0)).toHaveClass(/(?:^|\s)content-pinned-section(?:\s|$)/);
  await expect(workspaceSections.nth(1)).toHaveClass(/(?:^|\s)content-catalog-layout(?:\s|$)/);

  const [pinnedBounds, catalogBounds] = await Promise.all([
    pinned.boundingBox(),
    announcementCatalog.boundingBox(),
  ]);
  expect(pinnedBounds, "置顶分区必须有可见布局边界").not.toBeNull();
  expect(catalogBounds, "目录必须有可见布局边界").not.toBeNull();
  expect(
    pinnedBounds!.y + pinnedBounds!.height,
    "置顶分区在视觉上必须完整位于目录之前",
  ).toBeLessThanOrEqual(catalogBounds!.y);
}

test("搜索框：条件送到服务端，只留下命中的公告", async ({ page, flow }) => {
  const request = nextListRequest(page, (url) => url.searchParams.get("search") === String(stamp));
  await flow.act(() => searchBox(page).fill(String(stamp)), ANNOUNCEMENTS);

  expect(new URL((await request).url()).searchParams.get("search"), "搜索词必须原样送到服务端")
    .toBe(String(stamp));
  await expect(item(page, alpha.title)).toBeVisible();
  await expect(item(page, beta.title)).toBeVisible();
  await expect(item(page, gamma.title)).toBeVisible();
  await expect(pinnedSection(page), "筛选期间不应保留独立置顶区").toHaveCount(0);
  await expect(catalogItems(page), "匹配的置顶公告应回到筛选结果，而不是被隐藏").toHaveCount(3);

  await flow.act(() => searchBox(page).fill(`nobody-${stamp}`), ANNOUNCEMENTS);
  await expect(catalogItems(page), "搜不到时目录应当为空，而不是退回全量").toHaveCount(0);
  await expect(pinnedSection(page), "空筛选不能泄漏与条件不匹配的置顶公告").toHaveCount(0);
  await expect(items(page), "页面不应残留任何不匹配的公告").toHaveCount(0);
});

test("未筛选目录：置顶分区在目录前，Alpha 不重复", async ({ page }) => {
  await expectPinnedPresentation(page);
  await expect(
    items(page).first(),
    "页面唯一公告卡按置顶区、目录的顺序排列，Alpha 必须在最前",
  ).toContainText(alpha.title);
});

test("状态下拉：四个状态档各自成立，All 档不带 status", async ({ page, flow }) => {
  await searchThisRun(page, flow);

  const publishedRequest = nextListRequest(page, (url) => url.searchParams.get("status") === "published");
  await flow.act(
    () => selectFilterOption(page, filterToolbar(page), "Filter status", "Published"),
    ANNOUNCEMENTS,
  );
  expect(new URL((await publishedRequest).url()).searchParams.get("status")).toBe("published");
  await expect(item(page, alpha.title)).toBeVisible();
  await expect(items(page), "草稿和归档都该被滤掉").toHaveCount(1);

  const draftRequest = nextListRequest(page, (url) => url.searchParams.get("status") === "draft");
  await flow.act(
    () => selectFilterOption(page, filterToolbar(page), "Filter status", "Draft"),
    ANNOUNCEMENTS,
  );
  expect(new URL((await draftRequest).url()).searchParams.get("status")).toBe("draft");
  await expect(item(page, alpha.title), "置顶公告不能越过草稿筛选条件").toHaveCount(0);
  await expect(item(page, beta.title)).toBeVisible();
  await expect(items(page), "草稿档只能保留 Beta").toHaveCount(1);

  const archivedRequest = nextListRequest(page, (url) => url.searchParams.get("status") === "archived");
  await flow.act(
    () => selectFilterOption(page, filterToolbar(page), "Filter status", "Archived"),
    ANNOUNCEMENTS,
  );
  const archivedUrl = new URL((await archivedRequest).url());
  expect(archivedUrl.searchParams.get("status")).toBe("archived");
  await expect(item(page, alpha.title), "置顶公告不能越过归档筛选条件").toHaveCount(0);
  await expect(item(page, gamma.title)).toBeVisible();
  await expect(items(page), "归档档只能保留 Gamma").toHaveCount(1);

  // All 档回到进页面时就取过的组合，命中缓存，所以这里只验结果集和选中态。
  await selectFilterOption(page, filterToolbar(page), "Filter status", "All");
  await expect(items(page), "All 档三条都要回来").toHaveCount(3);
});

test("重置筛选：空结果时才给按钮，一次清掉搜索与状态", async ({ page, flow }) => {
  await searchThisRun(page, flow);
  await flow.act(
    () => selectFilterOption(page, filterToolbar(page), "Filter status", "Published"),
    ANNOUNCEMENTS,
  );
  await flow.act(() => searchBox(page).fill(`nobody-${stamp}`), ANNOUNCEMENTS);
  await expect(catalogItems(page), "筛空后目录不能残留卡片").toHaveCount(0);
  await expect(items(page), "筛空后页面不能残留置顶卡片").toHaveCount(0);

  await expect(
    page.getByText("No announcements match your filters", { exact: true }),
    "空结果要说明是筛出来的空，而不是一条公告都没有",
  ).toBeVisible();

  const reset = page.getByRole("button", { name: "Reset filters", exact: true });
  // 重置回的是进页面时就取过的空条件组合，同样命中缓存。
  await reset.click();

  await expect(searchBox(page), "搜索框要被一起清掉").toHaveValue("");
  await ensureFiltersOpen(filterToolbar(page));
  await expect(page.getByRole("radio", { name: "All", exact: true })).toBeChecked();
  await expect(
    item(page, beta.title),
    "重置之后要重新显示未置顶草稿，证明搜索和状态都撤了",
  ).toBeVisible();
  await expect(reset, "没有条件在生效时重置按钮该收起来").toHaveCount(0);
});

test("打开预览：进入独立详情路由", async ({ page, flow }) => {
  await searchThisRun(page, flow);

  await flow.click(item(page, beta.title), {
    method: "GET",
    path: /^\/api\/announcements\/[^/]+$/,
  });

  await expect(page.locator(".announcement-reader-title")).toHaveText(beta.title);
  await expect(page, "详情必须是可复制和刷新的独立地址")
    .toHaveURL(new RegExp(`/announcements/${beta.id}$`));
});

test("独立详情深链接：直接打开指定公告", async ({ page }) => {
  await page.goto(`/announcements/${beta.id}`);

  await expect(page.locator(".announcement-reader-title")).toHaveText(beta.title);
  await expect(page.getByRole("button", { name: "Back to announcements", exact: true })).toBeVisible();
});

test("无效详情 id：局部显示加载错误，路由本身不崩溃", async ({ page }) => {
  await page.goto("/announcements/12345");

  await expect(page.locator(".announcements-detail-page")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Something went wrong" }),
    "未找到记录不应进入全局路由错误边界",
  ).toHaveCount(0);
});
