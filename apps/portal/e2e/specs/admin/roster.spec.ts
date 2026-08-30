import type { APIRequestContext, Locator, Page, Response } from "@playwright/test";
import { profileMutationHeaders } from "../../support/api";
import { createThrowawayMember, uniqueTag } from "../../support/members";
import { expect, readJson, test } from "../../support/test";
import { ensureFiltersOpen, expectNoDialog, topDialog } from "../../support/ui";

/*
 * 名册页的全部控件：搜索、职业多选、排序单选、分页、空态重置、
 * 音频偏好（静音 + 音量）、成员卡片与资料弹窗。
 *
 * 和画廊页相反，这一页的筛选、排序、分页统统在前端完成
 * （useRosterPageController.ts:132 的 sortedRows 是个 useMemo，
 * 名单只在进页面时取一次，staleTime 10 分钟）。
 * 所以这里的验证契约是另一套：
 *   1. 结果集要和服务端的真实数据对得上——期望值一律从 GET /api/users 现算，
 *      需要特定分布时由用例先创建，不把演示用户名和职业抄进断言，
 *      而且抄一遍等于把实现又写了一遍，什么都没验证；
 *   2. 每个控件都必须证明它「没有回服务端」——既不重取名单，也不写库。
 *      纯前端控件一旦偷偷发请求，就是把 10 分钟的缓存和限流预算白白烧掉。
 *
 * 不用 flow.clickWithoutApi 做第 2 点：它把任何 /api/ 的 GET 都算成违例，
 * 后台重取、头像取件随时可能落进那半秒，会把用例洗成偶发红。
 * expectClientSideOnly 只盯两类真正说明问题的请求。
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

async function openRoster(page: Page): Promise<void> {
  await page.goto("/roster");
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
 * 执行一段操作，并要求它既没有重取名单，也没有写任何库。
 * 只认这两类：pathname 恰好是 /api/users（统一媒体读取不算名单请求）
 * 和任何非 GET 的 /api/ 请求。
 */
async function expectClientSideOnly(
  page: Page,
  action: () => Promise<void>,
  quietMs = 700,
): Promise<void> {
  const calls: string[] = [];
  const record = (response: Response): void => {
    const { pathname } = new URL(response.url());
    const method = response.request().method();
    if (pathname === USERS_LIST || (method !== "GET" && pathname.startsWith("/api/"))) {
      calls.push(`${method} ${pathname}`);
    }
  };
  page.on("response", record);
  try {
    await action();
    await page.waitForTimeout(quietMs);
  } finally {
    page.off("response", record);
  }
  expect(calls, "名册的筛选与排序都在前端完成，不该重取名单，更不该写库").toEqual([]);
}

async function readStoredFilters(page: Page): Promise<{ classFilter?: unknown; sortMode?: unknown }> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), ROSTER_FILTERS_KEY);
  expect(raw, "改过筛选之后 roster.filters 必须落盘").not.toBeNull();
  return JSON.parse(raw as string) as { classFilter?: unknown; sortMode?: unknown };
}

test("搜索框：按用户名过滤，条件先 trim 再忽略大小写，全程不回服务端", async ({ page, api }) => {
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

  /* 故意全大写：控件会 toLowerCase 之后再比（useRosterPageController.ts:65）。 */
  await expectClientSideOnly(page, async () => {
    await searchBox(page).fill(tag.toUpperCase());
    await expect(cards(page)).toHaveCount(expectedMatches.length);
  });
  expect(
    (await cardNames(page).allInnerTexts()).map((name) => name.trim()).sort(),
    "大小写不同就漏人的话，搜索基本等于不能用",
  ).toEqual(expectedMatches);
  expect(await readCount(page), "计数要跟着筛选后的结果集走")
    .toEqual({ visible: expectedMatches.length, total: expectedMatches.length });

  const single = expectedMatches[0]!;
  await expectClientSideOnly(page, async () => {
    await searchBox(page).fill(`  ${single}  `);
    await expect(cards(page)).toHaveCount(1);
  });
  await expect(cardNames(page), "前后空格没 trim 掉的话这里会一个都搜不到").toHaveText([single]);

  await expectClientSideOnly(page, async () => {
    await searchBox(page).fill("nobody-should-match-this");
    await expect(cards(page)).toHaveCount(0);
  });
  await expect(page.getByText("No members match your filters")).toBeVisible();
});

test("职业多选：结果集与服务端数据一致，条件写进 localStorage 并在刷新后恢复", async ({ page, api }) => {
  const rosterClass = await createRosterClass(api, uniqueTag("class"));
  const member = await createRosterMember(api, uniqueTag("class_member"));
  await updateRosterProfile(api, member.id, { classes: [rosterClass.id] });
  await openRoster(page);
  const roster = await fetchRoster(api);
  const catalog = await readJson(await api.get("/api/classes"), "读取职业目录") as Array<{ id: string; label: string }>;

  const byClass = new Map<string, string[]>();
  for (const row of roster) {
    for (const classId of new Set(row.profile.classes)) {
      byClass.set(classId, [...(byClass.get(classId) ?? []), row.user.display_name]);
    }
  }
  const ranked = [...byClass.entries()].sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
  const top = ranked[0];
  expect(top, "本用例创建的职业成员必须出现在名册里").toBeTruthy();
  const [classId, expectedNames] = top!;
  const outsider = roster.find((row) => !row.profile.classes.includes(classId));
  expect(outsider, "得有一个不属于该职业的成员，才能验证「滤掉」的方向").toBeTruthy();
  const label = catalog.find((item) => item.id === classId)?.label ?? classId;

  await expectClientSideOnly(page, async () => {
    await ensureFiltersOpen(filterToolbar(page));
    await classFilterOption(page, label).click();
    await expect(cards(page)).toHaveCount(expectedNames.length);
  });
  expect(
    (await cardNames(page).allInnerTexts()).map((name) => name.trim()).sort(),
    "留下的必须正好是服务端记着挂了这个职业的人",
  ).toEqual([...expectedNames].sort());
  await expect(
    cardNames(page).filter({ hasText: outsider!.user.display_name }),
    "不属于该职业的成员必须被滤掉",
  ).toHaveCount(0);

  expect((await readStoredFilters(page)).classFilter, "职业条件要落盘，否则刷新就白选了").toEqual([classId]);

  await openRoster(page);
  await ensureFiltersOpen(filterToolbar(page));
  await expect(classFilterOption(page, label), "刷新后控件上要还勾着这个职业").toBeChecked();
  await expect(cards(page), "刷新后结果集也要跟着恢复").toHaveCount(expectedNames.length);
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
  await expectClientSideOnly(page, async () => {
    await searchBox(page).fill(tag);
    await expect(cards(page), "排序样本必须恰好是本用例创建的两名成员").toHaveCount(2);
  });
  const roster = await fetchRoster(api);
  const powerOf = new Map(roster.map((row) => [row.user.display_name, row.profile.power]));

  const defaultOrder = (await cardNames(page).allInnerTexts()).map((name) => name.trim());
  const powers = defaultOrder.map((name) => powerOf.get(name));
  expect(powers.every((value) => typeof value === "number"), "卡片上的用户名要能在服务端数据里找到").toBe(true);
  expect(
    (powers as number[]).every((value, index) => index === 0 || (powers[index - 1] as number) >= value),
    "默认是战力倒序，出现回升就说明排序没生效",
  ).toBe(true);

  /*
   * 等的是排序选项自己的 checked 状态，不是「首张卡换人了」。
   * 战力最高的正好也是字典序最前的那个账号，按首张卡等会一直等不到变化；
   * 而排序状态和网格读的是同一个 sortMode，同一次提交里落地，等它就够了。
   */
  await expectClientSideOnly(page, async () => {
    await ensureFiltersOpen(filterToolbar(page));
    await sortOption(page, "Display name (A-Z)").click();
    await expect(sortOption(page, "Display name (A-Z)")).toBeChecked();
  });
  const byUsername = (await cardNames(page).allInnerTexts()).map((name) => name.trim());
  expect(
    byUsername.every((name, index) => index === 0 || byUsername[index - 1]!.localeCompare(name) <= 0),
    "选了按用户名升序，顺序就必须真的是升序",
  ).toBe(true);
  expect(byUsername, "换了排序依据，顺序就该真的不一样").not.toEqual(defaultOrder);
  expect(new Set(byUsername), "换排序不该把人换掉，只该换顺序").toEqual(new Set(defaultOrder));

  await expectClientSideOnly(page, async () => {
    await ensureFiltersOpen(filterToolbar(page));
    await sortOption(page, "Class").click();
    await expect(sortOption(page, "Class")).toBeChecked();
  });
  expect(
    (await cardNames(page).allInnerTexts()).map((name) => name.trim()),
    "按职业排序必须使用目录标签；alpha 职业应排在 omega 职业之前",
  ).toEqual([high.display_name, low.display_name]);

  expect((await readStoredFilters(page)).sortMode, "排序选择要落盘").toBe("class");
  await openRoster(page);
  await ensureFiltersOpen(filterToolbar(page));
  await expect(sortOption(page, "Class"), "刷新后排序要还停在上次的选择").toBeChecked();
});

test("分页：专属的 25 人结果集按每页 24 人切换，全程不回服务端", async ({ page, api }) => {
  const tag = uniqueTag("page");
  for (let count = 0; count < ROSTER_PAGE_SIZE + 1; count += 1) {
    await createRosterMember(api, tag);
  }

  await openRoster(page);
  const expectedMembers = (await fetchRoster(api))
    .filter((row) => row.user.display_name.toLowerCase().includes(tag.toLowerCase()));
  expect(expectedMembers, "专属搜索结果必须正好有 25 人").toHaveLength(ROSTER_PAGE_SIZE + 1);

  await expectClientSideOnly(page, async () => {
    await searchBox(page).fill(tag);
    await expect(cards(page)).toHaveCount(ROSTER_PAGE_SIZE);
  });
  expect(await readCount(page)).toEqual({ visible: ROSTER_PAGE_SIZE, total: expectedMembers.length });

  const pagination = page.getByRole("navigation", { name: "Page", exact: true });
  await expect(pagination.getByRole("button", { name: "Go to page 1", exact: true }))
    .toHaveAttribute("aria-current", "page");
  await expectClientSideOnly(page, async () => {
    await pagination.getByRole("button", { name: "Go to page 2", exact: true }).click();
    await expect(cards(page)).toHaveCount(1);
  });
  expect(await readCount(page)).toEqual({ visible: 1, total: expectedMembers.length });
  await expect(pagination.getByRole("button", { name: "Go to page 2", exact: true }))
    .toHaveAttribute("aria-current", "page");
  await expect(pagination.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();

  await expectClientSideOnly(page, async () => {
    await pagination.getByRole("button", { name: "Previous page", exact: true }).click();
    await expect(cards(page)).toHaveCount(ROSTER_PAGE_SIZE);
  });
  expect(await readCount(page)).toEqual({ visible: ROSTER_PAGE_SIZE, total: expectedMembers.length });
});

test("空态的重置筛选：一次清掉搜索与职业，列表回到第一页", async ({ page, api }) => {
  await createRosterClass(api, uniqueTag("empty"));

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
  await page.getByRole("group", { name: "Filter roster by class", exact: true })
    .getByRole("checkbox").first().click();
  await searchBox(page).fill("nobody-should-match-this");
  await expect(cards(page)).toHaveCount(0);

  const reset = page.getByRole("button", { name: "Reset filters", exact: true });
  await expect(reset, "有条件在生效时重置才该可用").toBeEnabled();
  /* 筛选面板是浮层，空态按钮在它下面；先像用户一样用入口收起浮层，
     再验证空态自己的 reset 行为，不能 force 点击被遮挡的元素。 */
  const filterToggle = filterToolbar(page).locator(".content-filter-toolbar__toggle");
  await filterToggle.click();
  await expect(filterToggle).toHaveAttribute("aria-expanded", "false");
  await expectClientSideOnly(page, async () => {
    await reset.click();
    await expect(cards(page)).toHaveCount(ROSTER_PAGE_SIZE);
    await expect(page.getByRole("navigation", { name: "Page", exact: true })).toBeVisible();
  });

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
  await expectClientSideOnly(page, async () => {
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

  await searchBox(page).fill(display_name);
  await expect(cards(page)).toHaveCount(1);

  await expectClientSideOnly(page, async () => {
    await page.getByRole("button", { name: `Open profile for ${display_name}`, exact: true }).click();
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

  /*
   * 必须先等搜索的防抖落地再开弹窗：debouncedSearch 一变
   * useRosterPageController.ts:99 的 effect 就会把已打开的弹窗关掉，
   * 抢在防抖之前点开的话，弹窗会在半路被这条 effect 拆掉。
   */
  await searchBox(page).fill(display_name);
  await expect(cards(page)).toHaveCount(1);
  await page.getByRole("button", { name: `Open profile for ${display_name}`, exact: true }).click();
  const dialog = topDialog(page);
  await dialog.getByRole("button", { name: "Edit in Admin", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/admin" && url.searchParams.get("member") === display_name);

  await openRoster(page);
  await searchBox(page).fill("admin");
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
