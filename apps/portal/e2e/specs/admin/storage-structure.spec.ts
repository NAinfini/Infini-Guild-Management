import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { confirmDialog, field } from "../../support/ui";

/*
 * /storage/manage 的结构 CRUD：左侧树 + 右侧工作区。
 *
 * 这一页的每个按钮都直接改数据库结构，所以每条用例都必须回读 GET /api/storage
 * 核对服务端真实结构——树上显示对了不代表落库了（乐观更新、缓存回填都能骗过 UI 断言）。
 *
 * 每条用例自己建一个一次性仓库，afterEach 删除；分类随外键级联消失。
 */

const CREATE_STORAGE = { method: "POST", path: /^\/api\/storage\/storages$/ } as const;
const UPDATE_STORAGE = { method: "PATCH", path: /^\/api\/storage\/storages\/[^/]+$/ } as const;
const DELETE_STORAGE = { method: "DELETE", path: /^\/api\/storage\/storages\/[^/]+$/ } as const;
const CREATE_CATEGORY = {
  method: "POST",
  path: /^\/api\/storage\/storages\/[^/]+\/categories$/,
} as const;
const UPDATE_CATEGORY = {
  method: "PATCH",
  path: /^\/api\/storage\/storages\/[^/]+\/categories\/[^/]+$/,
} as const;
const DELETE_CATEGORY = {
  method: "DELETE",
  path: /^\/api\/storage\/storages\/[^/]+\/categories\/[^/]+$/,
} as const;

type TreeStorage = {
  id: string;
  name: string;
  description: string | null;
  structure_revision: number;
  categories: { id: string; name: string }[];
};

let stamp: number;
let storage: TreeStorage;
/* 用例里通过 UI 建出来的仓库也要收干净，否则最后的指纹比对会挂在别人头上。 */
let disposableStorageIds: string[] = [];

test.beforeEach(async ({ page, api }) => {
  stamp = Date.now();
  storage = await createStorage(api, `${SYSTEM_TEST_CONTENT_MARKER} Struct ${stamp}`);
  disposableStorageIds = [storage.id];
  await page.goto(`/storage/manage?storageId=${storage.id}`);
  await expect(treeRow(page, storage.name)).toHaveCount(1);
});

test.afterEach(async ({ api }) => {
  for (const id of disposableStorageIds) {
    const current = await readStorage(api, id);
    if (!current) continue;
    const response = await api.delete(`/api/storage/storages/${id}`, {
      data: { expected_structure_revision: current.structure_revision },
    });
    // 用例自己删掉的仓库这里会拿到 404，那是预期的；其余状态码都是真失败。
    expect([200, 204, 404], `清理仓库 ${id} 返回 ${response.status()}`).toContain(response.status());
  }
});

async function createStorage(api: APIRequestContext, name: string): Promise<TreeStorage> {
  const created = await readJson(
    await api.post("/api/storage/storages", { data: { name, description: null } }),
    `创建一次性仓库 ${name}`,
  ) as { id: string; structure_revision: number };
  return {
    id: created.id,
    name,
    description: null,
    structure_revision: created.structure_revision,
    categories: [],
  };
}

async function readStorage(api: APIRequestContext, id: string): Promise<TreeStorage | null> {
  const tree = await readJson(await api.get("/api/storage"), "回读仓库树") as { data: TreeStorage[] };
  return tree.data.find((candidate) => candidate.id === id) ?? null;
}

/** 树上的仓库行。分类行也叫同一个类名，所以必须带上 --storage 修饰符。 */
function treeRow(page: Page, name: string): Locator {
  return page.locator(".storage-management-modal__tree-row--storage").filter({ hasText: name });
}

function categoryRow(page: Page, name: string): Locator {
  return page.locator(".storage-management-modal__tree-row--category").filter({ hasText: name });
}

function workspace(page: Page): Locator {
  return page.locator(".storage-management-modal__workspace");
}

/** 树头部的「新建仓库」按钮和工作区的保存按钮同名，取元素必须分区域。 */
function treeHeaderButton(page: Page, name: string): Locator {
  return page.locator(".storage-management-modal__tree-header").getByRole("button", { name, exact: true });
}

test("新建仓库：名称为空时禁止提交，填好后落库并自动选中", async ({ page, flow, api }) => {
  await flow.clickWithoutApi(treeHeaderButton(page, "Create Storage"));

  const panel = workspace(page);
  const submit = panel.getByRole("button", { name: "Create Storage", exact: true });
  await expect(field(panel, "Storage name"), "进入新建态后名称必须是空的").toHaveValue("");
  await expect(submit, "名称为空时不该允许提交").toBeDisabled();

  const name = `${SYSTEM_TEST_CONTENT_MARKER} Struct New ${stamp}`;
  await field(panel, "Storage name").fill(name);
  await field(panel, "Description").fill("created by e2e");
  await expect(submit).toBeEnabled();

  const created = await flow.click(submit, CREATE_STORAGE) as { id: string };
  disposableStorageIds.push(created.id);

  // 服务端才是判据：名称和描述都必须原样落库。
  const persisted = await readStorage(api, created.id);
  expect(persisted, "新建的仓库必须出现在服务端仓库树里").not.toBeNull();
  expect(persisted?.name).toBe(name);
  expect(persisted?.description).toBe("created by e2e");

  await expect(treeRow(page, name), "树上必须出现新仓库").toHaveCount(1);
  // 新建成功后自动选中它，URL 是唯一能证明这一点的地方。
  await expect(page).toHaveURL(new RegExp(`storageId=${created.id}`));
  await expect(field(workspace(page), "Storage name")).toHaveValue(name);
});

test("重命名仓库：PATCH 落库，树上的名字同步换掉", async ({ page, flow, api }) => {
  const panel = workspace(page);
  const renamed = `${storage.name} renamed`;
  await field(panel, "Storage name").fill(renamed);
  await flow.click(panel.getByRole("button", { name: "Save Storage", exact: true }), UPDATE_STORAGE);

  expect((await readStorage(api, storage.id))?.name, "服务端仓库名必须已更新").toBe(renamed);
  await expect(treeRow(page, renamed)).toHaveCount(1);
});

test("取消编辑：输入框回到已保存的值，且全程不发请求", async ({ page, flow, api }) => {
  const panel = workspace(page);
  await field(panel, "Storage name").fill("dirty draft");
  await flow.clickWithoutApi(panel.getByRole("button", { name: "Cancel", exact: true }));

  await expect(field(panel, "Storage name"), "取消必须还原成已保存的名称").toHaveValue(storage.name);
  expect((await readStorage(api, storage.id))?.name, "取消不该改动服务端").toBe(storage.name);
});

test("新建分类：落到该仓库名下，树上的分类计数跟着 +1", async ({ page, flow, api }) => {
  await expect(treeRow(page, storage.name).getByText("0", { exact: true }), "一次性仓库应当从 0 个分类起步")
    .toHaveCount(1);

  await flow.clickWithoutApi(
    treeRow(page, storage.name).getByRole("button", { name: "Create Category", exact: true }),
  );

  const panel = workspace(page);
  const submit = panel.getByRole("button", { name: "Create Category", exact: true });
  await expect(submit, "分类名为空时不该允许提交").toBeDisabled();

  const categoryName = `${SYSTEM_TEST_CONTENT_MARKER} Cat ${stamp}`;
  await field(panel, "Category name").fill(categoryName);
  await flow.click(submit, CREATE_CATEGORY);

  const persisted = await readStorage(api, storage.id);
  expect(
    persisted?.categories.map((category) => category.name),
    "新分类必须挂在这个仓库名下",
  ).toEqual([categoryName]);

  await expect(categoryRow(page, categoryName)).toHaveCount(1);
  await expect(treeRow(page, storage.name).getByText("1", { exact: true })).toHaveCount(1);
});

test("重命名分类：没改名时保存按钮按不动，改了才落库", async ({ page, flow, api }) => {
  const original = `${SYSTEM_TEST_CONTENT_MARKER} Cat ${stamp}`;
  const current = await readStorage(api, storage.id);
  const category = await readJson(
    await api.post(`/api/storage/storages/${storage.id}/categories`, {
      data: { name: original, expected_structure_revision: current!.structure_revision },
    }),
    "预置分类",
  ) as { category: { id: string }; structure_revision: number };

  /*
   * 分类是用 API 预置的，页面上的树还是旧快照，必须重新载入。
   * 这里不能用 flow.act 去等那次 GET：导航会把响应体丢掉，
   * 断言里读 response.text() 会直接抛 "No resource with given identifier found"。
   * 用「新分类出现在树上」来证明刷新确实拿到了新数据。
   */
  await page.reload();
  await expect(categoryRow(page, original)).toHaveCount(1);
  await categoryRow(page, original).getByRole("button").first().click();

  const panel = workspace(page);
  await expect(field(panel, "Category name")).toHaveValue(original);
  await expect(
    panel.getByRole("button", { name: "Save Category", exact: true }),
    "名字没变时保存按钮必须是禁用的，否则等于允许发一次没有任何变化的写请求",
  ).toBeDisabled();

  const renamed = `${original} renamed`;
  await field(panel, "Category name").fill(renamed);
  await flow.click(panel.getByRole("button", { name: "Save Category", exact: true }), UPDATE_CATEGORY);

  const persisted = await readStorage(api, storage.id);
  expect(persisted?.categories.find((entry) => entry.id === category.category.id)?.name).toBe(renamed);
  await expect(categoryRow(page, renamed)).toHaveCount(1);
});

test("删除分类：取消什么都不做，确认才真的删掉", async ({ page, flow, api }) => {
  const name = `${SYSTEM_TEST_CONTENT_MARKER} Cat ${stamp}`;
  const current = await readStorage(api, storage.id);
  await readJson(
    await api.post(`/api/storage/storages/${storage.id}/categories`, {
      data: { name, expected_structure_revision: current!.structure_revision },
    }),
    "预置分类",
  );
  // 同上：刷新拿新树，用元素出现来确认，不要用 flow.act 包导航。
  await page.reload();
  await expect(categoryRow(page, name)).toHaveCount(1);

  const remove = categoryRow(page, name).getByRole("button", { name: "Delete Category", exact: true });
  await remove.click();
  await (await confirmDialog(page, "Delete this category?"))
    .getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    (await readStorage(api, storage.id))?.categories.length,
    "取消确认后分类必须原封不动",
  ).toBe(1);
  await expect(categoryRow(page, name)).toHaveCount(1);

  await remove.click();
  await flow.act(
    async () => {
      await (await confirmDialog(page, "Delete this category?"))
        .getByRole("button", { name: "Delete", exact: true }).click();
    },
    DELETE_CATEGORY,
  );

  expect((await readStorage(api, storage.id))?.categories, "确认后分类必须从服务端消失").toEqual([]);
  await expect(categoryRow(page, name)).toHaveCount(0);
});

test("删除仓库：确认后从服务端和树上一起消失", async ({ page, flow, api }) => {
  await treeRow(page, storage.name).getByRole("button", { name: "Delete Storage", exact: true }).click();
  await flow.act(
    async () => {
      await (await confirmDialog(page, "Delete this storage?"))
        .getByRole("button", { name: "Delete", exact: true }).click();
    },
    DELETE_STORAGE,
  );

  expect(await readStorage(api, storage.id), "确认后仓库必须从服务端消失").toBeNull();
  await expect(treeRow(page, storage.name)).toHaveCount(0);
});

test("窄屏：树收进抽屉，选中后抽屉关闭且工作区切到该仓库", async ({ page, flow }) => {
  await page.setViewportSize({ width: 420, height: 900 });

  const tree = page.locator(".storage-management-modal__tree");
  await expect(tree, "窄屏下树必须收起，否则工作区没地方站").toBeHidden();

  await flow.clickWithoutApi(page.getByRole("button", { name: "Change", exact: true }));
  await expect(tree).toBeVisible();

  await tree.locator(".storage-management-modal__tree-node").filter({ hasText: storage.name }).click();
  await expect(tree, "选完就该收起抽屉，否则挡着下面的编辑区").toBeHidden();
  await expect(field(workspace(page), "Storage name")).toHaveValue(storage.name);
});
