import type { APIRequestContext, Locator, Page, Response } from "@playwright/test";
import { readAssignableRole } from "../../support/members";
import { expect, readJson, test } from "../../support/test";
import { field, topDialog } from "../../support/ui";

/*
 * 名册页的全部控件：搜索、职业多选、排序下拉、加载更多、空态重置、
 * 音频偏好（静音 + 音量）、成员卡片与资料弹窗。
 *
 * 和画廊页相反，这一页的筛选、排序、分页统统在前端完成
 * （useRosterPageController.ts:132 的 sortedRows 是个 useMemo，
 * 名单只在进页面时取一次，staleTime 10 分钟）。
 * 所以这里的验证契约是另一套：
 *   1. 结果集要和服务端的真实数据对得上——期望值一律从 GET /api/users 现算，
 *      不把种子里的用户名和职业抄进用例，否则改种子就得改测试，
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

type RosterRow = {
  user: { id: string; username: string };
  profile: { power: number; classes: string[] };
};

let createdUserIds: string[] = [];

test.beforeEach(async ({ page }) => {
  createdUserIds = [];
  await openRoster(page);
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
  expect(body.data.length, "种子名册不该是空的").toBeGreaterThan(0);
  return body.data;
}

function cards(page: Page): Locator {
  return page.locator(".roster-card-cell");
}

function cardNames(page: Page): Locator {
  return page.locator(".roster-card-cell .member-card__username");
}

function searchBox(page: Page): Locator {
  return field(page, "Search by username");
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

/**
 * 把名册整份展开。
 *
 * 首屏只渲染 20 张，换排序还会把这个数字重置回 20（useRosterPageController.ts:110）。
 * 凡是要拿「整份名单」做断言的用例，都必须先展开：单跑时种子只有 19 个人，
 * 一页装得下，不展开也碰巧对；整轮跑起来站点上有几十号人，读到的就只是第一页，
 * 于是「换排序不该把人换掉」这种断言会在两个不同的分页切片之间比较，红得毫无道理。
 */
async function revealAll(page: Page): Promise<void> {
  const loadMore = page.getByRole("button", { name: "Load more", exact: true });
  for (let round = 0; round < 50; round += 1) {
    const { visible, total } = await readCount(page);
    if (visible >= total) return;
    await loadMore.click();
    await expect(page.locator(".roster-count-text")).not.toHaveText(`Showing ${visible}/${total}`);
  }
  throw new Error("名册展开了 50 轮还没到底，分页多半坏了");
}

async function readStoredFilters(page: Page): Promise<{ classFilter?: unknown; sortMode?: unknown }> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), ROSTER_FILTERS_KEY);
  expect(raw, "改过筛选之后 roster.filters 必须落盘").not.toBeNull();
  return JSON.parse(raw as string) as { classFilter?: unknown; sortMode?: unknown };
}

test("搜索框：按用户名过滤，条件先 trim 再忽略大小写，全程不回服务端", async ({ page, api }) => {
  const roster = await fetchRoster(api);
  const expectedPrefix = roster
    .map((row) => row.user.username)
    .filter((username) => username.toLowerCase().includes("mod_"))
    .sort();
  expect(expectedPrefix.length, "种子里应当有若干 mod_ 开头的账号").toBeGreaterThan(1);

  /* 故意全大写：控件会 toLowerCase 之后再比（useRosterPageController.ts:65）。 */
  await expectClientSideOnly(page, async () => {
    await searchBox(page).fill("MOD_");
    await expect(cards(page)).toHaveCount(expectedPrefix.length);
  });
  expect(
    (await cardNames(page).allInnerTexts()).map((name) => name.trim()).sort(),
    "大小写不同就漏人的话，搜索基本等于不能用",
  ).toEqual(expectedPrefix);
  expect(await readCount(page), "计数要跟着筛选后的结果集走")
    .toEqual({ visible: expectedPrefix.length, total: expectedPrefix.length });

  const single = expectedPrefix[0]!;
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
  const roster = await fetchRoster(api);
  const catalog = await readJson(await api.get("/api/classes"), "读取职业目录") as Array<{ id: string; label: string }>;

  const byClass = new Map<string, string[]>();
  for (const row of roster) {
    for (const classId of new Set(row.profile.classes)) {
      byClass.set(classId, [...(byClass.get(classId) ?? []), row.user.username]);
    }
  }
  const ranked = [...byClass.entries()].sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
  const top = ranked[0];
  expect(top, "种子里至少要有一个挂了职业的成员").toBeTruthy();
  const [classId, expectedNames] = top!;
  const outsider = roster.find((row) => !row.profile.classes.includes(classId));
  expect(outsider, "得有一个不属于该职业的成员，才能验证「滤掉」的方向").toBeTruthy();
  const label = catalog.find((item) => item.id === classId)?.label ?? classId;

  await expectClientSideOnly(page, async () => {
    await field(page, "Filter roster by class").click();
    await page.getByRole("option", { name: label, exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(cards(page)).toHaveCount(expectedNames.length);
  });
  expect(
    (await cardNames(page).allInnerTexts()).map((name) => name.trim()).sort(),
    "留下的必须正好是服务端记着挂了这个职业的人",
  ).toEqual([...expectedNames].sort());
  await expect(
    cardNames(page).filter({ hasText: outsider!.user.username }),
    "不属于该职业的成员必须被滤掉",
  ).toHaveCount(0);

  expect((await readStoredFilters(page)).classFilter, "职业条件要落盘，否则刷新就白选了").toEqual([classId]);

  await openRoster(page);
  await expect(
    page.locator(".roster-class-select .mantine-Pill-root"),
    "刷新后控件上要还挂着这个职业",
  ).toHaveText(label);
  await expect(cards(page), "刷新后结果集也要跟着恢复").toHaveCount(expectedNames.length);
});

test("排序下拉：换一套排序依据真的重排卡片，选择被持久化", async ({ page, api }) => {
  const roster = await fetchRoster(api);
  const powerOf = new Map(roster.map((row) => [row.user.username, row.profile.power]));
  const primaryClassOf = new Map(roster.map((row) => [row.user.username, row.profile.classes[0] ?? ""]));

  await revealAll(page);
  const defaultOrder = (await cardNames(page).allInnerTexts()).map((name) => name.trim());
  const powers = defaultOrder.map((name) => powerOf.get(name));
  expect(powers.every((value) => typeof value === "number"), "卡片上的用户名要能在服务端数据里找到").toBe(true);
  expect(
    (powers as number[]).every((value, index) => index === 0 || (powers[index - 1] as number) >= value),
    "默认是战力倒序，出现回升就说明排序没生效",
  ).toBe(true);

  /*
   * 等的是下拉自己的值，不是「首张卡换人了」。
   * 战力最高的正好也是字典序最前的那个账号，按首张卡等会一直等不到变化；
   * 而下拉值和网格读的是同一个 sortMode，同一次提交里落地，等它就够了。
   */
  await expectClientSideOnly(page, async () => {
    await field(page, "Sort roster").click();
    await page.getByRole("option", { name: "Username (A-Z)", exact: true }).click();
    await expect(field(page, "Sort roster")).toHaveValue("Username (A-Z)");
  });
  await revealAll(page);
  const byUsername = (await cardNames(page).allInnerTexts()).map((name) => name.trim());
  expect(
    byUsername.every((name, index) => index === 0 || byUsername[index - 1]!.localeCompare(name) <= 0),
    "选了按用户名升序，顺序就必须真的是升序",
  ).toBe(true);
  expect(byUsername, "换了排序依据，顺序就该真的不一样").not.toEqual(defaultOrder);
  expect(new Set(byUsername), "换排序不该把人换掉，只该换顺序").toEqual(new Set(defaultOrder));

  await expectClientSideOnly(page, async () => {
    await field(page, "Sort roster").click();
    await page.getByRole("option", { name: "Class", exact: true }).click();
    await expect(field(page, "Sort roster")).toHaveValue("Class");
  });
  /*
   * 按职业排序只断言「同职业的人连成一段」，不断言段与段之间谁在前。
   * 排序键是职业名的 localeCompare，中文的排序结果取决于 ICU 的版本，
   * Node 和浏览器不一定一致——把那个顺序钉进用例，红起来跟产品无关。
   */
  await revealAll(page);
  const classSequence = (await cardNames(page).allInnerTexts())
    .map((name) => primaryClassOf.get(name.trim()) ?? "");
  const seen = new Set<string>();
  for (let index = 0; index < classSequence.length; index += 1) {
    const current = classSequence[index]!;
    if (index > 0 && classSequence[index - 1] === current) continue;
    expect(seen.has(current), `职业 ${current} 在列表里断成了两段，说明没有按职业分组`).toBe(false);
    seen.add(current);
  }

  expect((await readStoredFilters(page)).sortMode, "排序选择要落盘").toBe("class");
  await openRoster(page);
  await expect(field(page, "Sort roster"), "刷新后下拉要还停在上次的选择").toHaveValue("Class");
});

test("加载更多：首屏只渲染 20 张，点下去把剩下的补齐", async ({ page, api }) => {
  const before = await readCount(page);
  /*
   * 首屏永远是「20 张或全部，取小的那个」。
   * 这里不能写成 visible === total：整轮跑起来时，前面用例造的一次性成员
   * 要到收尾才被硬删，站点上远不止一页人，把它当前提这条用例就只在单跑时成立。
   */
  expect(before.visible, "首屏最多渲染 20 张").toBe(Math.min(20, before.total));

  /*
   * 名册要超过一页才有「加载更多」，种子只有 19 个人，所以现造两个。
   * POST /api/admin/users 收用户名和当前管理员可授予的 D1 角色，临时密码由服务端生成。
   * 返回的 user_id 会被 system-test 中间件登记成 user 产物，收尾时硬删。
  */
  const stamp = Date.now();
  const role = await readAssignableRole(api);
  for (const suffix of ["a", "b"]) {
    const created = await readJson(
      await api.post("/api/admin/users", {
        data: { username: `e2e_roster_${stamp}${suffix}`, role_id: role.id },
      }),
      "创建临时成员",
    ) as { user_id: string };
    expect(created.user_id, "创建接口必须回 user_id，否则收尾时无从定位").toBeTruthy();
    createdUserIds.push(created.user_id);
  }

  await openRoster(page);
  const paged = await readCount(page);
  expect(paged.total, "两个新成员要出现在总数里").toBe(before.total + 2);
  expect(paged.visible, "首屏只渲染 20 张").toBe(20);
  await expect(cards(page)).toHaveCount(20);

  const loadMore = page.getByRole("button", { name: "Load more", exact: true });
  await expect(loadMore, "还有没渲染的成员时才该出现加载更多").toBeVisible();
  /* 先验这一下是纯前端展开：不重取名单，也不写库。 */
  await expectClientSideOnly(page, async () => {
    await loadMore.click();
    await expect(cards(page)).not.toHaveCount(20);
  });
  /* 再点到底。不写死「一次点完」——人多的时候本来就不止一屏。 */
  await revealAll(page);
  expect(await readCount(page)).toEqual({ visible: paged.total, total: paged.total });
  await expect(cards(page)).toHaveCount(paged.total);
  await expect(loadMore, "全部渲染完之后按钮该自己消失").toHaveCount(0);
});

test("空态的重置筛选：一次清掉搜索与职业，列表回到全量", async ({ page, api }) => {
  const roster = await fetchRoster(api);

  await field(page, "Filter roster by class").click();
  await page.getByRole("option").first().click();
  await page.keyboard.press("Escape");
  await searchBox(page).fill("nobody-should-match-this");
  await expect(cards(page)).toHaveCount(0);

  const reset = page.getByRole("button", { name: "Reset filters", exact: true });
  await expect(reset, "有条件在生效时重置才该可用").toBeEnabled();
  await expectClientSideOnly(page, async () => {
    await reset.click();
    await expect(cards(page)).toHaveCount(Math.min(20, roster.length));
  });

  await expect(searchBox(page)).toHaveValue("");
  await expect(
    page.locator(".roster-class-select .mantine-Pill-root"),
    "只清搜索不清职业的话，用户会以为筛选已经撤干净了",
  ).toHaveCount(0);
  expect(await readCount(page)).toEqual({ visible: Math.min(20, roster.length), total: roster.length });
});

test("音频偏好：静音开关与音量滑块都落盘", async ({ page }) => {
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
  await expect(slider).toHaveAttribute("aria-valuenow", "22");
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
  await expect(restored.getByRole("slider", { name: "Roster audio volume" })).toHaveAttribute("aria-valuenow", "22");
});

test("成员卡片：打开资料弹窗，内容与服务端一致，关闭按钮收起", async ({ page, api }) => {
  const roster = await fetchRoster(api);
  const target = roster.find((row) => row.user.username.startsWith("member_"));
  expect(target, "种子里应当有普通成员").toBeTruthy();
  const { username } = target!.user;

  await searchBox(page).fill(username);
  await expect(cards(page)).toHaveCount(1);

  await expectClientSideOnly(page, async () => {
    await page.getByRole("button", { name: `Open profile for ${username}`, exact: true }).click();
    await expect(topDialog(page)).toBeVisible();
  });

  const dialog = topDialog(page);
  await expect(dialog.getByText(`Profile: ${username}`, { exact: true })).toBeVisible();
  await expect(
    dialog.getByText(String(target!.profile.power), { exact: true }),
    "弹窗里的战力必须是服务端那一份，对不上就是拿错了人的资料",
  ).toBeVisible();

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".mantine-Overlay-root")).toHaveCount(0);
});

test("资料弹窗的编辑入口：别人的资料跳去后台，自己的跳去个人页", async ({ page, api }) => {
  const roster = await fetchRoster(api);
  const target = roster.find((row) => row.user.username.startsWith("member_"));
  expect(target, "种子里应当有普通成员").toBeTruthy();
  const { username } = target!.user;

  /*
   * 必须先等搜索的防抖落地再开弹窗：debouncedSearch 一变
   * useRosterPageController.ts:99 的 effect 就会把已打开的弹窗关掉，
   * 抢在防抖之前点开的话，弹窗会在半路被这条 effect 拆掉。
   */
  await searchBox(page).fill(username);
  await expect(cards(page)).toHaveCount(1);
  await page.getByRole("button", { name: `Open profile for ${username}`, exact: true }).click();
  const dialog = topDialog(page);
  await dialog.getByRole("button", { name: "Edit in Admin", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/admin" && url.searchParams.get("member") === username);

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
