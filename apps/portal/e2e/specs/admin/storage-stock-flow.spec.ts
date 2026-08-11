import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { createTestStorage } from "../../support/storage";
import { expectNoDialog, readInteger, selectOption, topDialog } from "../../support/ui";

/*
 * 整条库存变更流水线：新建物品 → 存入 → 取出。
 *
 * 只操作本次跑出来的一次性物品，绝不碰种子数据：既有物品被流水引用，
 * 改了没有任何回滚路径。物品本身由 POST /api/storage/items 登记进清理注册表；
 * 整轮精确补偿会先删流水，再按已登记主键删除物品，收尾指纹必须归零。
 *
 * 每一步都要求三件事同时成立：请求真的发出去了、UI 数字变了、服务端数据也变了。
 * 少任何一件都算这个控件没通——按钮可能没绑事件，也可能只改了前端状态。
 */
test("库存全流程：存入加库存、取出减库存，UI 与服务端必须一致", async ({ page, flow, api }) => {
  const itemName = `${SYSTEM_TEST_CONTENT_MARKER} E2E Stock ${Date.now()}`;
  const storage = await createTestStorage(api, "Stock Flow");

  await page.goto(`/storage?storageId=${storage.id}`);

  // 新建物品
  await page.getByRole("button", { name: "New Item", exact: true }).first().click();
  const editor = topDialog(page);
  await editor.getByLabel("Item name", { exact: true }).fill(itemName);

  const created = await flow.click(
    editor.getByRole("button", { name: "New Item", exact: true }),
    { method: "POST", path: /^\/api\/storage\/items$/ },
  ) as { id: string; name: string; quantity: number };

  expect(created.name).toBe(itemName);
  expect(created.quantity).toBe(0);

  /*
   * 新建成功后抽屉按设计留在编辑态（接着能传图），所以先等它真的切过去再关。
   * flow.click 在 HTTP 响应到达时就返回了，那时 onSuccess 还没跑；
   * 此刻抢着点取消，会关掉一个马上又被 onSuccess 打开的抽屉。
   */
  await expect(editor.getByRole("button", { name: "Delete Item", exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectNoDialog(page);

  const card = page.locator(".storage-item-card").filter({ hasText: itemName });
  const stock = card.locator(".storage-item-card__stock-value");
  await expect(card).toHaveCount(1);
  expect(await readInteger(stock, "新建后的库存")).toBe(0);

  // 存入 10
  await card.getByRole("button", { name: "Deposit", exact: true }).click();
  const depositModal = topDialog(page);
  await depositModal.getByLabel("Quantity", { exact: true }).fill("10");
  await flow.click(
    depositModal.getByRole("button", { name: "Submit", exact: true }),
    { method: "POST", path: /^\/api\/storage\/items\/[^/]+\/transactions$/ },
  );

  await expect(stock).toHaveText("10");
  expect(
    (await readJson(await api.get(`/api/storage/items/${created.id}`), "存入后回读物品") as { quantity: number }).quantity,
    "存入 10 之后服务端库存必须是 10",
  ).toBe(10);

  // 取出 3
  await card.getByRole("button", { name: "Withdraw", exact: true }).click();
  const withdrawModal = topDialog(page);
  await selectOption(withdrawModal, "Member", "member_01");
  await withdrawModal.getByLabel("Quantity", { exact: true }).fill("3");
  await flow.click(
    withdrawModal.getByRole("button", { name: "Submit", exact: true }),
    { method: "POST", path: /^\/api\/storage\/items\/[^/]+\/transactions$/ },
  );

  await expect(stock).toHaveText("7");
  expect(
    (await readJson(await api.get(`/api/storage/items/${created.id}`), "取出后回读物品") as { quantity: number }).quantity,
    "取出 3 之后服务端库存必须是 7",
  ).toBe(7);

  // 核对服务端流水
  const ledger = await readJson(
    await api.get(`/api/storage/transactions?page=1&limit=20&item_id=${created.id}`),
    "回读流水",
  ) as { data: { type: string; quantity_delta: number }[] };
  const deltas = ledger.data.map(({ type, quantity_delta }) => `${type}:${quantity_delta}`).sort();
  expect(deltas, "存入和取出各应留下一条方向正确的流水").toEqual(["distribute:-3", "intake:10"]);
});
