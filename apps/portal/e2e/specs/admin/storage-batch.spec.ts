import type { Locator, Page } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { createTestStorage } from "../../support/storage";
import { confirmDialog, dialogTitled, readInteger, selectOption } from "../../support/ui";

/*
 * 批量出入库：批量条、卡片上的 ± 、方向分段器、复核抽屉里的领取人/清空/逐项移除/备注/提交。
 *
 * 这一套控件里绝大多数是纯前端的（选数量、算合计、改方向），它们的「流程正确」意味着
 * **不该发请求**——所以用 clickWithoutApi 明确钉住，避免哪天被改成每次点击都打服务器还没人发现。
 * 真正落库的只有最后那一次 POST /api/storage/transactions/batch，
 * 它必须让两件物品的库存各自按量变化，并各留下一条流水。
 *
 * 两件一次性物品都由本用例自己创建并登记进系统测试运行；整轮精确补偿会先删流水，
 * 再按已登记主键删除物品。产品接口必须继续拒绝删除已有流水的物品。
 */

const BATCH_REQUEST = {
  method: "POST",
  path: /^\/api\/storage\/transactions\/batch$/,
} as const;

let storageId: string;
let itemA: { id: string; name: string };
let itemB: { id: string; name: string };

test.beforeEach(async ({ page, api }) => {
  storageId = (await createTestStorage(api, "Batch")).id;

  const stamp = Date.now();
  itemA = await createItem(api, storageId, `${SYSTEM_TEST_CONTENT_MARKER} Batch A ${stamp}`);
  itemB = await createItem(api, storageId, `${SYSTEM_TEST_CONTENT_MARKER} Batch B ${stamp}`);

  await page.goto(`/storage?storageId=${storageId}`);
  /*
   * 必须先搜一把再断言。
   *
   * 库存列表是按名称升序的游标分页，一页 24 条（StorageService.listItems）。
   * 单跑这个文件时仓库里就这么几件东西，首屏当然看得见；整轮跑起来，前面用例
   * 留在同一个仓库里的 [systemtest] 物品堆到一起，刚建的这两件就被挤到第二页去了，
   * 于是断言在「一个都没有」上超时——那是分页，不是回归。
   * 用同一个时间戳去搜，两件正好都在结果里，也顺带走了一遍搜索这个控件。
   *
   * 必须等那一发搜索请求真的回来才算数，不能只等卡片出现：搜索框是防抖的，
   * 而单跑时这两件东西本来就在首屏，卡片断言在请求还没发出去的时候就已经满足了，
   * 防抖计时器随后才触发——那一发 GET /api/storage/items 正好落进下面第一个
   * clickWithoutApi 的窗口里，被当成「这个控件发了请求」。计时器是纯前端状态，
   * flow 里的静默等待看不见它，只能在这里显式钉住。
   *
   * 而且必须按查询串认人：只匹配路径的话，goto 打进来的那一发首屏列表请求
   * 同样是 GET /api/storage/items，先回来就把等待提前解掉了，防抖那一发照样漏网。
   */
  const searched = page.waitForResponse(
    (response) => response.request().method() === "GET"
      && new URL(response.url()).searchParams.get("search") === String(stamp),
  );
  await page.getByLabel("Search items", { exact: true }).fill(String(stamp));
  expect((await searched).ok(), "搜索请求必须成功，否则下面断言的是没过滤的列表").toBe(true);
  await expect(card(page, itemA)).toHaveCount(1);
  await expect(card(page, itemB)).toHaveCount(1);
});

async function createItem(
  api: import("@playwright/test").APIRequestContext,
  storage: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const created = await readJson(
    await api.post("/api/storage/items", {
      data: {
        storage_id: storage,
        category_id: null,
        name,
        description: null,
        allow_member_deposit: true,
        allow_member_withdraw: true,
      },
    }),
    `创建一次性物品 ${name}`,
  ) as { id: string; quantity: number };
  expect(created.quantity, "新建物品必须从 0 库存起步").toBe(0);
  return { id: created.id, name };
}

function card(page: Page, item: { name: string }): Locator {
  return page.locator(".storage-item-card").filter({ hasText: item.name });
}

function plus(page: Page, item: { name: string }): Locator {
  return page.getByRole("button", { name: `Add one ${item.name}`, exact: true });
}

function minus(page: Page, item: { name: string }): Locator {
  return page.getByRole("button", { name: `Remove one ${item.name}`, exact: true });
}

function batchQuantity(page: Page, item: { name: string }): Locator {
  return page.getByLabel(`Batch quantity for ${item.name}`, { exact: true });
}

const bar = ".storage-batch-panel";

function withdrawal(page: Page): Locator {
  return page.locator(bar).getByRole("button", { name: "Withdrawal", exact: true });
}

async function expectSummary(page: Page, selected: number, units: number) {
  const values = page.locator(`${bar} .storage-batch-bar__value`);
  await expect(values.first(), "已选件数").toHaveText(String(selected));
  await expect(values.last(), "总数量").toHaveText(String(units));
}

async function startBatch(page: Page, flow: import("../../support/test").Flow) {
  // 开批量只切前端状态，一个请求都不该发。
  await flow.clickWithoutApi(page.getByRole("button", { name: "Batch operation", exact: true }));
  await expect(page.locator(bar)).toBeVisible();
}

test("开启批量：卡片换成 ± 控件，汇总从 0 起，复核按钮此时按不动", async ({ page, flow }) => {
  await startBatch(page, flow);

  await expectSummary(page, 0, 0);
  await expect(page.getByRole("button", { name: "Review batch", exact: true })).toBeDisabled();
  await expect(plus(page, itemA)).toBeVisible();
  await expect(
    card(page, itemA).getByRole("button", { name: "Deposit", exact: true }),
    "进入批量后单件的存取按钮应当让位给 ± ",
  ).toHaveCount(0);
  await expect(minus(page, itemA), "数量为 0 时减号该是禁用的").toBeDisabled();
});

test("± 控件累加递减，批量条上的件数与总量实时跟着变，且全程不发请求", async ({ page, flow }) => {
  await startBatch(page, flow);

  await flow.clickWithoutApi(plus(page, itemA));
  await flow.clickWithoutApi(plus(page, itemA));
  await flow.clickWithoutApi(plus(page, itemB));

  await expect(batchQuantity(page, itemA)).toHaveText("2");
  await expect(batchQuantity(page, itemB)).toHaveText("1");
  await expectSummary(page, 2, 3);

  await flow.clickWithoutApi(minus(page, itemA));
  await expect(batchQuantity(page, itemA)).toHaveText("1");
  await expectSummary(page, 2, 2);

  await flow.clickWithoutApi(minus(page, itemA));
  await expect(batchQuantity(page, itemA)).toHaveText("0");
  // 归零就不再算作一件已选，件数必须跟着退回 1。
  await expectSummary(page, 1, 1);
});

test("出库方向下：库存为 0 的物品加不进批量", async ({ page, flow }) => {
  await startBatch(page, flow);
  await flow.clickWithoutApi(withdrawal(page));

  await expect(
    plus(page, itemA),
    "库存是 0，出库方向下不该允许把它加进批量",
  ).toBeDisabled();
});

test("换方向要二次确认：取消保留已选，确认则清空", async ({ page, flow }) => {
  await startBatch(page, flow);
  await flow.clickWithoutApi(plus(page, itemA));
  await expectSummary(page, 1, 1);

  const title = "Change direction and clear the selected items?";

  await flow.clickWithoutApi(withdrawal(page));
  await (await confirmDialog(page, title)).getByRole("button", { name: "Cancel", exact: true }).click();
  await expectSummary(page, 1, 1);

  await flow.clickWithoutApi(withdrawal(page));
  await (await confirmDialog(page, title)).getByRole("button", { name: "Confirm", exact: true }).click();
  await expectSummary(page, 0, 0);
});

test("复核抽屉：领取人必须显式选择，逐项移除和清空都会同步回汇总", async ({ page, flow }) => {
  await startBatch(page, flow);
  await flow.clickWithoutApi(plus(page, itemA));
  await flow.clickWithoutApi(plus(page, itemB));

  await page.getByRole("button", { name: "Review batch", exact: true }).click();
  const drawer = dialogTitled(page, "Review batch");
  /*
   * 领取人这条记录决定整批货算在谁头上，管理员必须自己选，不能有默认值
   * （apps/portal/components/pages/StoragePage.tsx 的 defaultRecipientId）。
   * 所以初始状态必须是：尚未选中成员、原因写在字段上、提交按钮按不动。
   */
  await expect(drawer.getByText("Select the member associated with this batch before submitting.", { exact: true }))
    .toBeVisible();
  await expect(drawer.getByRole("button", { name: "Submit 2 items", exact: true })).toBeDisabled();

  // 选了人之后才解锁提交。
  await selectOption(drawer, "Member", "member_01");
  await expect(drawer.getByText("Select the member associated with this batch before submitting.", { exact: true }))
    .toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Submit 2 items", exact: true })).toBeEnabled();

  await drawer.getByRole("button", { name: `Remove ${itemA.name} from batch`, exact: true }).click();
  await expect(drawer.getByRole("button", { name: "Submit 1 items", exact: true })).toBeVisible();
  await expectSummary(page, 1, 1);

  await drawer.getByRole("button", { name: "Clear batch", exact: true }).click();
  await (await confirmDialog(page, "Clear all selected batch items?"))
    .getByRole("button", { name: "Confirm", exact: true }).click();
  await expectSummary(page, 0, 0);
});

test("批量入库完整链路：两件物品的服务端库存各自按量增加，各留一条流水", async ({ page, flow, api }) => {
  await startBatch(page, flow);
  await flow.clickWithoutApi(plus(page, itemA));
  await flow.clickWithoutApi(plus(page, itemA));
  await flow.clickWithoutApi(plus(page, itemB));

  await page.getByRole("button", { name: "Review batch", exact: true }).click();
  const drawer = dialogTitled(page, "Review batch");
  await selectOption(drawer, "Member", "member_01");
  await drawer.getByLabel("Note", { exact: true }).fill("e2e batch");

  await flow.click(
    drawer.getByRole("button", { name: "Submit 2 items", exact: true }),
    BATCH_REQUEST,
  );

  // 提交成功后草稿整个消失，批量条也跟着收起。
  await expect(page.locator(bar)).toHaveCount(0);
  expect(await readInteger(card(page, itemA).locator(".storage-item-card__stock-value"), `${itemA.name} 的库存`)).toBe(2);
  expect(await readInteger(card(page, itemB).locator(".storage-item-card__stock-value"), `${itemB.name} 的库存`)).toBe(1);

  for (const [item, expected] of [[itemA, 2], [itemB, 1]] as const) {
    expect(
      (await readJson(await api.get(`/api/storage/items/${item.id}`), `回读 ${item.name}`) as { quantity: number }).quantity,
      `${item.name} 的服务端库存必须是 ${expected}`,
    ).toBe(expected);
    const ledger = await readJson(
      await api.get(`/api/storage/transactions?page=1&limit=20&item_id=${item.id}`),
      `回读 ${item.name} 的流水`,
    ) as { data: { type: string; quantity_delta: number }[] };
    expect(
      ledger.data.map(({ type, quantity_delta }) => `${type}:${quantity_delta}`),
      `${item.name} 应当只留下一条 +${expected} 的入库流水`,
    ).toEqual([`intake:${expected}`]);
  }
});

test("关闭批量：有草稿时要确认，取消则草稿还在", async ({ page, flow }) => {
  await startBatch(page, flow);
  await flow.clickWithoutApi(plus(page, itemA));

  const close = page.getByRole("button", { name: "Close batch", exact: true });
  const title = "Discard this batch draft?";

  await close.click();
  await (await confirmDialog(page, title)).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(bar)).toBeVisible();
  await expectSummary(page, 1, 1);

  await close.click();
  await (await confirmDialog(page, title)).getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.locator(bar)).toHaveCount(0);
});
