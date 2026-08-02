import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { webpUpload } from "../../support/files";
import { confirmDialog, dialogTitled, expectNoDialog, field, selectOption } from "../../support/ui";

/*
 * 物品编辑抽屉：字段、两个自助开关、分类下拉、图片上传/删除、删除物品。
 *
 * 图片这一段是整套用例里唯一真正写 R2 的地方，所以必须两头都验：
 * 服务端 images 数组的长度要变，UI 上的缩略图和计数也要跟着变。
 * 只看 UI 会漏掉「前端自己塞了个 blob 预览、请求其实失败了」这种缺陷。
 *
 * 仓库、分类、物品都由用例自己建，afterEach 删仓库，其余按外键级联消失。
 */

const CREATE_ITEM = { method: "POST", path: /^\/api\/storage\/items$/ } as const;
const UPDATE_ITEM = { method: "PATCH", path: /^\/api\/storage\/items\/[^/]+$/ } as const;
const DELETE_ITEM = { method: "DELETE", path: /^\/api\/storage\/items\/[^/]+$/ } as const;
const UPLOAD_IMAGE = { method: "POST", path: /^\/api\/storage\/items\/[^/]+\/images$/ } as const;
const DELETE_IMAGE = {
  method: "DELETE",
  path: /^\/api\/storage\/items\/[^/]+\/images\/[^/]+$/,
} as const;

type ServerItem = {
  id: string;
  name: string;
  description: string | null;
  category_id: string | null;
  allow_member_deposit: boolean;
  allow_member_withdraw: boolean;
  images: { id: string; r2_key: string }[];
};

let stamp: number;
let storageId: string;
let categoryId: string;
let categoryName: string;
let item: { id: string; name: string };

test.beforeEach(async ({ page, api }) => {
  stamp = Date.now();
  const storage = await readJson(
    await api.post("/api/storage/storages", {
      data: { name: `${SYSTEM_TEST_CONTENT_MARKER} Editor ${stamp}`, description: null },
    }),
    "创建一次性仓库",
  ) as { id: string };
  storageId = storage.id;

  categoryName = `${SYSTEM_TEST_CONTENT_MARKER} Cat ${stamp}`;
  const category = await readJson(
    await api.post(`/api/storage/storages/${storageId}/categories`, { data: { name: categoryName } }),
    "创建一次性分类",
  ) as { id: string };
  categoryId = category.id;

  item = { id: "", name: `${SYSTEM_TEST_CONTENT_MARKER} Item ${stamp}` };
  const created = await readJson(
    await api.post("/api/storage/items", {
      data: {
        storage_id: storageId,
        category_id: null,
        name: item.name,
        description: null,
        allow_member_deposit: false,
        allow_member_withdraw: false,
      },
    }),
    "创建一次性物品",
  ) as { id: string };
  item.id = created.id;

  await page.goto(`/storage?storageId=${storageId}`);
  await expect(card(page, item.name)).toHaveCount(1);
});

test.afterEach(async ({ api }) => {
  /*
   * 仓库和分类都必须先清空才能删（StorageService.deleteStorage 会挡住非空仓库），
   * 所以清理顺序是：先把这个仓库里的物品逐个删掉，再删仓库，分类随外键级联消失。
   */
  const list = await readJson(
    await api.get(`/api/storage/items?storage_id=${storageId}&limit=50`),
    "回读待清理的物品",
  ) as { data: { id: string }[] };
  for (const entry of list.data) {
    const removed = await api.delete(`/api/storage/items/${entry.id}`);
    expect([200, 204, 404], `清理物品返回 ${removed.status()}`).toContain(removed.status());
  }
  const response = await api.delete(`/api/storage/storages/${storageId}`);
  expect([200, 204, 404], `清理仓库返回 ${response.status()}`).toContain(response.status());
});

function card(page: Page, name: string): Locator {
  return page.locator(".storage-item-card").filter({ hasText: name });
}

function editor(page: Page): Locator {
  return dialogTitled(page, "Edit Item");
}

async function openEditor(page: Page): Promise<Locator> {
  await card(page, item.name).getByRole("button", { name: "Edit", exact: true }).click();
  const drawer = editor(page);
  await expect(drawer).toBeVisible();
  return drawer;
}

async function readItem(api: APIRequestContext, id: string): Promise<ServerItem> {
  return await readJson(await api.get(`/api/storage/items/${id}`), `回读物品 ${id}`) as ServerItem;
}

test("新建态：名称为空禁止提交，图片区要等物品存在之后才出现", async ({ page, flow }) => {
  await flow.clickWithoutApi(page.getByRole("button", { name: "New Item", exact: true }).first());

  const drawer = dialogTitled(page, "Create Item");
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: "New Item", exact: true }),
    "名称为空时创建按钮必须禁用",
  ).toBeDisabled();
  await expect(
    drawer.getByText("Save the item before uploading images.", { exact: true }),
    "还没有物品 id，图片没地方挂，必须明确告诉用户",
  ).toBeVisible();
  await expect(drawer.locator("input[type='file']"), "新建态不该出现上传区").toHaveCount(0);
});

test("新建物品完整链路：字段原样落库，成功后抽屉转入编辑态", async ({ page, flow, api }) => {
  await flow.clickWithoutApi(page.getByRole("button", { name: "New Item", exact: true }).first());
  const drawer = dialogTitled(page, "Create Item");

  const name = `${SYSTEM_TEST_CONTENT_MARKER} Item New ${stamp}`;
  await field(drawer, "Item name").fill(name);
  await field(drawer, "Description").fill("created by e2e");
  await selectOption(drawer, "Category", categoryName);
  await drawer.getByLabel("Allow member deposit", { exact: true }).check();

  const created = await flow.click(
    drawer.getByRole("button", { name: "New Item", exact: true }),
    CREATE_ITEM,
  ) as { id: string };

  const persisted = await readItem(api, created.id);
  expect(persisted.name).toBe(name);
  expect(persisted.description).toBe("created by e2e");
  expect(persisted.category_id, "分类必须落到刚建的那个").toBe(categoryId);
  expect(persisted.allow_member_deposit).toBe(true);
  expect(persisted.allow_member_withdraw, "没开的开关不该被顺手打开").toBe(false);

  // 转入编辑态是设计行为：接着就能传图。删除按钮和上传区是它的判据。
  await expect(editor(page).getByRole("button", { name: "Delete Item", exact: true })).toBeVisible();
  await expect(editor(page).locator("input[type='file']")).toHaveCount(1);
});

test("编辑物品：改名、描述、分类和两个开关一起落库", async ({ page, flow, api }) => {
  const drawer = await openEditor(page);

  const renamed = `${item.name} renamed`;
  await field(drawer, "Item name").fill(renamed);
  await field(drawer, "Description").fill("updated by e2e");
  await selectOption(drawer, "Category", categoryName);
  await drawer.getByLabel("Allow member deposit", { exact: true }).check();
  await drawer.getByLabel("Allow member withdraw", { exact: true }).check();

  await flow.click(drawer.getByRole("button", { name: "Save Item", exact: true }), UPDATE_ITEM);

  const persisted = await readItem(api, item.id);
  expect(persisted.name).toBe(renamed);
  expect(persisted.description).toBe("updated by e2e");
  expect(persisted.category_id).toBe(categoryId);
  expect(persisted.allow_member_deposit).toBe(true);
  expect(persisted.allow_member_withdraw).toBe(true);

  await expect(card(page, renamed)).toHaveCount(1);
});

test("分类可以退回未分类：category_id 必须变成 null，不是空字符串", async ({ page, flow, api }) => {
  await readJson(
    await api.patch(`/api/storage/items/${item.id}`, { data: { category_id: categoryId } }),
    "预置分类归属",
  );
  await page.reload();

  const drawer = await openEditor(page);
  await expect(field(drawer, "Category")).toHaveValue(categoryName);
  await selectOption(drawer, "Category", "Uncategorized");
  await flow.click(drawer.getByRole("button", { name: "Save Item", exact: true }), UPDATE_ITEM);

  expect(
    (await readItem(api, item.id)).category_id,
    "「未分类」在服务端必须是 null——空串会让分类筛选查出一堆幽灵",
  ).toBeNull();
});

test("图片上传与删除：服务端 images 数组和界面计数必须一起动", async ({ page, flow, api }) => {
  const drawer = await openEditor(page);
  const mediaHeader = drawer.locator(".storage-item-editor__media-header");
  await expect(mediaHeader.getByText("0", { exact: true }), "一次性物品应当没有图片").toHaveCount(1);

  const uploaded = await flow.act(
    () => drawer.locator("input[type='file']").setInputFiles(webpUpload(`e2e-${stamp}.webp`)),
    UPLOAD_IMAGE,
  ) as { id: string; r2_key: string }[];
  expect(uploaded, "上传接口必须回一条图片记录").toHaveLength(1);

  const afterUpload = await readItem(api, item.id);
  expect(afterUpload.images.map((image) => image.id), "服务端必须记下这张图").toEqual([uploaded[0]!.id]);
  expect(afterUpload.images[0]!.r2_key, "R2 键必须落在这个物品名下").toContain(`storage/items/${item.id}/`);

  await expect(drawer.locator(".storage-item-editor__image")).toHaveCount(1);
  await expect(mediaHeader.getByText("1", { exact: true })).toHaveCount(1);

  // 删除要过确认框；取消不该动任何数据。
  await drawer.getByRole("button", { name: "Delete image", exact: true }).click();
  await (await confirmDialog(page, "Delete this image?"))
    .getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await readItem(api, item.id)).images, "取消确认后图片必须还在").toHaveLength(1);

  await drawer.getByRole("button", { name: "Delete image", exact: true }).click();
  await flow.act(
    async () => {
      await (await confirmDialog(page, "Delete this image?"))
        .getByRole("button", { name: "Delete", exact: true }).click();
    },
    DELETE_IMAGE,
  );

  expect((await readItem(api, item.id)).images, "确认后服务端必须不再有图片").toEqual([]);
  await expect(drawer.locator(".storage-item-editor__image")).toHaveCount(0);
  await expect(mediaHeader.getByText("0", { exact: true })).toHaveCount(1);
});

test("删除物品：取消什么都不做，确认后服务端查不到且抽屉关闭", async ({ page, flow, api }) => {
  const drawer = await openEditor(page);

  await drawer.getByRole("button", { name: "Delete Item", exact: true }).click();
  await (await confirmDialog(page, "Delete this item?"))
    .getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await api.get(`/api/storage/items/${item.id}`)).status(), "取消后物品必须还在").toBe(200);

  await drawer.getByRole("button", { name: "Delete Item", exact: true }).click();
  await flow.act(
    async () => {
      await (await confirmDialog(page, "Delete this item?"))
        .getByRole("button", { name: "Delete", exact: true }).click();
    },
    DELETE_ITEM,
  );

  expect((await api.get(`/api/storage/items/${item.id}`)).status(), "确认后物品必须查不到").toBe(404);
  await expectNoDialog(page);
  await expect(card(page, item.name)).toHaveCount(0);
});
