import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, readJson, test, type Flow } from "../../support/test";
import { field, selectOption } from "../../support/ui";

/*
 * 个人资料页「时间」屏：一周在线时间编辑器 + 请假登记卡。
 *
 * 两块的链路正相反，用例的收尾方式也因此不同：
 *   - 编辑器（预设、单日时段、复制到某天、清空）全是改本地草稿，只有右下角的
 *     保存按钮会写库。所以每次操作都先确认它不碰网络，再保存、再回读服务端。
 *   - 请假卡是即时接口：提交 POST、删除 DELETE，点完就落库，和保存条无关。
 *
 * 时区：playwright.config 把浏览器钉在 UTC（timezoneId: "UTC"），所以界面上的
 * 本地时间和落库的 *_utc 一一对应，断言才写得成固定值。末段的 24:00 换算过去是
 * 次日 00:00，落库就是 "00:00"——这不是 bug，是同一个时刻的两种写法。
 *
 * 种子里 admin 的 availability 是 {all_day: true}（没有 days 键），编辑器读作
 * 「一段时间都没有」，所以每条用例都从空的一周开始。afterEach 用一次 PATCH 把
 * 它整体写回。
 */

const SAVE_PROFILE = { method: "PATCH", path: /^\/api\/users\/[^/]+\/profile$/ } as const;
const ABSENCES_API = /^\/api\/users\/[^/]+\/absences$/;
const ABSENCE_ITEM_API = /^\/api\/users\/[^/]+\/absences\/[^/]+$/;

type Profile = {
  power: number;
  classes: string[];
  title_html: string | null;
  bio: string | null;
  images: string[];
  video_urls: string[];
  availability: Record<string, unknown> | null;
};

type Absence = { id: string; start_date: string; end_date: string; note: string | null };

let userId: string;
let original: Profile;

test.beforeEach(async ({ page, api }) => {
  const listed = await readJson(await api.get("/api/users?page=1&limit=500"), "读取名单") as {
    data: Array<{ user: { id: string; username: string } }>;
  };
  const admin = listed.data.find((entry) => entry.user.username === "admin");
  expect(admin, "种子里必须有 admin，这一页编辑的就是当前会话本人").toBeTruthy();
  userId = admin!.user.id;
  original = await readProfile(api);

  await page.goto("/profile");
  /* 顺带验一遍标签控件本身：切过去要换屏，并把 tab 写进地址栏。 */
  await page.getByRole("tab", { name: "Availability", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Weekly availability", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/[?&]tab=availability\b/);
});

test.afterEach(async ({ api }) => {
  const response = await api.patch(`/api/users/${userId}/profile`, {
    data: {
      power: original.power,
      classes: original.classes,
      title_html: original.title_html,
      bio: original.bio,
      images: original.images,
      video_urls: original.video_urls,
      availability: original.availability,
    },
  });
  expect(response.ok(), `还原资料返回 ${response.status()}: ${await response.text()}`).toBe(true);
});

async function readProfile(api: APIRequestContext): Promise<Profile> {
  const detail = await readJson(await api.get(`/api/users/${userId}`), "回读资料") as { profile: Profile };
  return detail.profile;
}

async function readAvailability(api: APIRequestContext): Promise<Record<string, Array<{ start_utc: string; end_utc: string }>>> {
  const availability = (await readProfile(api)).availability;
  expect(availability, "保存之后服务端上必须有可用时间").toBeTruthy();
  const days = (availability as { days?: unknown }).days;
  expect(days, "编辑器存下去的结构必须带 days").toBeTruthy();
  return days as Record<string, Array<{ start_utc: string; end_utc: string }>>;
}

async function readAbsences(api: APIRequestContext): Promise<Absence[]> {
  const listed = await readJson(await api.get(`/api/users/${userId}/absences`), "回读请假") as { data: Absence[] };
  return listed.data;
}

function dayRow(page: Page, name: string): Locator {
  return page.locator(".availability-day").filter({
    has: page.locator(".availability-day__name", { hasText: new RegExp(`^${name}$`) }),
  });
}

function blocksOf(page: Page, name: string): Locator {
  return dayRow(page, name).locator(".availability-block");
}

function saveButton(page: Page): Locator {
  return page.getByRole("button", { name: "Save Profile", exact: true });
}

async function save(page: Page, flow: Flow): Promise<void> {
  await expect(saveButton(page), "有未保存改动时才会出现保存条").toBeVisible();
  await flow.click(saveButton(page), SAVE_PROFILE);
  await expect(saveButton(page), "存完之后提示条必须收起来").toHaveCount(0);
}

/** 一周总时数，读的是右栏预览。 */
function weekHours(page: Page): Locator {
  return page.locator(".profile-week__total > *").first();
}

function absenceCard(page: Page): Locator {
  return page.locator(".mantine-Card-root").filter({ hasText: "Absence Reports" });
}

function isoDate(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

test("预设：叠加而不是覆盖，清空一键归零，两次都要保存才落库", async ({ page, flow, api }) => {
  for (const day of ["Mon", "Sat"]) {
    await expect(blocksOf(page, day), "种子里 admin 没有填过时段").toHaveCount(0);
  }
  await expect(weekHours(page)).toHaveText("0 hours available per week");

  await flow.clickWithoutApi(page.getByRole("button", { name: "Weeknights", exact: true }));
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
    await expect(blocksOf(page, day)).toHaveText(["20:00–24:00"]);
  }
  await expect(blocksOf(page, "Sat"), "工作日预设不该碰周末").toHaveCount(0);
  await expect(weekHours(page), "5 天 × 4 小时").toHaveText("20 hours available per week");

  /* 第二个预设必须和第一个合并：先点晚上再点周末，两样都该在。 */
  await flow.clickWithoutApi(page.getByRole("button", { name: "Weekends", exact: true }));
  await expect(blocksOf(page, "Mon"), "叠加不能把已有的顶掉").toHaveText(["20:00–24:00"]);
  await expect(blocksOf(page, "Sat")).toHaveText(["10:00–24:00"]);
  await expect(blocksOf(page, "Sun")).toHaveText(["10:00–24:00"]);
  await expect(weekHours(page), "20 + 2 天 × 14 小时").toHaveText("48 hours available per week");

  await save(page, flow);
  const saved = await readAvailability(api);
  expect(saved.monday, "24:00 落到 UTC 就是次日的 00:00").toEqual([{ start_utc: "20:00", end_utc: "00:00" }]);
  expect(saved.saturday).toEqual([{ start_utc: "10:00", end_utc: "00:00" }]);

  await flow.clickWithoutApi(page.getByRole("button", { name: "Clear all", exact: true }));
  for (const day of ["Mon", "Sat", "Sun"]) {
    await expect(blocksOf(page, day)).toHaveCount(0);
  }
  await expect(weekHours(page)).toHaveText("0 hours available per week");
  await expect(page.getByText("No availability set", { exact: true })).toBeVisible();

  await save(page, flow);
  const cleared = await readAvailability(api);
  expect(cleared.monday, "清空之后每一天都得是空的").toEqual([]);
  expect(cleared.saturday).toEqual([]);
});

test("单日时段：结束早于开始就不让加，加完能删，两步都要保存才落库", async ({ page, flow, api }) => {
  await dayRow(page, "Wed").locator(".availability-day__add").click();
  const picker = page.getByRole("dialog");
  await expect(field(picker, "From")).toHaveValue("20:00");
  await expect(field(picker, "To")).toHaveValue("24:00");

  /* 结束早于开始时禁用按钮并说明原因，而不是替用户把两个值调个个儿。 */
  await selectOption(picker, "To", "00:30");
  await expect(picker.getByRole("button", { name: "Add time", exact: true })).toBeDisabled();
  await expect(picker.getByText("End must be later than start")).toBeVisible();

  /* 换开始时间把它救回来：证明这个提示是两个值一起决定的，不是「结束」自己的校验。 */
  await selectOption(picker, "From", "00:00");
  const addBlock = picker.getByRole("button", { name: "Add time", exact: true });
  await expect(addBlock).toBeEnabled();
  await flow.clickWithoutApi(addBlock);
  await expect(page.getByRole("dialog"), "加完之后弹层该自己收起来").toHaveCount(0);
  await expect(blocksOf(page, "Wed")).toHaveText(["00:00–00:30"]);
  await expect(blocksOf(page, "Thu"), "只加了周三，别的天不能跟着变").toHaveCount(0);

  await save(page, flow);
  expect((await readAvailability(api)).wednesday)
    .toEqual([{ start_utc: "00:00", end_utc: "00:30" }]);

  await flow.clickWithoutApi(
    blocksOf(page, "Wed").getByRole("button", { name: "Remove 00:00–00:30 on Wed", exact: true }),
  );
  await expect(blocksOf(page, "Wed")).toHaveCount(0);

  await save(page, flow);
  expect((await readAvailability(api)).wednesday, "删掉的时段必须真的从库里消失").toEqual([]);
});

test("复制到某天：空的一天不能复制，复制过去的时段能落库", async ({ page, flow, api }) => {
  await expect(
    dayRow(page, "Mon").locator(".availability-day__copy"),
    "一段时间都没有的时候，没有东西可复制",
  ).toBeDisabled();

  await dayRow(page, "Mon").locator(".availability-day__add").click();
  await flow.clickWithoutApi(page.getByRole("dialog").getByRole("button", { name: "Add time", exact: true }));
  await expect(blocksOf(page, "Mon")).toHaveText(["20:00–24:00"]);

  await dayRow(page, "Mon").locator(".availability-day__copy").click();
  await flow.clickWithoutApi(page.getByRole("menuitem", { name: "Tue", exact: true }));
  await expect(blocksOf(page, "Tue"), "复制过去的应当是同一段时间").toHaveText(["20:00–24:00"]);
  await expect(blocksOf(page, "Mon"), "复制不是搬走，源那天要留着").toHaveText(["20:00–24:00"]);
  await expect(blocksOf(page, "Wed"), "只复制到周二").toHaveCount(0);

  await save(page, flow);
  const saved = await readAvailability(api);
  expect(saved.tuesday).toEqual([{ start_utc: "20:00", end_utc: "00:00" }]);
  expect(saved.monday).toEqual(saved.tuesday);
});

test("请假登记：日期不成立就不让提交，提交与删除都即时落库", async ({ page, flow, api }) => {
  const before = await readAbsences(api);
  const card = absenceCard(page);
  const submit = card.getByRole("button", { name: "Report Absence", exact: true });
  /* 起止日期都没有 aria-label（AbsenceManagerCard 用的是上方一行 Text），
     只能按出现顺序取——这一点已记进问题清单。 */
  const startInput = card.locator("input[type='date']").first();
  const endInput = card.locator("input[type='date']").nth(1);

  await expect(submit, "两个日期都空着，提交按钮就该是灰的").toBeDisabled();

  const start = isoDate(30);
  const end = isoDate(35);
  await startInput.fill(start);
  await endInput.fill(isoDate(20));
  await expect(submit, "结束早于开始时不该让提交").toBeDisabled();

  await endInput.fill(end);
  const note = `E2E absence ${Date.now()}`;
  await card.getByPlaceholder("Optional note (e.g. travel, exams)").fill(note);
  await expect(submit).toBeEnabled();

  await flow.click(submit, { method: "POST", path: ABSENCES_API });
  const row = card.locator(".mantine-Group-root").filter({ hasText: `${start} ~ ${end}` }).first();
  await expect(row, "提交成功后列表里要出现这一条").toBeVisible();
  await expect(row.getByText("Upcoming", { exact: true }), "还没到日期，状态是「即将」").toBeVisible();
  await expect(startInput, "提交完表单要清空，免得连点两次登记两条").toHaveValue("");
  await expect(endInput).toHaveValue("");

  const afterCreate = await readAbsences(api);
  expect(afterCreate.length, "服务端要真的多一条").toBe(before.length + 1);
  const created = afterCreate.find((item) => item.note === note);
  expect(created, "落库的应当是刚填的那条").toBeTruthy();
  expect([created!.start_date, created!.end_date]).toEqual([start, end]);

  await flow.click(
    row.getByRole("button", { name: "Delete absence", exact: true }),
    { method: "DELETE", path: ABSENCE_ITEM_API },
  );
  await expect(row).toHaveCount(0);
  expect((await readAbsences(api)).length, "删除之后服务端也要少一条").toBe(before.length);
});
