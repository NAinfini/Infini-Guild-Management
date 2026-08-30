import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { catalogRevisionToken } from "@guild/shared";
import { uniqueTag } from "../../support/members";
import { expect, readJson, test } from "../../support/test";
import { appSiderNavigationItem, confirmDialog, expectNoDialog, expectToast, field } from "../../support/ui";

/*
 * 职业标签和职业目录共用同一后台页签，但各自有独立的主从编辑台。
 *
 * 这里所有职业和标签均由本条用例创建；管理员项目会把它们登记到系统测试运行中，
 * 由统一清理器按主键回收。重排会改动整张已有目录，所以仍要在本条用例 finally
 * 里精确恢复原顺序。
 */

const CREATE_CLASS_TAG = { method: "POST", path: /^\/api\/class-tags$/, status: 201 } as const;
const UPDATE_CLASS_TAG = { method: "PATCH", path: /^\/api\/class-tags\/[^/]+$/ } as const;
const DELETE_CLASS_TAG = { method: "DELETE", path: /^\/api\/class-tags\/[^/]+$/ } as const;
const REORDER_CLASS_TAGS = { method: "PATCH", path: /^\/api\/class-tags\/reorder$/ } as const;

type ServerClass = {
  id: string;
  label: string;
};

type ServerClassTag = {
  id: string;
  label: string;
  class_ids: string[];
  sort_order: number;
  usage_count: number;
  updated_at: string;
};

function master(page: Page): Locator {
  return page.locator(".admin-md__master");
}

function detail(page: Page): Locator {
  return page.locator(".admin-md__detail");
}

function switcher(page: Page): Locator {
  return page.getByRole("group", {
    name: "Switch between the class catalog and class tags",
    exact: true,
  });
}

function tagItem(page: Page, label: string): Locator {
  return master(page).locator(".admin-md__item").filter({ hasText: label });
}

function newTagButton(page: Page): Locator {
  return master(page)
    .locator(".admin-md__master-head")
    .getByRole("button", { name: "New tag", exact: true });
}

function saveTagButton(page: Page): Locator {
  return detail(page).getByRole("button", { name: "Save tag", exact: true });
}

async function createServerClass(api: APIRequestContext, label: string): Promise<ServerClass> {
  return await readJson(
    await api.post("/api/classes", {
      data: { label, color: "#8594A8", vector_icon: "shield" },
    }),
    `创建职业 ${label}`,
  ) as ServerClass;
}

async function createServerTag(
  api: APIRequestContext,
  label: string,
  classIds: string[] = [],
): Promise<ServerClassTag> {
  return await readJson(
    await api.post("/api/class-tags", { data: { label, class_ids: classIds } }),
    `创建职业标签 ${label}`,
  ) as ServerClassTag;
}

async function serverTags(api: APIRequestContext): Promise<ServerClassTag[]> {
  return await readJson(await api.get("/api/class-tags"), "读取职业标签目录") as ServerClassTag[];
}

async function serverTag(api: APIRequestContext, id: string): Promise<ServerClassTag> {
  const found = (await serverTags(api)).find((tag) => tag.id === id);
  expect(found, `服务端找不到职业标签 ${id}`).toBeTruthy();
  return found as ServerClassTag;
}

async function openClassTags(page: Page): Promise<void> {
  await page.goto("/admin?tab=classes");
  await expect(appSiderNavigationItem(page, "Classes")).toHaveAttribute("aria-current", "page");
  await expect(switcher(page)).toBeVisible();

  const tags = switcher(page).getByRole("button", { name: "Class tags", exact: true });
  if ((await tags.getAttribute("aria-pressed")) !== "true") await tags.click();

  await expect(tags).toHaveAttribute("aria-pressed", "true");
  await expect(newTagButton(page)).toBeVisible();
}

test("职业目录与标签切换：从标签台创建分组，职业成员和服务端记录一起落地", async ({ page, api, flow }) => {
  const item = await createServerClass(api, `E2E ${uniqueTag("tag-class")}`);
  const label = `E2E ${uniqueTag("tag-create")}`;

  await openClassTags(page);
  await expect(switcher(page).getByRole("button", { name: "Class catalog", exact: true }))
    .toHaveAttribute("aria-pressed", "false");

  await newTagButton(page).click();
  await expect(detail(page).getByText("Create tag", { exact: true })).toBeVisible();
  await expect(saveTagButton(page), "未填写标签时不应允许提交").toBeDisabled();

  await field(detail(page), "Tag name").fill(label);
  const member = detail(page).getByRole("checkbox", { name: item.label, exact: true });
  await member.click();
  await expect(member, "勾选职业就是标签成员关系，不能只改前端草稿").toBeChecked();
  await expect(saveTagButton(page)).toBeEnabled();

  const created = await flow.click(saveTagButton(page), CREATE_CLASS_TAG) as ServerClassTag;
  await expectToast(page, "Tag saved");

  const saved = await serverTag(api, created.id);
  expect(saved.label).toBe(label);
  expect(saved.class_ids).toEqual([item.id]);
  await expect(tagItem(page, label), "保存后左侧目录必须立即出现新标签").toBeVisible();

  await switcher(page).getByRole("button", { name: "Class catalog", exact: true }).click();
  await expect(switcher(page).getByRole("button", { name: "Class catalog", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(master(page).locator(".admin-md__item").filter({ hasText: item.label }))
    .toBeVisible();
});

test("编辑标签：搜索职业后重命名保留成员；取消删除不写入，确认后服务端删除", async ({ page, api, flow }) => {
  const matched = await createServerClass(api, `E2E ${uniqueTag("tag-match")}`);
  const hidden = await createServerClass(api, `E2E ${uniqueTag("tag-hidden")}`);
  const tag = await createServerTag(api, `E2E ${uniqueTag("tag-edit")}`, [matched.id]);
  const renamed = `${tag.label} v2`;

  await openClassTags(page);
  await tagItem(page, tag.label).click();
  await expect(field(detail(page), "Tag name")).toHaveValue(tag.label);

  const search = detail(page).getByRole("textbox", { name: "Search classes", exact: true });
  await search.fill(matched.label);
  await expect(detail(page).getByRole("checkbox", { name: matched.label, exact: true })).toBeChecked();
  await expect(detail(page).getByRole("checkbox", { name: hidden.label, exact: true }))
    .toHaveCount(0);

  await field(detail(page), "Tag name").fill(renamed);
  await flow.click(saveTagButton(page), UPDATE_CLASS_TAG);
  await expectToast(page, "Tag saved");

  const saved = await serverTag(api, tag.id);
  expect(saved.label).toBe(renamed);
  expect(saved.class_ids, "搜索不能丢掉未改动的标签成员").toEqual([matched.id]);
  expect(saved.sort_order, "编辑标签不应改变目录顺序").toBe(tag.sort_order);
  await expect(tagItem(page, renamed)).toBeVisible();

  await detail(page).getByRole("button", { name: "Delete tag", exact: true }).click();
  const cancelled = await confirmDialog(page, "Delete class tag?");
  await expect(cancelled).toContainText(renamed);
  await flow.clickWithoutApi(cancelled.getByRole("button", { name: "Cancel", exact: true }));
  await expectNoDialog(page);
  await expect(tagItem(page, renamed), "取消删除后标签必须保留").toBeVisible();

  await detail(page).getByRole("button", { name: "Delete tag", exact: true }).click();
  const confirmed = await confirmDialog(page, "Delete class tag?");
  await flow.click(confirmed.getByRole("button", { name: "Delete tag", exact: true }), DELETE_CLASS_TAG);
  await expectToast(page, "Tag deleted");

  expect((await serverTags(api)).some((row) => row.id === tag.id), "服务端不能继续返回已删除标签").toBe(false);
  await expect(tagItem(page, renamed)).toHaveCount(0);
  await expect(detail(page).getByText("Select a tag to edit", { exact: true })).toBeVisible();
});

test("键盘重排：完整标签目录一次写入并持久化，结束后恢复原顺序", async ({ page, api, flow }) => {
  await createServerTag(api, `E2E ${uniqueTag("tag-sort-a")}`);
  await createServerTag(api, `E2E ${uniqueTag("tag-sort-b")}`);
  const beforeRows = await serverTags(api);
  const before = beforeRows.map((tag) => tag.id);
  const expected = [before[1] as string, before[0] as string, ...before.slice(2)];

  try {
    await openClassTags(page);
    const rows = master(page).locator(".admin-md__row");
    await expect(rows).toHaveCount(before.length);

    const firstRow = rows.first();
    const transformOf = (row: Locator) => (
      () => row.evaluate((element) => (element as HTMLElement).style.transform)
    );
    const handle = firstRow.getByRole("button", { name: /^Drag to reorder / });

    await handle.focus();
    await page.keyboard.press("Space");
    await expect(handle, "空格应拿起当前标签").toHaveAttribute("aria-pressed", "true");
    await expect.poll(transformOf(firstRow), "拖拽上下文应接管当前行").not.toBe("");

    await page.keyboard.press("ArrowDown");
    await expect.poll(transformOf(rows.nth(1)), "第二行被顶开后才说明悬停目标已确定")
      .not.toMatch(/translate3d\(0px, 0px/);

    const sent = await flow.act(
      () => page.keyboard.press("Space"),
      REORDER_CLASS_TAGS,
    ) as ServerClassTag[];
    await expect(handle, "再次按空格应放下标签").not.toHaveAttribute("aria-pressed", "true");

    expect(sent.map((tag) => tag.id)).toEqual(expected);
    expect(sent.map((tag) => tag.sort_order)).toEqual(expected.map((_, index) => index * 10));
    expect((await serverTags(api)).map((tag) => tag.id), "刷新后顺序仍必须一致").toEqual(expected);
    await expect(rows.first()).toContainText(sent[0]?.label as string);
  } finally {
    const current = await serverTags(api);
    const restored = await api.patch("/api/class-tags/reorder", {
      data: { order: before, expected_revision_token: catalogRevisionToken(current) },
    });
    expect(restored.ok(), "恢复职业标签顺序失败会污染后续用例").toBe(true);
  }
});
