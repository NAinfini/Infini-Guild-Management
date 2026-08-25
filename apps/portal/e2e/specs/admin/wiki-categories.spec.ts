import type { APIRequestContext, Locator, Page, Request } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { confirmDialog, expectNoDialog, field } from "../../support/ui";

/*
 * Wiki 分类编辑器：新建、改名、挂父级、拖拽排序、删除、关闭（含丢弃确认）。
 *
 * 列表本身就是那棵树：缩进即层级，没有单独的树图面板，也没有「父分类」下拉。
 * 层级有两条路——横着拖，或者按行尾的箭头。用例走箭头那条：它是键盘也走得通的路，
 * 而且不像横向拖拽那样把结果压在几十像素的手感上。
 *
 * 这块编辑器是「草稿 + 一次性保存」：改名、改父级、拖顺序都只改前端草稿，
 * 按保存时把所有改动过的行一次性 PATCH 到 /api/wiki/categories/batch。所以每条用例
 * 都分两段验：改的时候服务端不许动，保存之后服务端必须和界面一致。
 *
 * 一个必须写清楚的副作用：拖拽会把所有草稿按新下标重排 sort_order，保存时连种子
 * 分类的 sort_order 一起改写。那不是本用例造出来的数据，清理注册表管不着，
 * 所以排序用例自己把种子的 sort_order 记下来、跑完再还回去，不给后面的用例
 * 留下变了形的站点。
 */

const CREATE_CATEGORY = { method: "POST", path: /^\/api\/wiki\/categories$/ } as const;
const SAVE_CATEGORIES = { method: "PATCH", path: /^\/api\/wiki\/categories\/batch$/ } as const;
const DELETE_CATEGORY = { method: "DELETE", path: /^\/api\/wiki\/categories\/[^/]+$/ } as const;

/* 新建不再要求先填名字，服务端拿到的就是这个默认名（i18n wiki.categoryEditor.defaultName）。 */
const DEFAULT_CATEGORY_NAME = "New Category";

type Category = { id: string; name: string; sort_order: number; parent_id: string | null };

let stamp: number;
let categoryA: Category;
let categoryB: Category;
/** 用例自己新建的分类，afterEach 一并清掉。 */
let extraCategoryIds: string[];
/** 排序用例登记的「跑完要还原的 sort_order」。 */
let sortOrderRestore: Map<string, number>;

test.beforeEach(async ({ api, page }) => {
  stamp = Date.now();
  extraCategoryIds = [];
  sortOrderRestore = new Map();

  categoryA = await createCategory(api, `${SYSTEM_TEST_CONTENT_MARKER} CatA ${stamp}`);
  categoryB = await createCategory(api, `${SYSTEM_TEST_CONTENT_MARKER} CatB ${stamp}`);

  await page.goto("/wiki");
  await expect(page.locator(".wiki-article-list-card")).toBeVisible();
});

test.afterEach(async ({ api }) => {
  for (const [id, sortOrder] of sortOrderRestore) {
    const response = await api.patch(`/api/wiki/categories/${id}`, { data: { sort_order: sortOrder } });
    expect([200, 204, 404], `还原分类 ${id} 的排序返回 ${response.status()}`).toContain(response.status());
  }
  /* 先删子后删父：父分类底下还挂着东西时服务端会拒绝。 */
  for (const id of [...extraCategoryIds, categoryB.id, categoryA.id]) {
    const response = await api.delete(`/api/wiki/categories/${id}`);
    expect([200, 204, 404], `清理分类 ${id} 返回 ${response.status()}`).toContain(response.status());
  }
});

async function createCategory(api: APIRequestContext, name: string): Promise<Category> {
  return await readJson(
    await api.post("/api/wiki/categories", { data: { name } }),
    `创建分类 ${name}`,
  ) as Category;
}

async function readCategories(api: APIRequestContext): Promise<Category[]> {
  return await readJson(await api.get("/api/wiki/categories"), "回读分类表") as Category[];
}

async function readCategory(api: APIRequestContext, id: string): Promise<Category> {
  const found = (await readCategories(api)).find((category) => category.id === id);
  expect(found, `服务端上找不到分类 ${id}`).toBeTruthy();
  return found!;
}

/** 分类编辑器标题是语义二级标题。 */
function categoryEditorTitle(page: Page): Locator {
  return page.getByRole("heading", { name: "Category Editor", exact: true });
}

/*
 * 关闭按钮只在主内容区里找。
 * Toast 门户也可能保留一个 Close 按钮，页面级的
 * getByRole("button", { name: "Close" }) 就同时命中两个，直接 strict mode violation——
 * 报出来像是「点不到关闭按钮」，成因却是「上一步弹的提示还没散」。
 */
function closeEditorButton(page: Page): Locator {
  return page.locator("#main-content").getByRole("button", { name: "Close", exact: true });
}

async function openCategoryEditor(page: Page): Promise<void> {
  await page.locator(".wiki-article-list-card")
    .getByRole("button", { name: "Edit Categories", exact: true }).click();
  await expect(categoryEditorTitle(page)).toBeVisible();
}

/** 每行的名字输入框；卡里只有这一种「Category name」字段。 */
function draftNames(page: Page): Locator {
  return field(page, "Category name");
}

/** 读出草稿列表里当前所有的名字，按行序。 */
async function draftNameValues(page: Page): Promise<string[]> {
  return await draftNames(page).evaluateAll(
    (nodes) => nodes.map((node) => (node as HTMLInputElement).value),
  );
}

/** 行尾的「设为上一个分类的子分类」按钮。 */
function indentButtons(page: Page): Locator {
  return page.getByRole("button", { name: "Make it a child of the category above", exact: true });
}

/** 行尾的「提为顶层分类」按钮。 */
function outdentButtons(page: Page): Locator {
  return page.getByRole("button", { name: "Move to top level", exact: true });
}

function saveButton(page: Page): Locator {
  return page.getByRole("button", { name: "Save", exact: true });
}

/**
 * 按名字找到草稿行的下标。
 * 每一行的字段标题都一样，只能靠值来认；下标不能按 sort_order 猜——
 * 同序号之间按名字排，把排序规则在用例里再实现一遍只会两边一起错。
 */
async function draftRowIndex(page: Page, name: string): Promise<number> {
  const inputs = draftNames(page);
  const count = await inputs.count();
  for (let index = 0; index < count; index += 1) {
    if ((await inputs.nth(index).inputValue()) === name) return index;
  }
  expect(null, `草稿列表里找不到分类「${name}」`).toBeTruthy();
  return -1;
}

/** 点控件并要求它一个写请求都不发（后台的只读重取与这些草稿控件无关）。 */
async function clickWithoutWrite(page: Page, control: Locator): Promise<void> {
  const writes: string[] = [];
  const record = (request: Request): void => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/") && request.method() !== "GET") {
      writes.push(`${request.method()} ${pathname}`);
    }
  };
  page.on("request", record);
  try {
    await control.click();
    await page.waitForTimeout(500);
  } finally {
    page.off("request", record);
  }
  expect(writes, "这个控件本应只改前端草稿，却写了服务端").toEqual([]);
}

/**
 * 用鼠标做一次 dnd-kit 拖拽。
 * 按下之后必须先真的挪开几像素再走，一步跳到终点会被当成点击忽略，
 * 表现成「拖了没反应」；落点要落在目标元素内部，贴边不算。
 */
async function dragRow(page: Page, handle: Locator, target: Locator): Promise<void> {
  const from = await handle.boundingBox();
  expect(from, "拖拽源不在视口里").toBeTruthy();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2 + 12, { steps: 5 });

  const to = await target.boundingBox();
  expect(to, "拖拽目标不在视口里").toBeTruthy();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 });
  await page.mouse.up();
}

test("打开与关闭：铅笔进、Close 出，没改动时不问也不写", async ({ page }) => {
  await openCategoryEditor(page);
  await clickWithoutWrite(page, closeEditorButton(page));
  await expectNoDialog(page);
  await expect(categoryEditorTitle(page)).toHaveCount(0);
});

test("新建分类：一键建出一条默认名的顶层分类，落库并当场进草稿列表", async ({ page, flow, api }) => {
  await openCategoryEditor(page);

  /* 卡头那个「新建」不再依赖输入框：建的时候直接给默认名，改名走行内输入框那条路。 */
  const before = await draftNameValues(page);
  expect(before, "默认名不能已经被占用，否则下面按名字找行会找到别人那条").not.toContain(DEFAULT_CATEGORY_NAME);

  const create = page.getByRole("button", { name: "Create Category", exact: true });
  const created = await flow.click(create, CREATE_CATEGORY) as Category;
  extraCategoryIds.push(created.id);

  expect(created.name, "建出来的就是那个默认名").toBe(DEFAULT_CATEGORY_NAME);
  expect((await readCategories(api)).some((category) => category.id === created.id)).toBe(true);

  await expect(draftNames(page), "新建的分类要当场落进草稿列表").toHaveCount(before.length + 1);
  const createdRow = await draftRowIndex(page, DEFAULT_CATEGORY_NAME);
  await expect(draftNames(page).nth(createdRow)).toHaveValue(DEFAULT_CATEGORY_NAME);
  await expect(
    outdentButtons(page).nth(createdRow),
    "新建的分类落在顶层，没有更外面一层可提",
  ).toBeDisabled();
});

/** 记录一段操作期间发出的所有分类写请求，用来证明「一次保存 = 一个请求」。 */
async function categoryWritesDuring(page: Page, action: () => Promise<void>): Promise<string[]> {
  const writes: string[] = [];
  const record = (request: Request): void => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/wiki/categories") && request.method() !== "GET") {
      writes.push(`${request.method()} ${pathname}`);
    }
  };
  page.on("request", record);
  try {
    await action();
  } finally {
    page.off("request", record);
  }
  return writes;
}

test("改名与挂父级：改的时候不动服务端，保存后一个请求整批落库", async ({ page, flow, api }) => {
  await openCategoryEditor(page);
  await expect(saveButton(page), "没改动时保存该是禁用的").toBeDisabled();

  const renamed = `${SYSTEM_TEST_CONTENT_MARKER} Renamed ${stamp}`;
  const rowB = await draftRowIndex(page, categoryB.name);
  await draftNames(page).nth(rowB).fill(renamed);

  /* B 紧挨在 A 后面，按一下行尾的箭头就挂到 A 底下。 */
  await indentButtons(page).nth(rowB).click();
  await expect(
    outdentButtons(page).nth(rowB),
    "挂进去之后这一行才有得往回提",
  ).toBeEnabled();

  const stillOld = await readCategory(api, categoryB.id);
  expect(stillOld.name, "还没保存，服务端不该有变化").toBe(categoryB.name);
  expect(stillOld.parent_id, "还没保存，父级也不该有变化").toBeNull();

  await expect(saveButton(page)).toBeEnabled();
  const writes = await categoryWritesDuring(page, async () => {
    await flow.click(saveButton(page), SAVE_CATEGORIES);
  });
  /*
   * 这一条盯的是原子性，不是性能：一次保存只准发一个请求。逐行 PATCH 时，
   * 中途某一行被拒会留下改了一半的目录，前端既回滚不了也说不清停在了哪一行。
   */
  expect(writes, "一次保存只能发一个批量请求").toEqual(["PATCH /api/wiki/categories/batch"]);

  await expect(saveButton(page), "保存完草稿和服务端一致，按钮该退回禁用").toBeDisabled();
  const saved = await readCategory(api, categoryB.id);
  expect(saved.name, "改名没落库").toBe(renamed);
  expect(saved.parent_id, "父级没落库").toBe(categoryA.id);

  await expect(
    indentButtons(page).nth(await draftRowIndex(page, categoryA.name)),
    "A 底下已经挂了子分类，它自己就不能再往里挂，否则落库就是三层",
  ).toBeDisabled();
});

test("拖拽排序：草稿顺序先变，保存后 sort_order 真的换了", async ({ page, flow, api }) => {
  const before = await readCategories(api);
  for (const category of before) sortOrderRestore.set(category.id, category.sort_order);

  await openCategoryEditor(page);
  /* 两条一次性分类的 sort_order 都是 0，按名字排在最前面，正好挨着，拖一格就够。 */
  const rowB = await draftRowIndex(page, categoryB.name);
  expect(rowB, "B 应当紧挨在 A 后面").toBe(await draftRowIndex(page, categoryA.name) + 1);

  const firstRowName = await draftNames(page).nth(0).inputValue();
  await dragRow(
    page,
    page.getByRole("button", { name: "Drag to reorder", exact: true }).nth(rowB),
    draftNames(page).nth(0),
  );

  expect(await draftRowIndex(page, categoryB.name), "拖到第一行之后草稿顺序要跟着变").toBe(0);
  expect(
    (await readCategory(api, categoryB.id)).sort_order,
    "还没保存，服务端的排序不该动",
  ).toBe(categoryB.sort_order);

  await flow.click(saveButton(page), SAVE_CATEGORIES);

  const after = await readCategories(api);
  const savedB = after.find((category) => category.id === categoryB.id)!;
  const savedFirst = after.find((category) => category.name === firstRowName)!;
  expect(savedB.sort_order, "拖到第一行的分类要拿到最小的序号").toBe(0);
  expect(
    savedB.sort_order < savedFirst.sort_order,
    `保存后 B(${savedB.sort_order}) 应当排在原来的第一行 ${firstRowName}(${savedFirst.sort_order}) 前面`,
  ).toBe(true);
});

test("删除分类：确认框拦一道，确认后服务端也没了", async ({ page, flow, api }) => {
  await openCategoryEditor(page);
  const rowA = await draftRowIndex(page, categoryA.name);

  await page.getByRole("button", { name: "Delete", exact: true }).nth(rowA).click();
  const dialog = await confirmDialog(page, "Delete Category");
  await expect(dialog, "确认框要说清删的是哪一个").toContainText(categoryA.name);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectNoDialog(page);
  expect(
    (await readCategories(api)).some((category) => category.id === categoryA.id),
    "取消删除不该动服务端",
  ).toBe(true);

  await page.getByRole("button", { name: "Delete", exact: true }).nth(rowA).click();
  await flow.click(
    (await confirmDialog(page, "Delete Category")).getByRole("button", { name: "Delete", exact: true }),
    DELETE_CATEGORY,
  );

  expect(
    (await readCategories(api)).some((category) => category.id === categoryA.id),
    "确认之后服务端必须真的删掉",
  ).toBe(false);
  const remaining = await draftNames(page)
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value));
  expect(remaining, "列表里也不该再留着它").not.toContain(categoryA.name);
});

test("关闭：有未保存草稿时先问，取消留下，确认丢弃", async ({ page, api }) => {
  await openCategoryEditor(page);
  const rowB = await draftRowIndex(page, categoryB.name);
  await draftNames(page).nth(rowB).fill(`${SYSTEM_TEST_CONTENT_MARKER} Dirty ${stamp}`);

  await closeEditorButton(page).click();
  const dialog = await confirmDialog(page, "Discard unsaved category changes?");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectNoDialog(page);
  await expect(
    categoryEditorTitle(page),
    "取消之后必须还留在编辑器里",
  ).toBeVisible();

  await closeEditorButton(page).click();
  await (await confirmDialog(page, "Discard unsaved category changes?"))
    .getByRole("button", { name: "Discard", exact: true }).click();
  await expect(categoryEditorTitle(page)).toHaveCount(0);

  expect((await readCategory(api, categoryB.id)).name, "丢弃的草稿不该落库").toBe(categoryB.name);
});
