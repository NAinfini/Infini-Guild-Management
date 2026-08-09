import type { APIRequestContext, Locator, Page, Request } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test, type Flow } from "../../support/test";
import { ensureFiltersOpen, field, selectFilterOption } from "../../support/ui";

/*
 * 公告页左栏：筛选条（搜索 / 状态分段器 / 只看置顶 / 重置）、列表选中、以及地址栏联动。
 *
 * 筛选全在服务端：改 state → 换 query key → 重新 GET /api/announcements。
 * 所以每条用例都同时钉两层——请求带对了参数，列表也真的变了。只看列表变短说明不了
 * 什么，前端在本地再过一遍同样能让列表变短，但分页总数会是错的。
 *
 * 前提一：列表是 useInfiniteQuery，staleTime 10 分钟（useAnnouncementsController.ts:186）。
 * 把条件撤回到刚取过的组合命中缓存，不再发请求，所以「撤回」方向只验结果集。
 *
 * 前提二：进页面时 selection 是 auto，控制器会自动选中第一条并把 announcementId 写进
 * 地址栏（useAnnouncementsController.ts:371）。因此任何断言 URL 的用例都得先等这次
 * 自动选中落定，否则读到的是还没写进去的空 search。
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
  await readJson(await api.delete(`/api/announcements/${gamma.id}`), `把 Gamma 预置成归档态`);

  await page.goto("/announcements");
  await expect(page.locator(".announcements-list-card")).toBeVisible();
  await expect(items(page).first(), "等自动选中落定，后面读 URL 才有意义").toHaveAttribute("aria-pressed", "true");
});

test.afterEach(async ({ api }) => {
  for (const fixture of [alpha, beta, gamma]) {
    const response = await api.delete(`/api/announcements/${fixture.id}/permanent`);
    expect([200, 204, 404], `清理公告 ${fixture.title} 返回 ${response.status()}`)
      .toContain(response.status());
  }
});

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

function items(page: Page): Locator {
  return page.locator(".announcement-item");
}

/** 按标题取列表项。标题是精确文本节点，用 hasText 会把「Alpha」误伤成「Alpha 的续篇」。 */
function item(page: Page, title: string): Locator {
  return items(page).filter({ has: page.getByText(title, { exact: true }) });
}

function filterToolbar(page: Page): Locator {
  return page.locator(".announcements-filter-toolbar");
}

function pinnedToggle(page: Page): Locator {
  return page.getByRole("button", { name: "Pinned", exact: true });
}

/** 记下下一次公告列表请求，用来断言查询串——只看列表变化验不出参数对不对。 */
function nextListRequest(page: Page): Promise<Request> {
  return page.waitForRequest((candidate) =>
    candidate.method() === "GET" && candidate.url().includes("/api/announcements?"));
}

/** 把列表筛到本用例造的三条。 */
async function searchThisRun(page: Page, flow: Flow): Promise<void> {
  await flow.act(() => searchBox(page).fill(String(stamp)), ANNOUNCEMENTS);
  await expect(items(page)).toHaveCount(3);
}

test("搜索框：条件送到服务端，只留下命中的公告", async ({ page, flow }) => {
  const request = nextListRequest(page);
  await flow.act(() => searchBox(page).fill(String(stamp)), ANNOUNCEMENTS);

  expect(new URL((await request).url()).searchParams.get("search"), "搜索词必须原样送到服务端")
    .toBe(String(stamp));
  await expect(item(page, alpha.title)).toBeVisible();
  await expect(item(page, beta.title)).toBeVisible();
  await expect(item(page, gamma.title)).toBeVisible();
  await expect(items(page), "默认不带状态条件，三种状态都该在").toHaveCount(3);

  await flow.act(() => searchBox(page).fill(`nobody-${stamp}`), ANNOUNCEMENTS);
  await expect(items(page), "搜不到就该是空列表，而不是退回全量").toHaveCount(0);
});

test("置顶排在最前：置顶的 Alpha 要压在同批公告上面", async ({ page, flow }) => {
  await searchThisRun(page, flow);
  await expect(
    items(page).first(),
    "服务端按 pinned desc 排，前端再排一次，两处一致才谈得上稳定顺序",
  ).toContainText(alpha.title);
});

test("状态下拉：四个状态档各自成立，All 档不带 status", async ({ page, flow }) => {
  await searchThisRun(page, flow);

  const publishedRequest = nextListRequest(page);
  await flow.act(
    () => selectFilterOption(page, filterToolbar(page), "Filter status", "Published"),
    ANNOUNCEMENTS,
  );
  expect(new URL((await publishedRequest).url()).searchParams.get("status")).toBe("published");
  await expect(item(page, alpha.title)).toBeVisible();
  await expect(items(page), "草稿和归档都该被滤掉").toHaveCount(1);

  const draftRequest = nextListRequest(page);
  await flow.act(
    () => selectFilterOption(page, filterToolbar(page), "Filter status", "Draft"),
    ANNOUNCEMENTS,
  );
  expect(new URL((await draftRequest).url()).searchParams.get("status")).toBe("draft");
  await expect(item(page, beta.title)).toBeVisible();
  await expect(items(page)).toHaveCount(1);

  const archivedRequest = nextListRequest(page);
  await flow.act(
    () => selectFilterOption(page, filterToolbar(page), "Filter status", "Archived"),
    ANNOUNCEMENTS,
  );
  const archivedUrl = new URL((await archivedRequest).url());
  expect(archivedUrl.searchParams.get("status")).toBe("archived");
  expect(archivedUrl.searchParams.get("archived"), "归档档要一并把 archived 打开，否则非管理员看不到这一档")
    .toBe("true");
  await expect(item(page, gamma.title)).toBeVisible();
  await expect(items(page)).toHaveCount(1);

  // All 档回到进页面时就取过的组合，命中缓存，所以这里只验结果集和选中态。
  await selectFilterOption(page, filterToolbar(page), "Filter status", "All");
  await expect(items(page), "All 档三条都要回来").toHaveCount(3);
});

test("只看置顶：参数送出去，列表只剩置顶的一条，按钮自报状态", async ({ page, flow }) => {
  await searchThisRun(page, flow);
  await ensureFiltersOpen(filterToolbar(page));

  const toggle = pinnedToggle(page);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  const request = nextListRequest(page);
  await flow.act(() => toggle.click(), ANNOUNCEMENTS);
  expect(new URL((await request).url()).searchParams.get("pinned")).toBe("true");

  await expect(item(page, alpha.title)).toBeVisible();
  await expect(items(page), "没置顶的两条必须被滤掉").toHaveCount(1);
  await expect(
    toggle,
    "筛选开着时按钮必须自报状态，否则用户不知道列表为何变短",
  ).toHaveAttribute("aria-pressed", "true");

  // 撤回到刚取过的组合，命中缓存，只验结果集回到三条。
  await ensureFiltersOpen(filterToolbar(page));
  await toggle.click();
  await expect(items(page)).toHaveCount(3);
});

test("重置筛选：空结果时才给按钮，一次清掉三个条件", async ({ page, flow }) => {
  await searchThisRun(page, flow);
  await flow.act(
    () => selectFilterOption(page, filterToolbar(page), "Filter status", "Published"),
    ANNOUNCEMENTS,
  );
  await ensureFiltersOpen(filterToolbar(page));
  await flow.act(() => pinnedToggle(page).click(), ANNOUNCEMENTS);
  await flow.act(() => searchBox(page).fill(`nobody-${stamp}`), ANNOUNCEMENTS);
  await expect(items(page)).toHaveCount(0);

  await expect(
    page.getByText("No announcements match your filters", { exact: true }),
    "空结果要说明是筛出来的空，而不是一条公告都没有",
  ).toBeVisible();

  const reset = page.getByRole("button", { name: "Reset filters", exact: true });
  // 重置回的是进页面时就取过的空条件组合，同样命中缓存。
  await reset.click();

  await expect(searchBox(page), "搜索框要被一起清掉").toHaveValue("");
  await ensureFiltersOpen(filterToolbar(page));
  await expect(pinnedToggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(field(page, "Filter status")).toHaveValue("All");
  await expect(
    item(page, "Welcome to Infini Guild"),
    "重置之后要看得到本用例之外的公告，说明筛选真的撤了",
  ).toBeVisible();
  await expect(reset, "没有条件在生效时重置按钮该收起来").toHaveCount(0);
});

test("列表选中：点一条就换详情，announcementId 同步进地址栏", async ({ page, flow }) => {
  await searchThisRun(page, flow);

  await flow.click(item(page, beta.title), {
    method: "GET",
    path: /^\/api\/announcements\/[^/]+$/,
  });

  await expect(item(page, beta.title), "选中的那条要自报状态").toHaveAttribute("aria-pressed", "true");
  await expect(item(page, alpha.title)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".announcement-reader-title")).toHaveText(beta.title);
  /* 收尾用 (?:&|$) 而不是 \b：nanoid 允许以 - 或 _ 结尾，那时候 \b 根本不成立。 */
  await expect(page, "选中态要能被复制成链接，刷新回来还是这一条")
    .toHaveURL(new RegExp(`announcementId=${beta.id}(?:&|$)`));
});

test("深链接 ?announcementId=：直接进来就落在这一条上", async ({ page }) => {
  await page.goto(`/announcements?announcementId=${beta.id}`);

  await expect(page.locator(".announcement-reader-title")).toHaveText(beta.title);
  await expect(item(page, beta.title)).toHaveAttribute("aria-pressed", "true");
});

test("深链接 ?announcementId= 是纯数字：查不到就报查不到，不能把整条路由打崩", async ({ page }) => {
  /*
   * TanStack 解析搜索参数时会先拿 JSON.parse 试一遍，纯数字的 announcementId 到
   * validateSearch 里已经是 number 了。schema 若写死 z.string()，手改一次地址栏
   * 就整页进错误边界——公告 id 本身是 nanoid，但地址栏是用户能随便改的入口。
   */
  await page.goto("/announcements?announcementId=12345");

  /*
   * 先等列表出来再查错误边界。反过来写的话，toHaveCount(0) 在页面还没渲染完时
   * 一次就通过了，错误边界随后才冒出来——这条断言会变成永远绿的摆设。
   */
  await expect(page.locator(".announcements-list-card"), "列表要照常渲染").toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Something went wrong" }),
    "路由不该因为参数类型被 JSON.parse 变了形就整页崩掉",
  ).toHaveCount(0);
});
