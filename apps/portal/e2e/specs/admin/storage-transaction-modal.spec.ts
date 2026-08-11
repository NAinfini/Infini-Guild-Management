import type { Locator, Page } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { createTestStorage } from "../../support/storage";
import { expectNoDialog, selectOption, topDialog } from "../../support/ui";

/*
 * 出入库弹窗的每一个控件：类型分段器、物品下拉、领取人下拉、数量、备注、取消、提交。
 *
 * 这个弹窗是整个库存功能里唯一能改数字的地方，所以断言分三层：
 *   1. 控件切换后，界面上的**推演**要对（当前库存 → 变更后库存、增减徽章）；
 *   2. 非法输入必须报出具体那一条校验，并且提交按钮真的按不下去；
 *   3. 合法提交后，服务端库存和流水都要跟着变——UI 对不等于数据对。
 *
 * 每条用例只动本次自己造的一次性物品：既有物品被种子流水引用，改了没有回滚路径。
 * 物品由 POST /api/storage/items 登记进清理注册表；整轮精确补偿会先删流水，
 * 再按已登记主键删除物品。产品接口必须继续拒绝删除已有流水的物品。
 */

const TRANSACTION_REQUEST = {
  method: "POST",
  path: /^\/api\/storage\/items\/[^/]+\/transactions$/,
} as const;

const START_STOCK = 10;

let storageId: string;
let itemId: string;
let itemName: string;

test.beforeEach(async ({ page, api }) => {
  storageId = (await createTestStorage(api, "Transaction")).id;
  itemName = `${SYSTEM_TEST_CONTENT_MARKER} Tx ${Date.now()}`;

  const created = await readJson(
    await api.post("/api/storage/items", {
      data: {
        storage_id: storageId,
        category_id: null,
        name: itemName,
        description: null,
        allow_member_deposit: true,
        allow_member_withdraw: true,
      },
    }),
    "创建一次性物品",
  ) as { id: string; quantity: number };
  itemId = created.id;

  // 给个已知起点：后面所有推演断言都以 10 为基准。
  const stocked = await readJson(
    await api.post(`/api/storage/items/${itemId}/transactions`, {
      data: { type: "intake", quantity: START_STOCK, recipient_user_id: null, note: null },
    }),
    "预置起始库存",
  ) as { quantity_delta: number };
  expect(stocked.quantity_delta, "预置入库必须是 +10").toBe(START_STOCK);

  await page.goto(`/storage?storageId=${storageId}`);
  await expect(stockValue(page)).toHaveText(String(START_STOCK));
});

function itemCard(page: Page): Locator {
  return page.locator(".storage-item-card").filter({ hasText: itemName });
}

function stockValue(page: Page): Locator {
  return itemCard(page).locator(".storage-item-card__stock-value");
}

/* Mantine 的分段器把 radio 藏了起来，用户点的是 label——这里也点 label。 */
function segment(dialog: Locator, name: string): Locator {
  return dialog.locator("label").filter({ hasText: new RegExp(`^${name}$`) });
}

async function expectPreview(dialog: Locator, before: number, after: number, delta: string) {
  const values = dialog.locator(".storage-transaction-flow__value");
  await expect(values.first(), "当前库存").toHaveText(String(before));
  await expect(values.last(), "变更后库存").toHaveText(String(after));
  await expect(dialog.locator(".storage-transaction-modal__item-line").getByText(delta, { exact: true }))
    .toHaveCount(1);
}

async function openDeposit(page: Page): Promise<Locator> {
  await itemCard(page).getByRole("button", { name: "Deposit", exact: true }).click();
  const dialog = topDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

test("存入弹窗打开时：类型为 Intake，领取人可选，预览是 10 → 11", async ({ page }) => {
  const dialog = await openDeposit(page);

  await expect(dialog.getByRole("radio", { name: "Intake", exact: true })).toBeChecked();
  await expect(dialog.getByLabel("Quantity", { exact: true })).toHaveValue("1");
  await expect(dialog.getByLabel("Member (optional)", { exact: true })).toBeVisible();
  await expectPreview(dialog, START_STOCK, START_STOCK + 1, "+1");
  // 入库不需要领取人，按钮此刻就该是可按的。
  await expect(dialog.getByRole("button", { name: "Submit", exact: true })).toBeEnabled();
});

test("切到 Distribute：领取人变必填，预览转为减库存，选人后才能提交", async ({ page }) => {
  const dialog = await openDeposit(page);
  await segment(dialog, "Distribute").click();

  await expect(dialog.getByRole("radio", { name: "Distribute", exact: true })).toBeChecked();
  await expect(dialog.getByLabel("Member", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Quantity", { exact: true })).toHaveValue("1");
  await expectPreview(dialog, START_STOCK, START_STOCK - 1, "-1");

  const submit = dialog.getByRole("button", { name: "Submit", exact: true });
  await expect(submit, "没指定领取人时出库必须按不下去").toBeDisabled();

  await selectOption(dialog, "Member", "member_01");
  await expect(submit).toBeEnabled();
});

test("切到 Adjust：领取人消失，数量预填当前库存，没变化时禁止提交", async ({ page }) => {
  const dialog = await openDeposit(page);
  await segment(dialog, "Adjust").click();

  await expect(dialog.getByLabel("Member (optional)", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Member", { exact: true })).toHaveCount(0);
  const target = dialog.getByLabel("Target stock", { exact: true });
  await expect(target).toHaveValue(String(START_STOCK));
  await expectPreview(dialog, START_STOCK, START_STOCK, "0");
  await expect(dialog.getByText("Enter a target stock total that differs from the current stock.")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Submit", exact: true }),
    "目标库存和当前库存一样时不该允许提交",
  ).toBeDisabled();

  await target.fill("4");
  await expectPreview(dialog, START_STOCK, 4, "-6");
  await expect(dialog.getByRole("button", { name: "Submit", exact: true })).toBeEnabled();
});

test("校验：出库数量超过库存会报错并禁用提交", async ({ page }) => {
  const dialog = await openDeposit(page);
  await segment(dialog, "Distribute").click();
  await selectOption(dialog, "Member", "member_01");

  await dialog.getByLabel("Quantity", { exact: true }).fill(String(START_STOCK + 1));

  await expect(dialog.getByText("Quantity exceeds current stock.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Submit", exact: true })).toBeDisabled();
});

test("校验：非整数数量会报错并禁用提交", async ({ page }) => {
  const dialog = await openDeposit(page);

  await dialog.getByLabel("Quantity", { exact: true }).fill("1.5");

  await expect(dialog.getByText("Enter a whole number.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Submit", exact: true })).toBeDisabled();
});

test("取消：填了数量也不产生任何请求，服务端库存原封不动", async ({ page, flow, api }) => {
  const dialog = await openDeposit(page);
  await dialog.getByLabel("Quantity", { exact: true }).fill("5");

  await flow.clickWithoutApi(dialog.getByRole("button", { name: "Cancel", exact: true }));

  await expectNoDialog(page);
  await expect(stockValue(page)).toHaveText(String(START_STOCK));
  expect(
    (await readJson(await api.get(`/api/storage/items/${itemId}`), "取消后回读物品") as { quantity: number }).quantity,
    "取消不该改动服务端库存",
  ).toBe(START_STOCK);
});

test("Adjust 完整链路：目标库存 4 落到服务端，并留下一条 -6 的盘点流水", async ({ page, flow, api }) => {
  const dialog = await openDeposit(page);
  await segment(dialog, "Adjust").click();
  await dialog.getByLabel("Target stock", { exact: true }).fill("4");

  await flow.click(
    dialog.getByRole("button", { name: "Submit", exact: true }),
    TRANSACTION_REQUEST,
  );

  await expect(stockValue(page)).toHaveText("4");
  expect(
    (await readJson(await api.get(`/api/storage/items/${itemId}`), "盘点后回读物品") as { quantity: number }).quantity,
    "盘点到 4 之后服务端库存必须是 4",
  ).toBe(4);

  const ledger = await readJson(
    await api.get(`/api/storage/transactions?page=1&limit=20&item_id=${itemId}`),
    "回读流水",
  ) as { data: { type: string; quantity_delta: number }[] };
  expect(
    ledger.data.map(({ type, quantity_delta }) => `${type}:${quantity_delta}`).sort(),
    "预置入库 +10 之外，盘点应当只补一条 -6",
  ).toEqual(["adjust:-6", "intake:10"]);
});

test("Manual Entry：物品下拉可搜索，选中后预览换成该物品", async ({ page, flow }) => {
  await page.getByRole("button", { name: "Manual Entry", exact: true }).click();
  const dialog = topDialog(page);
  await expect(dialog.getByText("Choose an item to preview the stock change.")).toBeVisible();

  const itemSelect = dialog.getByLabel("Item", { exact: true });
  await itemSelect.click();
  // 物品下拉的搜索是服务端的，敲字必须真的把查询发出去。
  await flow.act(
    () => itemSelect.fill(itemName),
    { method: "GET", path: /^\/api\/storage\/items$/ },
  );

  await page.getByRole("option", { name: `${itemName} (${START_STOCK})`, exact: true }).click();

  await expect(dialog.locator(".storage-transaction-modal__item-line")).toContainText(itemName);
  await expectPreview(dialog, START_STOCK, START_STOCK + 1, "+1");
});
