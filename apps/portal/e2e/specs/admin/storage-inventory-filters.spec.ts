import type { Page } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { ensureFiltersOpen, field, selectFilterOption } from "../../support/ui";

/*
 * 库存面板上的四个筛选控件：分类导轨、移动端分类下拉、搜索框、库存下拉。
 * 它们全都走服务端（useStorageItems 把条件带进查询），所以每条用例都要求两件事：
 * 请求真的发出去了，而且回来的结果**确实符合那个条件**。
 * 只断言「点了以后列表变了」没有意义——变错了也叫变了。
 *
 * 断言不能建立在种子数据的分布上（「碰巧有一件 0 库存的」）：那种用例在数据一变
 * 就会空转成假绿。这里每条用例先造两件属性互补的一次性物品——
 * A：允许存入、不允许取出、挂在第一个分类；B：允许取出、不允许存入、挂在第二个分类；
 * 两件都是 0 库存。于是每个筛选都能同时验证正反两面：
 * 该出现的必须出现，该被滤掉的必须消失。
 */

const ITEMS_REQUEST = { method: "GET", path: /^\/api\/storage\/items$/ } as const;
const CARD = ".storage-item-card";

type Sample = { id: string; name: string; categoryName: string };

let storageId: string;
let depositSample: Sample;
let withdrawSample: Sample;

test.beforeEach(async ({ page, api }) => {
  const tree = await readJson(await api.get("/api/storage"), "读取仓库树") as {
    data: { id: string; name: string; categories: { id: string; name: string }[] }[];
  };
  /* 分类筛选要验证「切到别的分类就该消失」，至少得有两个分类。
     写死 data[0] 会随仓库排序悄悄失效，这里按条件挑。 */
  const storage = tree.data.find((candidate) => candidate.categories.length >= 2);
  expect(storage, "环境里必须有一个至少含两个分类的仓库，否则分类筛选无从验证").toBeTruthy();
  const [first, second] = storage!.categories;
  storageId = storage!.id;

  const stamp = Date.now();
  depositSample = await createSample(api, {
    storageId,
    category: first!,
    name: `${SYSTEM_TEST_CONTENT_MARKER} Filter Deposit ${stamp}`,
    allow_member_deposit: true,
    allow_member_withdraw: false,
  });
  withdrawSample = await createSample(api, {
    storageId,
    category: second!,
    name: `${SYSTEM_TEST_CONTENT_MARKER} Filter Withdraw ${stamp}`,
    allow_member_deposit: false,
    allow_member_withdraw: true,
  });

  await page.goto(`/storage?storageId=${storageId}`);
  await expect(card(page, depositSample)).toHaveCount(1);
  await expect(card(page, withdrawSample)).toHaveCount(1);
});

test.afterEach(async ({ api }) => {
  for (const sample of [depositSample, withdrawSample]) {
    const response = await api.delete(`/api/storage/items/${sample.id}`);
    expect(response.ok(), `删除一次性样本 ${sample.name} 失败: ${response.status()}`).toBe(true);
  }
});

async function createSample(
  api: import("@playwright/test").APIRequestContext,
  input: {
    storageId: string;
    category: { id: string; name: string };
    name: string;
    allow_member_deposit: boolean;
    allow_member_withdraw: boolean;
  },
): Promise<Sample> {
  const created = await readJson(
    await api.post("/api/storage/items", {
      data: {
        storage_id: input.storageId,
        category_id: input.category.id,
        name: input.name,
        description: null,
        allow_member_deposit: input.allow_member_deposit,
        allow_member_withdraw: input.allow_member_withdraw,
      },
    }),
    `创建一次性样本 ${input.name}`,
  ) as { id: string; quantity: number };
  // 「有库存 / 无库存」两条断言都建立在这个 0 上，先钉死它。
  expect(created.quantity, "新建物品必须从 0 库存起步").toBe(0);
  return { id: created.id, name: input.name, categoryName: input.category.name };
}

function card(page: Page, sample: Sample) {
  return page.locator(CARD).filter({ hasText: sample.name });
}

async function pickStock(page: Page, option: string) {
  await selectFilterOption(page, page.locator(".storage-command"), "Stock", option);
}

test("搜索框按名称过滤：命中项留下，其余全部滤掉", async ({ page, flow }) => {
  const before = await page.locator(CARD).count();
  expect(before, "搜索前列表里应该不止一件").toBeGreaterThan(1);

  await flow.act(
    () => field(page, "Search items").fill(depositSample.name),
    ITEMS_REQUEST,
  );

  await expect(page.locator(CARD)).toHaveCount(1);
  await expect(card(page, depositSample)).toHaveCount(1);
  await expect(page.locator(".storage-inventory-meta")).toContainText("Showing 1 item");
});

test("清空搜索框会取消过滤", async ({ page, flow }) => {
  const search = field(page, "Search items");
  const before = await page.locator(CARD).count();

  await flow.act(() => search.fill(depositSample.name), ITEMS_REQUEST);
  await expect(page.locator(CARD)).toHaveCount(1);

  /*
   * 清空搜索是「退回一个刚取过的查询」：queryClient 的 staleTime 是 5 分钟
   * （apps/portal/router.tsx:251），空搜索这条键几秒前刚填过，直接命中缓存，
   * 不会再发请求。所以这一步只能断言结果回到全量，不能要求网络往返——
   * 要求了就是在测缓存策略，而不是在测这个控件。
   */
  await search.fill("");
  await expect(page.locator(CARD)).toHaveCount(before);
  await expect(card(page, withdrawSample), "取消过滤后另一件样本必须回来").toHaveCount(1);
});

test("库存筛选「In stock」滤掉 0 库存，留下的每件都大于 0", async ({ page, flow }) => {
  await flow.act(() => pickStock(page, "In stock"), ITEMS_REQUEST);

  await expect(card(page, depositSample), "0 库存的样本不该出现在「有库存」里").toHaveCount(0);
  await expect(card(page, withdrawSample), "0 库存的样本不该出现在「有库存」里").toHaveCount(0);
  const stocks = await page.locator(`${CARD} .storage-item-card__stock-value`).allInnerTexts();
  expect(stocks.length, "「有库存」不该把整个列表清空").toBeGreaterThan(0);
  for (const stock of stocks) {
    expect(Number.parseInt(stock, 10), `库存 ${stock} 不该出现在「有库存」结果里`).toBeGreaterThan(0);
  }
});

test("库存筛选「Out of stock」留下 0 库存，且每件都是 0", async ({ page, flow }) => {
  await flow.act(() => pickStock(page, "Out of stock"), ITEMS_REQUEST);

  await expect(card(page, depositSample), "0 库存的样本必须出现在「无库存」里").toHaveCount(1);
  await expect(card(page, withdrawSample), "0 库存的样本必须出现在「无库存」里").toHaveCount(1);
  for (const stock of await page.locator(`${CARD} .storage-item-card__stock-value`).allInnerTexts()) {
    expect(Number.parseInt(stock, 10), `库存 ${stock} 不该出现在「无库存」结果里`).toBe(0);
  }
});

test("库存筛选「Member deposit」只留下允许成员存入的物品", async ({ page, flow }) => {
  await flow.act(() => pickStock(page, "Member deposit"), ITEMS_REQUEST);

  await expect(card(page, depositSample), "允许存入的样本必须留下").toHaveCount(1);
  await expect(card(page, withdrawSample), "不允许存入的样本必须被滤掉").toHaveCount(0);
  await expectEveryCardBadged(page, "Deposit");
});

test("库存筛选「Member withdraw」只留下允许成员取出的物品", async ({ page, flow }) => {
  await flow.act(() => pickStock(page, "Member withdraw"), ITEMS_REQUEST);

  await expect(card(page, withdrawSample), "允许取出的样本必须留下").toHaveCount(1);
  await expect(card(page, depositSample), "不允许取出的样本必须被滤掉").toHaveCount(0);
  await expectEveryCardBadged(page, "Withdraw");
});

/* 只认徽章区里的文字：右侧那两颗操作按钮同名，拿它们断言等于什么都没断言。 */
async function expectEveryCardBadged(page: Page, badge: string) {
  const cards = page.locator(CARD);
  const total = await cards.count();
  expect(total, `「${badge}」筛选不该把整个列表清空`).toBeGreaterThan(0);
  for (let index = 0; index < total; index += 1) {
    await expect(
      cards.nth(index).locator(".storage-item-card__badges").getByText(badge, { exact: true }),
      `结果里的每件物品都该带「${badge}」徽章`,
    ).toHaveCount(1);
  }
}

test("分类导轨：选中分类只留该分类，切到别的分类样本消失，回到全部又出现", async ({ page, flow }) => {
  const rail = page.locator(".storage-category-rail__nav button");
  const target = rail.filter({ hasText: depositSample.categoryName }).first();

  await flow.act(() => target.click(), ITEMS_REQUEST);
  await expect(target).toHaveAttribute("aria-current", "page");
  await expect(card(page, depositSample), "样本挂在这个分类下，必须出现").toHaveCount(1);
  await expect(card(page, withdrawSample), "别的分类的样本必须被滤掉").toHaveCount(0);
  const cards = page.locator(CARD);
  const total = await cards.count();
  for (let index = 0; index < total; index += 1) {
    await expect(cards.nth(index)).toContainText(depositSample.categoryName);
  }

  await flow.act(
    () => rail.filter({ hasText: withdrawSample.categoryName }).first().click(),
    ITEMS_REQUEST,
  );
  await expect(card(page, depositSample), "切到别的分类后样本必须消失").toHaveCount(0);
  await expect(card(page, withdrawSample), "切到的正是它所在的分类，必须出现").toHaveCount(1);

  /* 回到「全部分类」同样是命中缓存（staleTime 5 分钟），不会再发请求，
     所以这里只验证控件状态和渲染结果。 */
  await rail.first().click();
  await expect(rail.first()).toHaveAttribute("aria-current", "page");
  await expect(card(page, depositSample), "回到「All Categories」样本必须回来").toHaveCount(1);
  await expect(card(page, withdrawSample), "回到「All Categories」样本必须回来").toHaveCount(1);
});

test("移动端分类下拉与导轨等效：窄屏下导轨隐藏，下拉照样过滤", async ({ page, flow }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await expect(page.locator(".storage-category-rail"), "窄屏下导轨应当收起").toBeHidden();

  await ensureFiltersOpen(page.locator(".storage-command"));
  const mobileSelect = field(page, "Filter by category");
  await expect(mobileSelect).toBeVisible();

  await flow.act(
    () => selectFilterOption(
      page,
      page.locator(".storage-command"),
      "Filter by category",
      withdrawSample.categoryName,
    ),
    ITEMS_REQUEST,
  );
  await expect(card(page, depositSample), "选到别的分类后样本必须消失").toHaveCount(0);
  await expect(card(page, withdrawSample)).toHaveCount(1);

  await flow.act(
    () => selectFilterOption(
      page,
      page.locator(".storage-command"),
      "Filter by category",
      depositSample.categoryName,
    ),
    ITEMS_REQUEST,
  );
  await expect(card(page, depositSample), "选回样本所在分类，样本必须回来").toHaveCount(1);
  await expect(card(page, withdrawSample)).toHaveCount(0);
});
