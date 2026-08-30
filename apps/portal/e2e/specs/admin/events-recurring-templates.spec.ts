import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { webpUpload } from "../../support/files";
import { confirmDialog, field, selectOption, setToggle } from "../../support/ui";

/*
 * 周期模板任务页：模板的建、改、暂停、恢复、删，以及三个筛选控件。
 *
 * 模板本身不产生活动——生成由共享的定时任务负责，
 * 所以这里能断言的「真效果」就是模板那一行：每条用例都回读 /api/events/templates/list，
 * 逐字段跟表单里填的对上，而不是看一句「Template created」。
 *
 * 时间字段是本地墙钟时间，提交前按本机时区折成 UTC（localTimeToUtcTime）。
 * 浏览器上下文被 playwright.config.ts 钉死在 UTC，所以这里填什么就该存什么；
 * 一旦这个换算写反了，断言会立刻红——这正是要它钉在 UTC 的原因。
 */

const CREATE_TEMPLATE = { method: "POST", path: /^\/api\/events\/templates$/ } as const;
const UPDATE_TEMPLATE = { method: "PATCH", path: /^\/api\/events\/templates\/[^/]+$/ } as const;
const PAUSE_TEMPLATE = { method: "POST", path: /^\/api\/events\/templates\/[^/]+\/pause$/ } as const;
const RESUME_TEMPLATE = { method: "POST", path: /^\/api\/events\/templates\/[^/]+\/resume$/ } as const;
const DELETE_TEMPLATE = { method: "DELETE", path: /^\/api\/events\/templates\/[^/]+$/ } as const;

type ServerTemplate = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  start_time: string;
  duration_minutes: number | null;
  capacity: number | null;
  recurrence_rule: {
    frequency: string;
    interval: number;
    daysOfWeek?: number[];
    dayOfMonth?: number;
    endAfter?: number;
    endDate?: string;
  };
  visibility_offset_minutes: number;
  auto_archive: boolean;
  attachments: string[];
  paused: boolean;
};

let stamp: number;
let title: string;

test.beforeEach(() => {
  stamp = Date.now();
  title = `${SYSTEM_TEST_CONTENT_MARKER} Template ${stamp}`;
});

test.afterEach(async ({ api }) => {
  for (const template of await listTemplates(api)) {
    if (!template.title.includes(String(stamp))) continue;
    const response = await api.delete(`/api/events/templates/${template.id}`);
    expect([200, 204, 404], `清理模板返回 ${response.status()}`).toContain(response.status());
  }
});

async function listTemplates(api: APIRequestContext): Promise<ServerTemplate[]> {
  const body = await readJson(await api.get("/api/events/templates/list"), "回读模板列表") as { data: ServerTemplate[] };
  return body.data;
}

/** 按标题回读那一条模板。找不到就直接失败——静默返回 undefined 会让后面的断言全部变成摆设。 */
async function readTemplate(api: APIRequestContext, templateTitle = title): Promise<ServerTemplate> {
  const match = (await listTemplates(api)).find((template) => template.title === templateTitle);
  expect(match, `服务端没有标题为「${templateTitle}」的模板`).toBeTruthy();
  return match!;
}

async function createTemplate(api: APIRequestContext, extra: Record<string, unknown> = {}): Promise<ServerTemplate> {
  return await readJson(
    await api.post("/api/events/templates", {
      data: {
        type: "social",
        title,
        start_time: "09:00",
        recurrence_rule: { frequency: "weekly", interval: 1, daysOfWeek: [1] },
        ...extra,
      },
    }),
    "创建模板",
  ) as ServerTemplate;
}

async function openRecurringView(page: Page): Promise<void> {
  await page.goto("/events/recurring");
  const workspace = page.getByRole("navigation", { name: "Events workspace", exact: true });
  await expect(workspace.getByRole("button", { name: "Recurring templates", exact: true })).toHaveAttribute("aria-current", "page");
}

/** 模板卡片。整张卡片被一个覆盖层按钮盖住，点它就是编辑。 */
function templateCard(page: Page, cardTitle = title): Locator {
  return page.locator(".recurring-template-row").filter({ hasText: cardTitle });
}

function editOverlay(page: Page, cardTitle = title): Locator {
  return page.getByRole("button", { name: `Edit recurring template ${cardTitle}`, exact: true });
}

/**
 * 模板编辑页承载字段和可见的保存操作；危险确认仍由全局确认框处理。
 */
function templateEditor(page: Page): Locator {
  return page.locator(".recurring-template-editor-page");
}

test("新建模板：必填项不齐就存不了，填齐之后每个字段都按填的样子落库", async ({ page, flow, api }) => {
  await openRecurringView(page);
  await page.getByRole("button", { name: "Create Template", exact: true }).click();

  await expect(page).toHaveURL(/\/events\/recurring\/new$/);
  const editor = templateEditor(page);
  await expect(editor).toBeVisible();

  const submit = editor.getByRole("button", { name: "Create Template", exact: true });
  await expect(submit, "标题和类型都还空着，这时能提交就是把校验形同虚设").toBeDisabled();

  await field(editor, "Event title").fill(title);
  await expect(submit, "只填标题还差类型").toBeDisabled();
  await selectOption(editor, "Event type", "Social");
  await expect(submit).toBeEnabled();

  await field(editor, "Description").fill(`desc ${stamp}`);
  await field(editor, "Start time").fill("18:30");
  await selectOption(editor, "Duration unit", "Minutes");
  await field(editor, "Duration").fill("90");
  await field(editor, "Capacity").fill("24");

  // 重复规则：每 2 周，只在周二。默认勾的是周一/周三/周五，得先摘干净。
  await field(editor, "Repeat every").fill("2");
  for (const day of ["Mon", "Wed", "Fri"]) {
    await editor.getByRole("button", { name: day, exact: true }).click();
  }
  await editor.getByRole("button", { name: "Tue", exact: true }).click();
  await expect(
    editor.locator("button[aria-pressed='true']"),
    "只该剩周二一个被选中",
  ).toHaveText(["Tue"]);

  // 结束条件：重复 5 次后停。先选结束方式，次数框才会出现。
  await selectOption(editor, "Ends", "After a number of times");
  await field(editor, "End after occurrences").fill("5");

  // 提前创建：开始前 1 天 2 小时 30 分。
  await field(editor, "Create event before start (Days)").fill("1");
  await field(editor, "Create event before start (Hours)").fill("2");
  await field(editor, "Create event before start (Minutes)").fill("30");

  await setToggle(editor, "Auto archive", true);
  await editor.locator("input[type='file']").setInputFiles(webpUpload(`template-create-${stamp}.webp`));
  await expect(editor.getByText("Attachments (1/5)", { exact: true })).toBeVisible();

  await flow.click(submit, CREATE_TEMPLATE);
  await expect(page).toHaveURL(/\/events\/recurring$/);

  const saved = await readTemplate(api);
  expect(saved.type).toBe("social");
  expect(saved.description).toBe(`desc ${stamp}`);
  expect(saved.start_time, "浏览器时区被钉在 UTC，填什么就该存什么").toBe("18:30");
  expect(saved.duration_minutes, "90 分钟不该被当成 90 小时").toBe(90);
  expect(saved.capacity).toBe(24);
  expect(saved.recurrence_rule.frequency).toBe("weekly");
  expect(saved.recurrence_rule.interval).toBe(2);
  expect(saved.recurrence_rule.daysOfWeek, "周二是 2").toEqual([2]);
  expect(saved.recurrence_rule.endAfter).toBe(5);
  expect(saved.visibility_offset_minutes, "1 天 2 小时 30 分 = 1590 分钟").toBe(1590);
  expect(saved.auto_archive).toBe(true);
  expect(saved.attachments).toHaveLength(1);
  expect(saved.paused, "新建的模板应当是启用状态").toBe(false);

  const card = templateCard(page);
  await expect(card).toContainText("18:30");
  await expect(card).toContainText("Every 2 week(s) on Tue");
  await expect(card).toContainText("24");
  await expect(card.getByText("Active", { exact: true })).toBeVisible();

  await editOverlay(page).click();
  await expect(templateEditor(page).getByText("Attachments (1/5)", { exact: true })).toBeVisible();
  await templateEditor(page).getByRole("button", { name: "Back to template list", exact: true }).click();
  await expect(page).toHaveURL(/\/events\/recurring$/);
});

test("编辑模板：改动落到服务端，没碰的字段一个也不能丢", async ({ page, flow, api }) => {
  const created = await createTemplate(api, {
    description: `keep ${stamp}`,
    capacity: 10,
    duration_minutes: 120,
  });

  await openRecurringView(page);
  await editOverlay(page).click();

  await expect(page).toHaveURL(/\/events\/recurring\/[^/]+\/edit$/);
  const editor = templateEditor(page);
  await expect(editor).toBeVisible();
  await expect(
    field(editor, "Event title"),
    "编辑态必须带出现值，否则保存会把别的字段覆盖掉",
  ).toHaveValue(title);
  await expect(field(editor, "Start time")).toHaveValue("09:00");
  await expect(field(editor, "Capacity")).toHaveValue("10");

  const renamed = `${title} renamed`;
  await field(editor, "Event title").fill(renamed);
  await field(editor, "Capacity").fill("30");
  await selectOption(editor, "Repeat frequency", "Day");
  await editor.locator("input[type='file']").setInputFiles(webpUpload(`template-edit-${stamp}.webp`));
  await expect(editor.getByText("Attachments (1/5)", { exact: true })).toBeVisible();

  await flow.click(editor.getByRole("button", { name: "Save", exact: true }), UPDATE_TEMPLATE);
  await expect(page).toHaveURL(/\/events\/recurring$/);

  const saved = await readTemplate(api, renamed);
  expect(saved.id, "编辑不该另起一条").toBe(created.id);
  expect(saved.capacity).toBe(30);
  expect(saved.recurrence_rule.frequency).toBe("daily");
  expect(saved.description, "没动过的描述必须原样保留").toBe(`keep ${stamp}`);
  expect(saved.duration_minutes, "没动过的时长也一样").toBe(120);
  expect(saved.attachments).toHaveLength(1);

  await expect(templateCard(page, renamed)).toContainText("Every 1 day(s)");
});

test("暂停与恢复：徽章和服务端的 paused 一起翻转", async ({ page, flow, api }) => {
  await createTemplate(api);
  await openRecurringView(page);
  await expect(templateCard(page).getByText("Active", { exact: true })).toBeVisible();

  await editOverlay(page).click();
  await flow.click(
    templateEditor(page).getByRole("button", { name: "Pause", exact: true }),
    PAUSE_TEMPLATE,
  );
  await expect(page).toHaveURL(/\/events\/recurring$/);

  expect((await readTemplate(api)).paused, "服务端必须真的暂停").toBe(true);
  await expect(templateCard(page).getByText("Paused", { exact: true })).toBeVisible();

  // 暂停之后按钮要变成反向操作，否则用户会以为再点一次还是暂停。
  await editOverlay(page).click();
  const editor = templateEditor(page);
  await expect(editor.getByRole("button", { name: "Pause", exact: true })).toHaveCount(0);
  await flow.click(editor.getByRole("button", { name: "Resume", exact: true }), RESUME_TEMPLATE);
  await expect(page).toHaveURL(/\/events\/recurring$/);

  expect((await readTemplate(api)).paused).toBe(false);
  await expect(templateCard(page).getByText("Active", { exact: true })).toBeVisible();
});

test("删除模板：取消什么都不做，确认后服务端和列表里都不再有它", async ({ page, flow, api }) => {
  const created = await createTemplate(api);
  await openRecurringView(page);

  await editOverlay(page).click();
  const editor = templateEditor(page);
  await editor.getByRole("button", { name: "Delete Template", exact: true }).click();
  await (await confirmDialog(page, "Delete template?"))
    .getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    (await listTemplates(api)).some((template) => template.id === created.id),
    "取消确认后模板必须还在",
  ).toBe(true);

  await editor.getByRole("button", { name: "Delete Template", exact: true }).click();
  await flow.act(
    async () => {
      await (await confirmDialog(page, "Delete template?"))
        .getByRole("button", { name: "Confirm", exact: true }).click();
    },
    DELETE_TEMPLATE,
  );

  expect(
    (await listTemplates(api)).some((template) => template.id === created.id),
    "确认后服务端必须真的删掉",
  ).toBe(false);
  await expect(templateCard(page)).toHaveCount(0);
});
