import type { APIRequestContext, Locator, Page, Request } from "@playwright/test";
import { profileMutationHeaders } from "../../support/api";
import { createThrowawayMember, expectMemberListPage, uniqueTag } from "../../support/members";
import { expect, readJson, test } from "../../support/test";
import { ensureFiltersOpen, expectNoDialog, topDialog } from "../../support/ui";

/*
 * 名册页的全部控件：搜索、职业多选、排序单选、分页、空态重置、
 * 音频偏好（静音 + 音量）、成员卡片与资料弹窗。
 *
 * 服务端拥有完整结果集、排序与分页。新条件只取当前 24 人页，已命中的
 * 查询由缓存恢复；音频等本地偏好不取名单。界面结果与真实响应和专属夹具
 * 同时比对，避免仅验证请求成功，或用整份目录请求掩盖分页错误。
 */

const USERS_LIST = "/api/users";
const ROSTER_FILTERS_KEY = "roster.filters";
const ROSTER_PAGE_SIZE = 24;

type RosterRow = {
  user: { id: string; display_name: string };
  profile: { power: number; classes: string[] };
};

let createdUserIds: string[] = [];

test.beforeEach(async () => {
  createdUserIds = [];
});

test.afterEach(async ({ api }) => {
  if (createdUserIds.length === 0) return;
  /*
   * 软删除，不是清理的全部：run 结束时 SystemTestService.deleteRegisteredUsers
   * 会按 id 把这些账号硬删掉（软删过也照删）。这里软删只是让它们在本轮剩下的
   * 用例里从 /api/users 消失，免得污染别的 spec 的计数断言。
   */
  const response = await api.patch("/api/admin/users/batch/delete", {
    data: { user_ids: createdUserIds },
  });
  expect(response.ok(), `软删除临时成员返回 ${response.status()}: ${await response.text()}`).toBe(true);
  createdUserIds = [];
});

async function expectRosterPage(
  page: Page,
  action: () => Promise<unknown>,
  query: Record<string, string | null> = {},
) {
  const result = await expectMemberListPage(page, {
    page: "1", limit: String(ROSTER_PAGE_SIZE), search_scope: "name", sort: "power", direction: "desc",
    ...query,
  }, action);
  await expect(cardNames(page)).toHaveText(result.data.map((row) => row.user.display_name));
  await expect.poll(() => readCount(page)).toEqual({ visible: result.data.length, total: result.total });
  return result;
}

async function openRoster(page: Page, query: Record<string, string | null> = {}): Promise<void> {
  await expectRosterPage(page, () => page.goto("/roster"), query);
  await expect(page.getByRole("list", { name: "Roster member grid" })).toBeVisible();
}

/** 服务端眼里的名册。期望值全部由它现算。 */
async function fetchRoster(api: APIRequestContext): Promise<RosterRow[]> {
  const body = await readJson(await api.get("/api/users?page=1&limit=500"), "读取名册") as { data: RosterRow[] };
  expect(body.data.length, "fresh fixture 至少应包含当前管理员和共享成员").toBeGreaterThan(0);
  return body.data;
}

async function createRosterMember(api: APIRequestContext, tag: string): Promise<{ id: string; display_name: string }> {
  const member = await createThrowawayMember(api, tag);
  createdUserIds.push(member.id);
  return member;
}

async function updateRosterProfile(
  api: APIRequestContext,
  userId: string,
  data: { power?: number; classes?: string[] },
): Promise<void> {
  const response = await api.patch(`/api/users/${userId}/profile`, {
    headers: await profileMutationHeaders(api, userId),
    data,
  });
  expect(response.ok(), `预置名册资料返回 ${response.status()}: ${await response.text()}`).toBe(true);
}

async function createRosterClass(api: APIRequestContext, tag: string): Promise<{ id: string; label: string }> {
  const label = `E2E Roster ${tag}`;
  return await readJson(
    await api.post("/api/classes", {
      data: { label, color: "#8594A8", vector_icon: "shield", sort_order: 900 },
    }),
    `创建名册职业 ${label}`,
  ) as { id: string; label: string };
}

function cards(page: Page): Locator {
  return page.locator(".roster-card-cell");
}

function cardNames(page: Page): Locator {
  return page.locator(".roster-card-cell .member-card__username");
}

function searchBox(page: Page): Locator {
  return page.getByRole("textbox", { name: "Search by display name", exact: true });
}

function filterToolbar(page: Page): Locator {
  return page.locator(".roster-filter-card");
}

function classFilterOption(page: Page, label: string): Locator {
  return page
    .getByRole("group", { name: "Filter roster by class", exact: true })
    .getByRole("checkbox", { name: label, exact: true });
}

function sortOption(page: Page, label: string): Locator {
  return page
    .getByRole("radiogroup", { name: "Sort roster", exact: true })
    .getByRole("radio", { name: label, exact: true });
}

/** 读「Showing 可见/总数」。读不成数字就直接失败——静默当 0 会让断言变成摆设。 */
async function readCount(page: Page): Promise<{ visible: number; total: number }> {
  const raw = (await page.locator(".roster-count-text").innerText()).trim();
  const matched = /^Showing (\d+)\/(\d+)$/.exec(raw);
  expect(matched, `计数文案对不上：${JSON.stringify(raw)}`).not.toBeNull();
  return { visible: Number(matched![1]), total: Number(matched![2]) };
}

/**
 * 缓存恢复与音频偏好不取名单；同时重置防抖搜索和即时职业条件时，最多
 * 读取一页。媒体读取不算名单请求，任何写操作仍然都是错误。
 */
async function expectRosterReadBudget(
  page: Page,
  action: () => Promise<void>,
  maxListRequests = 0,
): Promise<void> {
  const reads: URL[] = [];
  const writes: string[] = [];
  const record = (request: Request): void => {
    const url = new URL(request.url());
    if (url.pathname === USERS_LIST) reads.push(url);
    if (request.method() !== "GET" && url.pathname.startsWith("/api/")) writes.push(`${request.method()} ${url.pathname}`);
  };
  page.on("request", record);
  try {
    await action();
    await page.waitForTimeout(700);
  } finally {
    page.off("request", record);
  }
  expect(writes, "名册浏览与本地偏好不应写库").toEqual([]);
  expect(reads.length, "超出这次交互的当前页请求预算").toBeLessThanOrEqual(maxListRequests);
  for (const url of reads) {
    expect(url.searchParams.get("limit")).toBe(String(ROSTER_PAGE_SIZE));
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("search_scope")).toBe("name");
    expect(url.searchParams.get("include_total")).toBe("true");
  }
}

async function readStoredFilters(page: Page): Promise<{ classFilter?: unknown; sortMode?: unknown }> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), ROSTER_FILTERS_KEY);
  expect(raw, "改过筛选之后 roster.filters 必须落盘").not.toBeNull();
  return JSON.parse(raw as string) as { classFilter?: unknown; sortMode?: unknown };
}

test("搜索框：按用户名过滤，先 trim 再忽略大小写，每个新条件只请求当前页", async ({ page, api }) => {
  const tag = uniqueTag("search");
  await createRosterMember(api, tag);
  await createRosterMember(api, tag);
  await openRoster(page);
  const roster = await fetchRoster(api);
  const expectedMatches = roster
    .map((row) => row.user.display_name)
    .filter((display_name) => display_name.toLowerCase().includes(tag.toLowerCase()))
    .sort();
  expect(expectedMatches.length, "本用例创建的两个成员必须可检索").toBe(2);

  /* 名册只搜索显示名，ASCII 大小写在客户端和 SQLite 两端一致。 */
  await expectRosterPage(page, () => searchBox(page).fill(tag.toUpperCase()), { search: tag.toLowerCase() });
  await expect(cards(page)).toHaveCount(expectedMatches.length);
  expect(
    (await cardNames(page).allInnerTexts()).map((name) => name.trim()).sort(),
    "大小写不同就漏人的话，搜索基本等于不能用",
  ).toEqual(expectedMatches);
  expect(await readCount(page), "计数要跟着筛选后的结果集走")
    .toEqual({ visible: expectedMatches.length, total: expectedMatches.length });

  const single = expectedMatches[0]!;
  await expectRosterPage(page, () => searchBox(page).fill(`  ${single}  `), { search: single.toLowerCase() });
  await expect(cards(page)).toHaveCount(1);
  await expect(cardNames(page), "前后空格没 trim 掉的话这里会一个都搜不到").toHaveText([single]);

  await expectRosterPage(page, () => searchBox(page).fill("nobody-should-match-this"), {
    search: "nobody-should-match-this",
  });
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByText("No members match your filters")).toBeVisible();
});

test("职业多选：结果集与服务端数据一致，条件写进 localStorage 并在刷新后恢复", async ({ page, api }) => {
  const tag = uniqueTag("classes");
  const firstClass = await createRosterClass(api, `${tag}_a`);
  const secondClass = await createRosterClass(api, `${tag}_b`);
  const first = await createRosterMember(api, tag);
  const second = await createRosterMember(api, tag);
  const both = await createRosterMember(api, tag);
  const outsider = await createRosterMember(api, tag);
  await updateRosterProfile(api, first.id, { classes: [firstClass.id] });
  await updateRosterProfile(api, second.id, { classes: [secondClass.id] });
  await updateRosterProfile(api, both.id, { classes: [firstClass.id, secondClass.id] });
  await openRoster(page);
  await expectRosterPage(page, () => searchBox(page).fill(tag), { search: tag });
  await ensureFiltersOpen(filterToolbar(page));
  const single = await expectRosterPage(page, () => classFilterOption(page, firstClass.label).click(), {
    search: tag, classes: JSON.stringify([firstClass.id]),
  });
  expect(new Set(single.data.map((row) => row.user.id))).toEqual(new Set([first.id, both.id]));

  const classIds = [firstClass.id, secondClass.id];
  const classes = JSON.stringify([...classIds].sort());
  const union = await expectRosterPage(page, () => classFilterOption(page, secondClass.label).click(), {
    search: tag, classes,
  });
  expect(new Set(union.data.map((row) => row.user.id)), "多职业是 OR，同属两类的成员只出现一次")
    .toEqual(new Set([first.id, second.id, both.id]));
  expect(union.total).toBe(3);
  await expect(
    cardNames(page).filter({ hasText: outsider.display_name }),
    "不属于该职业的成员必须被滤掉",
  ).toHaveCount(0);

  expect((await readStoredFilters(page)).classFilter, "职业条件要落盘，否则刷新就白选了").toEqual(classIds);

  await openRoster(page, { classes });
  await ensureFiltersOpen(filterToolbar(page));
  await expect(classFilterOption(page, firstClass.label), "刷新后控件上要还勾着这个职业").toBeChecked();
  await expect(classFilterOption(page, secondClass.label)).toBeChecked();
  await expect(cards(page), "刷新后结果集也要跟着恢复").toHaveCount(3);
});

test("排序选项：换一套排序依据真的重排卡片，选择被持久化", async ({ page, api }) => {
  const tag = uniqueTag("sort");
  const alphaClass = await createRosterClass(api, `${tag}_alpha`);
  const omegaClass = await createRosterClass(api, `${tag}_omega`);
  const low = await createRosterMember(api, `${tag}_a`);
  const high = await createRosterMember(api, `${tag}_b`);
  await updateRosterProfile(api, low.id, { power: 10, classes: [omegaClass.id] });
  await updateRosterProfile(api, high.id, { power: 20, classes: [alphaClass.id] });
  await openRoster(page);
  /* 只排序本用例创建的两个人，避免分页切片掺进其他 spec 的临时成员。 */
  await expectRosterPage(page, () => searchBox(page).fill(tag), { search: tag });
  await expect(cards(page), "排序样本必须恰好是本用例创建的两名成员").toHaveCount(2);
  const roster = await fetchRoster(api);
  const powerOf = new Map(roster.map((row) => [row.user.display_name, row.profile.power]));

  const defaultOrder = (await cardNames(page).allInnerTexts()).map((name) => name.trim());
  const powers = defaultOrder.map((name) => powerOf.get(name));
  expect(powers.every((value) => typeof value === "number"), "卡片上的用户名要能在服务端数据里找到").toBe(true);
  expect(
    (powers as number[]).every((value, index) => index === 0 || (powers[index - 1] as number) >= value),
    "默认是战力倒序，出现回升就说明排序没生效",
  ).toBe(true);

  await ensureFiltersOpen(filterToolbar(page));
  await expectRosterPage(page, () => sortOption(page, "Display name (A-Z)").click(), {
    search: tag, sort: "display_name", direction: "asc",
  });
  await expect(sortOption(page, "Display name (A-Z)")).toBeChecked();
  const byUsername = (await cardNames(page).allInnerTexts()).map((name) => name.trim());
  expect(
    byUsername.every((name, index) => index === 0 || byUsername[index - 1]!.localeCompare(name) <= 0),
    "选了按用户名升序，顺序就必须真的是升序",
  ).toBe(true);
  expect(byUsername, "换了排序依据，顺序就该真的不一样").not.toEqual(defaultOrder);
  expect(new Set(byUsername), "换排序不该把人换掉，只该换顺序").toEqual(new Set(defaultOrder));

  await expectRosterPage(page, () => sortOption(page, "Class").click(), {
    search: tag, sort: "class", direction: "asc",
  });
  await expect(sortOption(page, "Class")).toBeChecked();
  expect(
    (await cardNames(page).allInnerTexts()).map((name) => name.trim()),
    "按职业排序必须使用目录标签；alpha 职业应排在 omega 职业之前",
  ).toEqual([high.display_name, low.display_name]);

  expect((await readStoredFilters(page)).sortMode, "排序选择要落盘").toBe("class");
  await openRoster(page, { sort: "class", direction: "asc" });
  await ensureFiltersOpen(filterToolbar(page));
  await expect(sortOption(page, "Class"), "刷新后排序要还停在上次的选择").toBeChecked();
});

test("分页：专属 25 人按每页 24 人读取，翻页无遗漏，返回已加载页使用缓存", async ({ page, api }) => {
  const tag = uniqueTag("page");
  for (let count = 0; count < ROSTER_PAGE_SIZE + 1; count += 1) {
    await createRosterMember(api, tag);
  }

  await openRoster(page);
  const expectedMembers = (await fetchRoster(api))
    .filter((row) => row.user.display_name.toLowerCase().includes(tag.toLowerCase()));
  expect(expectedMembers, "专属搜索结果必须正好有 25 人").toHaveLength(ROSTER_PAGE_SIZE + 1);

  const firstPage = await expectRosterPage(page, () => searchBox(page).fill(tag), { search: tag });
  await expect(cards(page)).toHaveCount(ROSTER_PAGE_SIZE);
  expect(await readCount(page)).toEqual({ visible: ROSTER_PAGE_SIZE, total: expectedMembers.length });

  const pagination = page.getByRole("navigation", { name: "Page", exact: true });
  await expect(pagination.getByRole("button", { name: "Go to page 1", exact: true }))
    .toHaveAttribute("aria-current", "page");
  const secondPage = await expectRosterPage(page, () => pagination.getByRole("button", {
    name: "Go to page 2", exact: true,
  }).click(), { search: tag, page: "2" });
  await expect(cards(page)).toHaveCount(1);
  const pageIds = [...firstPage.data, ...secondPage.data].map((row) => row.user.id);
  expect(pageIds).toHaveLength(25);
  expect(new Set(pageIds), "两页合起来必须包含全部专属成员，不能重复或漏人")
    .toEqual(new Set(expectedMembers.map((row) => row.user.id)));
  expect(await readCount(page)).toEqual({ visible: 1, total: expectedMembers.length });
  await expect(pagination.getByRole("button", { name: "Go to page 2", exact: true }))
    .toHaveAttribute("aria-current", "page");
  await expect(pagination.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();

  await expectRosterReadBudget(page, async () => {
    await pagination.getByRole("button", { name: "Previous page", exact: true }).click();
    await expect(cardNames(page)).toHaveText(firstPage.data.map((row) => row.user.display_name));
  });
  expect(await readCount(page)).toEqual({ visible: ROSTER_PAGE_SIZE, total: expectedMembers.length });
});

test("空态的重置筛选：一次清掉搜索与职业，列表回到第一页", async ({ page, api }) => {
  const emptyClass = await createRosterClass(api, uniqueTag("empty"));

  let total = (await fetchRoster(api)).length;
  while (total <= ROSTER_PAGE_SIZE) {
    await createRosterMember(api, uniqueTag("page_reset"));
    total += 1;
  }

  await openRoster(page);
  const roster = await fetchRoster(api);
  expect(roster).toHaveLength(total);
  expect(total).toBeGreaterThan(ROSTER_PAGE_SIZE);
  await expect(cards(page)).toHaveCount(ROSTER_PAGE_SIZE);
  await expect(page.getByRole("navigation", { name: "Page", exact: true })).toBeVisible();

  await ensureFiltersOpen(filterToolbar(page));
  const classes = JSON.stringify([emptyClass.id]);
  await expectRosterPage(page, () => classFilterOption(page, emptyClass.label).click(), { classes });
  await expectRosterPage(page, () => searchBox(page).fill("nobody-should-match-this"), {
    search: "nobody-should-match-this", classes,
  });
  await expect(cards(page)).toHaveCount(0);

  const reset = page.getByRole("button", { name: "Reset filters", exact: true });
  await expect(reset, "有条件在生效时重置才该可用").toBeEnabled();
  /* 筛选面板是浮层，空态按钮在它下面；先像用户一样用入口收起浮层，
     再验证空态自己的 reset 行为，不能 force 点击被遮挡的元素。 */
  const filterToggle = filterToolbar(page).locator(".content-filter-toolbar__toggle");
  await filterToggle.click();
  await expect(filterToggle).toHaveAttribute("aria-expanded", "false");
  await expectRosterReadBudget(page, async () => {
    await reset.click();
    await expect(cards(page)).toHaveCount(ROSTER_PAGE_SIZE);
    await expect(page.getByRole("navigation", { name: "Page", exact: true })).toBeVisible();
  }, 1);

  await expect(searchBox(page)).toHaveValue("");
  await ensureFiltersOpen(filterToolbar(page));
  await expect(
    page.getByRole("group", { name: "Filter roster by class", exact: true })
      .getByRole("checkbox", { checked: true }),
    "只清搜索不清职业的话，用户会以为筛选已经撤干净了",
  ).toHaveCount(0);
  expect(await readCount(page)).toEqual({ visible: ROSTER_PAGE_SIZE, total: roster.length });
  await expect(page.getByRole("button", { name: "Go to page 1", exact: true }))
    .toHaveAttribute("aria-current", "page");
});

test("音频偏好：静音开关与音量滑块都落盘", async ({ page }) => {
  await openRoster(page);
  const trigger = page.getByRole("button", { name: "Controls profile BGM", exact: true });
  await trigger.click();
  const panel = page.getByRole("dialog", { name: "Controls profile BGM" });
  await expect(panel, "点触发器要展开音频偏好面板").toBeVisible();

  const mute = panel.getByRole("button", { name: "Mute", exact: true });
  await expect(mute, "默认不静音").toHaveAttribute("aria-pressed", "false");
  await expectRosterReadBudget(page, async () => {
    await mute.click();
    await expect(panel.getByRole("button", { name: "Unmute", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
  expect(
    await page.evaluate(() => localStorage.getItem("roster.audio.muted")),
    "静音状态不落盘的话，下次进页面又会被人声吓一跳",
  ).toBe("true");

  const slider = panel.getByRole("slider", { name: "Roster audio volume" });
  await slider.focus();
  await slider.press("ArrowRight");
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("22");
  await expect(slider).toHaveAttribute("aria-valuetext", "22%");
  expect(
    await page.evaluate(() => localStorage.getItem("roster.audio.volume")),
    "音量默认 20，按两下右箭头应当写成 22",
  ).toBe("22");

  await page.keyboard.press("Escape");
  await expect(panel, "Escape 要能收起面板").toHaveCount(0);

  await openRoster(page);
  await page.getByRole("button", { name: "Controls profile BGM", exact: true }).click();
  const restored = page.getByRole("dialog", { name: "Controls profile BGM" });
  await expect(restored.getByRole("button", { name: "Unmute", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(restored.getByRole("slider", { name: "Roster audio volume" })).toHaveValue("22");
});

test("成员卡片：打开资料弹窗，内容与服务端一致，关闭按钮收起", async ({ page, api }) => {
  await openRoster(page);
  const roster = await fetchRoster(api);
  const target = roster.find((row) => row.user.display_name === "member_01");
  expect(target, "fresh fixture 必须提供共享成员 member_01").toBeTruthy();
  const { display_name } = target!.user;

  await expectRosterPage(page, () => searchBox(page).fill(display_name), { search: display_name.toLowerCase() });
  await expect(cards(page)).toHaveCount(1);

  await expectRosterReadBudget(page, async () => {
    const detailResponse = page.waitForResponse((response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname === `/api/users/${target!.user.id}`);
    await page.getByRole("button", { name: `Open profile for ${display_name}`, exact: true }).click();
    const response = await detailResponse;
    expect(response.status(), "打开卡片应按稳定 ID 独立读取详情").toBe(200);
    const detail = await response.json() as RosterRow;
    expect(detail.user.id).toBe(target!.user.id);
    expect(detail.profile.power).toBe(target!.profile.power);
    await expect(topDialog(page)).toBeVisible();
  });

  const dialog = topDialog(page);
  await expect(dialog.getByText(`Profile: ${display_name}`, { exact: true })).toBeVisible();
  await expect(
    dialog.getByText(String(target!.profile.power), { exact: true }),
    "弹窗里的战力必须是服务端那一份，对不上就是拿错了人的资料",
  ).toBeVisible();

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expectNoDialog(page);
});

test("资料弹窗的编辑入口：别人的资料跳去后台，自己的跳去个人页", async ({ page, api }) => {
  await openRoster(page);
  const roster = await fetchRoster(api);
  const target = roster.find((row) => row.user.display_name === "member_01");
  expect(target, "fresh fixture 必须提供共享成员 member_01").toBeTruthy();
  const { display_name } = target!.user;

  await expectRosterPage(page, () => searchBox(page).fill(display_name), { search: display_name.toLowerCase() });
  await expect(cards(page)).toHaveCount(1);
  await page.getByRole("button", { name: `Open profile for ${display_name}`, exact: true }).click();
  const dialog = topDialog(page);
  await dialog.getByRole("button", { name: "Edit in Admin", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/admin" && url.searchParams.get("member") === target!.user.id);
  await expect(topDialog(page).getByRole("heading", {
    name: `Member Detail · ${display_name}`, exact: true,
  })).toBeVisible();

  await openRoster(page);
  await expectRosterPage(page, () => searchBox(page).fill("admin"), { search: "admin" });
  await expect(cards(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Open profile for admin", exact: true }).click();
  const own = topDialog(page);
  await expect(
    own.getByRole("button", { name: "Edit My Profile", exact: true }),
    "看自己的资料时入口应当指向个人页，而不是后台成员管理",
  ).toBeVisible();
  await own.getByRole("button", { name: "Edit My Profile", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/profile");
});
