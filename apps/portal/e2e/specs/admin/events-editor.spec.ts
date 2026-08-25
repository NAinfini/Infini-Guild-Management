import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { webpUpload } from "../../support/files";
import { confirmDialog, field, selectOption, setToggle } from "../../support/ui";

/*
 * 活动编辑器由 /events/new 和 /events/:id/edit 路由承载。每次保存后都回读
 * 服务端，确保页面跳转没有掩盖持久化字段遗漏的问题。
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

test.beforeEach(() => {
  stamp = Date.now();
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

function eventEditor(page: Page): Locator {
  return page.locator(".event-editor-page");
}

async function openCreateEditor(page: Page): Promise<Locator> {
  await page.goto("/events/new");
  await expect(page).toHaveURL(/\/events\/new$/);
  const editor = eventEditor(page);
  await expect(editor).toBeVisible();
  return editor;
}

function submitButton(editor: Locator, name: string): Locator {
  return editor.getByRole("button", { name, exact: true });
}

async function readEvent(api: APIRequestContext, id: string): Promise<ServerEvent> {
  return await readJson(await api.get(`/api/events/${id}`), `回读活动 ${id}`) as ServerEvent;
}

function localToMs(value: string): number {
  return Date.parse(`${value}:00Z`);
}

test("创建路由：标题、类型、时间三条保存前规则独立生效", async ({ page }) => {
  const editor = await openCreateEditor(page);
  const submit = submitButton(editor, "Create Event");

  await expect(field(editor, "Start")).not.toHaveValue("");
  await expect(field(editor, "End")).not.toHaveValue("");
  await expect(submit, "标题和类型都没填，保存必须按不动").toBeDisabled();

  await field(editor, "Event title").fill(`${SYSTEM_TEST_CONTENT_MARKER} Guard ${stamp}`);
  await expect(submit, "只有标题、没有类型，仍然不能保存").toBeDisabled();

  await selectOption(editor, "Event type", "Social");
  await expect(submit).toBeEnabled();

  await field(editor, "Start").fill(START_LOCAL);
  await field(editor, "End").fill("2027-04-30T18:00");
  await expect(editor.getByText("End time must be after start time", { exact: true })).toBeVisible();
  await expect(submit, "时间反了还能提交的话，就会写进一条不可能的活动").toBeDisabled();

  await field(editor, "End").fill(END_LOCAL);
  await expect(submit).toBeEnabled();

  await field(editor, "Event title").fill("");
  await expect(editor.getByText("Title is required", { exact: true })).toBeVisible();
  await expect(submit).toBeDisabled();
});

test("新建活动：/events/new 保存后返回列表且字段完整落库", async ({ page, flow, api }) => {
  const editor = await openCreateEditor(page);
  const title = `${SYSTEM_TEST_CONTENT_MARKER} Form ${stamp}`;

  await field(editor, "Event title").fill(title);
  await selectOption(editor, "Event type", "Weekly Mission");
  await field(editor, "Start").fill(START_LOCAL);
  await field(editor, "End").fill(END_LOCAL);
  await field(editor, "Capacity").fill("12");
  await field(editor, "Description").fill("created by e2e");
  await setToggle(editor, "Auto archive", true);

  const created = await flow.click(submitButton(editor, "Create Event"), CREATE_EVENT) as { id: string };

  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByRole("button", { name: "Create Event", exact: true })).toBeVisible();

  const persisted = await readEvent(api, created.id);
  expect(persisted.title).toBe(title);
  expect(persisted.type).toBe("weekly_mission");
  expect(persisted.description).toBe("created by e2e");
  expect(persisted.capacity, "容量填了就必须存成数字，不能变成 null").toBe(12);
  expect(persisted.auto_archive).toBe(true);
  expect(Date.parse(persisted.start_at), "开始时间必须就是表单里那个本地时刻").toBe(localToMs(START_LOCAL));
  expect(Date.parse(persisted.end_at ?? "")).toBe(localToMs(END_LOCAL));

  await page.goto(`/events?search=${stamp}`);
  await expect(page.locator(".event-card").filter({ hasText: title })).toHaveCount(1);
});

test("编辑路由：刷新恢复服务端值，保存后回到对应详情页", async ({ page, flow, api }) => {
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

  await page.goto(`/events/${created.id}/edit`);
  await expect(page).toHaveURL(new RegExp(`/events/${created.id}/edit$`));
  const editor = eventEditor(page);
  await expect(editor).toBeVisible();
  await expect(field(editor, "Capacity"), "编辑态必须带出现值").toHaveValue("5");

  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/events/${created.id}/edit$`));
  await expect(field(eventEditor(page), "Event title")).toHaveValue(title);
  await expect(field(eventEditor(page), "Capacity")).toHaveValue("5");

  const renamed = `${title} renamed`;
  await field(eventEditor(page), "Event title").fill(renamed);
  await field(eventEditor(page), "Capacity").fill("30");
  await flow.click(submitButton(eventEditor(page), "Save"), UPDATE_EVENT);

  await expect(page).toHaveURL(new RegExp(`/events/${created.id}$`));
  await expect(page.locator(".event-detail-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();

  const persisted = await readEvent(api, created.id);
  expect(persisted.title).toBe(renamed);
  expect(persisted.capacity).toBe(30);
  expect(persisted.description, "没动过的字段不该被保存顺手清掉").toBe("untouched");
});

test("离开有改动的创建路由：可停留或确认离开", async ({ page }) => {
  const editor = await openCreateEditor(page);
  await field(editor, "Event title").fill(`${SYSTEM_TEST_CONTENT_MARKER} Dirty ${stamp}`);

  await editor.locator(".event-route-header__back").click();
  await (await confirmDialog(page, "Unsaved changes"))
    .getByRole("button", { name: "Stay on page", exact: true }).click();
  await expect(page).toHaveURL(/\/events\/new$/);
  await expect(eventEditor(page)).toBeVisible();

  await eventEditor(page).locator(".event-route-header__back").click();
  await (await confirmDialog(page, "Unsaved changes"))
    .getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
});

test("投票活动：选项、结束时间和可见性通过路由编辑器落库", async ({ page, flow, api }) => {
  const editor = await openCreateEditor(page);
  const title = `${SYSTEM_TEST_CONTENT_MARKER} Poll ${stamp}`;

  await field(editor, "Event title").fill(title);
  await selectOption(editor, "Event type", "Poll");
  await field(editor, "Start").fill(START_LOCAL);
  await field(editor, "End").fill(END_LOCAL);

  const submit = submitButton(editor, "Create Event");
  await expect(submit, "两个选项都还空着，不能建").toBeDisabled();

  const removeButtons = editor.getByRole("button", { name: "Remove option", exact: true });
  await expect(removeButtons).toHaveCount(2);
  await expect(removeButtons.first()).toBeDisabled();

  await editor.getByPlaceholder("Option 1", { exact: true }).fill("Alpha");
  await expect(submit, "只填了一个选项还是不能建").toBeDisabled();
  await editor.getByPlaceholder("Option 2", { exact: true }).fill("Beta");
  await expect(submit).toBeEnabled();

  await editor.getByRole("button", { name: "Add option", exact: true }).click();
  await expect(removeButtons).toHaveCount(3);
  await expect(removeButtons.first(), "超过两个之后才允许删").toBeEnabled();
  await removeButtons.last().click();
  await expect(removeButtons).toHaveCount(2);

  await field(editor, "End").fill("");
  await expect(submit, "投票必须有截止时间，否则永远不会结算").toBeDisabled();
  await field(editor, "End").fill(END_LOCAL);
  await expect(submit).toBeEnabled();

  await selectOption(editor, "Results visibility", "Always visible");
  await setToggle(editor, "Show voter names", true);

  const created = await flow.click(submit, CREATE_EVENT) as { id: string };
  await expect(page).toHaveURL(/\/events$/);

  const persisted = await readEvent(api, created.id);
  expect(persisted.type).toBe("poll");
  expect(persisted.poll?.options.map((option) => option.label), "选项文本要原样落库").toEqual(["Alpha", "Beta"]);
  expect(persisted.poll?.results_visibility).toBe("always");
  expect(persisted.poll?.show_voter_names).toBe(true);
});

test("抽奖活动：中奖人数在路由编辑器中校验并落库", async ({ page, flow, api }) => {
  const editor = await openCreateEditor(page);
  const title = `${SYSTEM_TEST_CONTENT_MARKER} Raffle ${stamp}`;

  await field(editor, "Event title").fill(title);
  await selectOption(editor, "Event type", "Raffle");
  await field(editor, "Start").fill(START_LOCAL);
  await field(editor, "End").fill(END_LOCAL);

  const submit = submitButton(editor, "Create Event");
  await expect(submit, "不知道要抽几个人，抽奖就没法开").toBeDisabled();

  await field(editor, "Number of Winners").fill("3");
  await expect(submit).toBeEnabled();

  const created = await flow.click(submit, CREATE_EVENT) as { id: string };
  await expect(page).toHaveURL(/\/events$/);

  const persisted = await readEvent(api, created.id);
  expect(persisted.type).toBe("raffle");
  expect(persisted.winner_count).toBe(3);
});

test("附件：新建和编辑路由分别保留并追加图片", async ({ page, flow, api }) => {
  const editor = await openCreateEditor(page);
  const title = `${SYSTEM_TEST_CONTENT_MARKER} Media ${stamp}`;

  await field(editor, "Event title").fill(title);
  await selectOption(editor, "Event type", "Social");
  await field(editor, "Start").fill(START_LOCAL);
  await field(editor, "End").fill(END_LOCAL);

  await expect(editor.getByText("Attachments (0/5)", { exact: true })).toBeVisible();
  await editor.locator("input[type='file']").setInputFiles(webpUpload(`e2e-create-${stamp}.webp`));
  await expect(editor.getByText("Attachments (1/5)", { exact: true })).toBeVisible();

  const created = await flow.click(submitButton(editor, "Create Event"), CREATE_EVENT) as { id: string };
  await expect(page).toHaveURL(/\/events$/);
  expect((await readEvent(api, created.id)).attachments, "新建时选的图必须随创建请求一起落库").toHaveLength(1);

  await page.goto(`/events/${created.id}/edit`);
  await expect(page).toHaveURL(new RegExp(`/events/${created.id}/edit$`));
  const editEditor = eventEditor(page);
  await expect(editEditor.getByText("Attachments (1/5)", { exact: true })).toBeVisible();
  await editEditor.locator("input[type='file']").setInputFiles(webpUpload(`e2e-edit-${stamp}.webp`));
  await expect(editEditor.getByText("Attachments (2/5)", { exact: true })).toBeVisible();

  await flow.act(() => submitButton(editEditor, "Save").click(), UPLOAD_IMAGES);
  await expect(page).toHaveURL(new RegExp(`/events/${created.id}$`));
  expect(
    (await readEvent(api, created.id)).attachments,
    "编辑时补的图要接在原有附件后面，而不是把它顶掉",
  ).toHaveLength(2);
});
