import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { webpUpload } from "../../support/files";
import { dialogTitled, field, selectOption, toggleInput } from "../../support/ui";

/*
 * 活动表单弹窗：字段、保存前的拦截规则、投票/抽奖两个分支表单、附件上传。
 *
 * 这里的重点是「保存按钮到底把什么写进了数据库」。表单上每个控件都对应
 * 一个落库字段，用例填完之后一律回读 GET /api/events/:id 逐个核对——
 * 只断言弹窗关掉了是验不出「某个字段被丢在前端」这种缺陷的。
 *
 * 时间用固定的远期日期，不用相对时间：datetime-local 是本地时区的字面量，
 * 服务端存 UTC，来回换算一旦写在用例里，跑测试的机器换个时区就红。
 * 只断言「表单里填的那个本地时刻 == 服务端存的那个瞬间」，换算交给被测代码。
 */

const CREATE_EVENT = { method: "POST", path: /^\/api\/events$/ } as const;
const UPDATE_EVENT = { method: "PATCH", path: /^\/api\/events\/[^/]+$/ } as const;
const UPLOAD_IMAGES = { method: "POST", path: /^\/api\/events\/[^/]+\/images$/ } as const;

const START_LOCAL = "2027-05-01T18:00";
const END_LOCAL = "2027-05-01T20:00";

type ServerEvent = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  capacity: number | null;
  auto_archive: boolean;
  attachments: string[];
  winner_count?: number | null;
  poll?: {
    results_visibility: string;
    show_voter_names: boolean;
    options: { label: string }[];
  } | null;
};

let stamp: number;

test.beforeEach(async ({ page }) => {
  stamp = Date.now();
  await page.goto(`/events?search=${stamp}`);
  await expect(page.getByRole("button", { name: "Create Event", exact: true })).toBeVisible();
});

test.afterEach(async ({ api }) => {
  const list = await readJson(
    await api.get(`/api/events?search=${stamp}&limit=50`),
    "回读待清理的活动",
  ) as { data: { id: string }[] };
  for (const entry of list.data) {
    const response = await api.delete(`/api/events/${entry.id}/destroy`);
    expect([200, 204, 404], `清理活动返回 ${response.status()}`).toContain(response.status());
  }
});

async function openCreateModal(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Create Event", exact: true }).click();
  const modal = dialogTitled(page, "Create Event");
  await expect(modal).toBeVisible();
  return modal;
}

/** 弹窗里的提交按钮和页面上的「Create Event」同名，必须限定在弹窗里取。 */
function submitButton(modal: Locator, name: string): Locator {
  return modal.getByRole("button", { name, exact: true });
}

async function readEvent(api: APIRequestContext, id: string): Promise<ServerEvent> {
  return await readJson(await api.get(`/api/events/${id}`), `回读活动 ${id}`) as ServerEvent;
}

/**
 * 把表单里填的「本地时刻」换成毫秒。
 * datetime-local 没有时区，浏览器按自己的时区把它变成瞬间；
 * 而浏览器上下文被 playwright.config.ts 钉死在 UTC（否则跑测试的机器一换时区，
 * 所有时间断言都会跟着漂）。Node 进程用的却是本机时区，直接 new Date(value)
 * 得到的是另一个瞬间——差出来的正好是本机时区偏移，看起来像服务端存错了。
 * 所以这里显式按 UTC 解析，和被测浏览器保持同一套口径。
 */
function localToMs(value: string): number {
  return Date.parse(`${value}:00Z`);
}

test("保存前的拦截：标题、类型、时间先后三条规则各自独立生效", async ({ page }) => {
  const modal = await openCreateModal(page);
  const submit = submitButton(modal, "Create Event");

  /*
   * 开始和结束是打开弹窗时就预填好的（一小时后、再加两小时，
   * useEventsEditorController.openCreateEditor），所以这里只有标题和类型是空的。
   * 也正因为预填，改时间必须成对改：只改开始会一瞬间变成「结束早于开始」。
   */
  await expect(field(modal, "Start")).not.toHaveValue("");
  await expect(field(modal, "End")).not.toHaveValue("");
  await expect(submit, "标题和类型都没填，保存必须按不动").toBeDisabled();

  await field(modal, "Event title").fill(`${SYSTEM_TEST_CONTENT_MARKER} Guard ${stamp}`);
  await expect(submit, "只有标题、没有类型，仍然不能保存").toBeDisabled();

  await selectOption(modal, "Event type", "Social");
  await expect(submit).toBeEnabled();

  // 结束早于开始必须当场报错，而不是等服务端拒绝。
  await field(modal, "Start").fill(START_LOCAL);
  await field(modal, "End").fill("2027-04-30T18:00");
  await expect(modal.getByText("End time must be after start time", { exact: true })).toBeVisible();
  await expect(submit, "时间反了还能提交的话，就会写进一条不可能的活动").toBeDisabled();

  await field(modal, "End").fill(END_LOCAL);
  await expect(submit).toBeEnabled();

  // 标题清空后错误提示要回来，禁用状态也要回来。
  await field(modal, "Event title").fill("");
  await expect(modal.getByText("Title is required", { exact: true })).toBeVisible();
  await expect(submit).toBeDisabled();
});

test("新建普通活动：六个字段一次性落库，卡片随即出现在列表里", async ({ page, flow, api }) => {
  const modal = await openCreateModal(page);
  const title = `${SYSTEM_TEST_CONTENT_MARKER} Form ${stamp}`;

  await field(modal, "Event title").fill(title);
  await selectOption(modal, "Event type", "Weekly Mission");
  await field(modal, "Start").fill(START_LOCAL);
  await field(modal, "End").fill(END_LOCAL);
  await field(modal, "Capacity").fill("12");
  await field(modal, "Description").fill("created by e2e");
  await toggleInput(modal, "Auto archive").check();

  const created = await flow.click(submitButton(modal, "Create Event"), CREATE_EVENT) as { id: string };

  const persisted = await readEvent(api, created.id);
  expect(persisted.title).toBe(title);
  expect(persisted.type).toBe("weekly_mission");
  expect(persisted.description).toBe("created by e2e");
  expect(persisted.capacity, "容量填了就必须存成数字，不能变成 null").toBe(12);
  expect(persisted.auto_archive).toBe(true);
  expect(Date.parse(persisted.start_at), "开始时间必须就是表单里那个本地时刻").toBe(localToMs(START_LOCAL));
  expect(Date.parse(persisted.end_at ?? "")).toBe(localToMs(END_LOCAL));

  await expect(dialogTitled(page, "Create Event"), "保存成功后弹窗必须自己关掉").toHaveCount(0);
  await expect(page.locator(".event-card").filter({ hasText: title })).toHaveCount(1);
});

test("编辑保存：改过的字段落库，没碰的字段原样保留", async ({ page, flow, api }) => {
  const title = `${SYSTEM_TEST_CONTENT_MARKER} Edit ${stamp}`;
  const created = await readJson(
    await api.post("/api/events", {
      data: {
        type: "social",
        title,
        description: "untouched",
        start_at: new Date(START_LOCAL).toISOString(),
        end_at: new Date(END_LOCAL).toISOString(),
        capacity: 5,
      },
    }),
    "创建待编辑的活动",
  ) as { id: string };
  await page.reload();

  const card = page.locator(".event-card").filter({ hasText: title });
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "Event actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();

  const modal = dialogTitled(page, "Edit Event");
  await expect(modal).toBeVisible();
  await expect(field(modal, "Capacity"), "编辑态必须带出现值").toHaveValue("5");

  const renamed = `${title} renamed`;
  await field(modal, "Event title").fill(renamed);
  await field(modal, "Capacity").fill("30");
  await flow.click(submitButton(modal, "Save"), UPDATE_EVENT);

  const persisted = await readEvent(api, created.id);
  expect(persisted.title).toBe(renamed);
  expect(persisted.capacity).toBe(30);
  expect(persisted.description, "没动过的字段不该被保存顺手清掉").toBe("untouched");
  await expect(page.locator(".event-card").filter({ hasText: renamed })).toHaveCount(1);
});

test("投票活动：选项数量的增删规则、两条不足即拦截，选项与可见性一起落库", async ({ page, flow, api }) => {
  const modal = await openCreateModal(page);
  const title = `${SYSTEM_TEST_CONTENT_MARKER} Poll ${stamp}`;

  await field(modal, "Event title").fill(title);
  await selectOption(modal, "Event type", "Poll");
  await field(modal, "Start").fill(START_LOCAL);
  await field(modal, "End").fill(END_LOCAL);

  const submit = submitButton(modal, "Create Event");
  await expect(submit, "两个选项都还空着，不能建").toBeDisabled();

  // 初始就是两个空选项；两个的时候不允许再删，否则会掉到一个选项的非法状态。
  const removeButtons = modal.getByRole("button", { name: "Remove option", exact: true });
  await expect(removeButtons).toHaveCount(2);
  await expect(removeButtons.first()).toBeDisabled();

  await modal.getByPlaceholder("Option 1", { exact: true }).fill("Alpha");
  await expect(submit, "只填了一个选项还是不能建").toBeDisabled();
  await modal.getByPlaceholder("Option 2", { exact: true }).fill("Beta");
  await expect(submit).toBeEnabled();

  // 加出来的第三个选项可以删掉，删完回到两个。
  await modal.getByRole("button", { name: "Add option", exact: true }).click();
  await expect(removeButtons).toHaveCount(3);
  await expect(removeButtons.first(), "超过两个之后才允许删").toBeEnabled();
  await removeButtons.last().click();
  await expect(removeButtons).toHaveCount(2);

  /*
   * 截止时间是预填的，正常路径下点不出「没有截止时间」这个状态，
   * 但它是投票能不能结算的前提，所以这里手动清空一次把规则钉住。
   */
  await field(modal, "End").fill("");
  await expect(submit, "投票必须有截止时间，否则永远不会结算").toBeDisabled();
  await field(modal, "End").fill(END_LOCAL);
  await expect(submit).toBeEnabled();

  await selectOption(modal, "Results visibility", "Always visible");
  await toggleInput(modal, "Show voter names").check();

  const created = await flow.click(submit, CREATE_EVENT) as { id: string };

  const persisted = await readEvent(api, created.id);
  expect(persisted.type).toBe("poll");
  expect(persisted.poll?.options.map((option) => option.label), "选项文本要原样落库").toEqual(["Alpha", "Beta"]);
  expect(persisted.poll?.results_visibility).toBe("always");
  expect(persisted.poll?.show_voter_names).toBe(true);
});

test("抽奖活动：中奖人数不填就拦下，填了才落库", async ({ page, flow, api }) => {
  const modal = await openCreateModal(page);
  const title = `${SYSTEM_TEST_CONTENT_MARKER} Raffle ${stamp}`;

  await field(modal, "Event title").fill(title);
  await selectOption(modal, "Event type", "Raffle");
  await field(modal, "Start").fill(START_LOCAL);
  await field(modal, "End").fill(END_LOCAL);

  const submit = submitButton(modal, "Create Event");
  await expect(submit, "不知道要抽几个人，抽奖就没法开").toBeDisabled();

  await field(modal, "Number of Winners").fill("3");
  await expect(submit).toBeEnabled();

  const created = await flow.click(submit, CREATE_EVENT) as { id: string };

  const persisted = await readEvent(api, created.id);
  expect(persisted.type).toBe("raffle");
  expect(persisted.winner_count).toBe(3);
});

test("附件：新建时选的图跟着创建请求一起上传，编辑时补图走独立上传接口", async ({ page, flow, api }) => {
  const modal = await openCreateModal(page);
  const title = `${SYSTEM_TEST_CONTENT_MARKER} Media ${stamp}`;

  await field(modal, "Event title").fill(title);
  await selectOption(modal, "Event type", "Social");
  await field(modal, "Start").fill(START_LOCAL);
  await field(modal, "End").fill(END_LOCAL);

  await expect(modal.getByText("Attachments (0/5)", { exact: true })).toBeVisible();
  await modal.locator("input[type='file']").setInputFiles(webpUpload(`e2e-create-${stamp}.webp`));
  await expect(
    modal.getByText("Attachments (1/5)", { exact: true }),
    "选完文件要先在本地排队，计数就是它唯一的凭据",
  ).toBeVisible();

  const created = await flow.click(submitButton(modal, "Create Event"), CREATE_EVENT) as { id: string };
  expect(
    (await readEvent(api, created.id)).attachments,
    "新建时选的图必须随创建请求一起落库",
  ).toHaveLength(1);

  // 编辑态再补一张：这次走的是 POST /api/events/:id/images，然后才 PATCH。
  const card = page.locator(".event-card").filter({ hasText: title });
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "Event actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();

  const editModal = dialogTitled(page, "Edit Event");
  await expect(editModal.getByText("Attachments (1/5)", { exact: true })).toBeVisible();
  await editModal.locator("input[type='file']").setInputFiles(webpUpload(`e2e-edit-${stamp}.webp`));
  await expect(editModal.getByText("Attachments (2/5)", { exact: true })).toBeVisible();

  await flow.act(
    () => submitButton(editModal, "Save").click(),
    UPLOAD_IMAGES,
  );

  await expect(dialogTitled(page, "Edit Event")).toHaveCount(0);
  expect(
    (await readEvent(api, created.id)).attachments,
    "编辑时补的图要接在原有附件后面，而不是把它顶掉",
  ).toHaveLength(2);
});
