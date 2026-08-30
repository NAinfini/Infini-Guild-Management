import type { APIRequestContext, Page } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { createTestStorage } from "../../support/storage";
import { field, selectFilterOption } from "../../support/ui";

const ITEMS = { method: "GET", path: /^\/api\/storage\/items$/ } as const;
const CARD = ".storage-item-card";

type Sample = { id: string; name: string; updatedAt: string };

let storageId: string;
let deposit: Sample;
let withdraw: Sample;

test.beforeEach(async ({ page, api }) => {
  const storage = await createTestStorage(api, "Filters", ["Deposit", "Withdraw"]);
  storageId = storage.id;
  const stamp = Date.now();
  deposit = await createSample(api, storage.id, storage.categories[0]!.id, `${SYSTEM_TEST_CONTENT_MARKER} Deposit ${stamp}`, true, false);
  withdraw = await createSample(api, storage.id, storage.categories[1]!.id, `${SYSTEM_TEST_CONTENT_MARKER} Withdraw ${stamp}`, false, true);

  await page.goto(`/storage?storageId=${storageId}`);
  await expect(card(page, deposit.name)).toHaveCount(1);
  await expect(card(page, withdraw.name)).toHaveCount(1);
});

test.afterEach(async ({ api }) => {
  for (const sample of [deposit, withdraw]) {
    const response = await api.delete(`/api/storage/items/${sample.id}`, {
      data: { expected_updated_at: sample.updatedAt },
    });
    expect(response.ok(), `删除筛选样本 ${sample.name} 失败`).toBe(true);
  }
});

async function createSample(
  api: APIRequestContext,
  storageId: string,
  categoryId: string,
  name: string,
  allowMemberDeposit: boolean,
  allowMemberWithdraw: boolean,
): Promise<Sample> {
  const data = await readJson(
    await api.post("/api/storage/items", {
      data: {
        storage_id: storageId,
        category_id: categoryId,
        name,
        description: null,
        allow_member_deposit: allowMemberDeposit,
        allow_member_withdraw: allowMemberWithdraw,
      },
    }),
    `创建库存样本 ${name}`,
  ) as { id: string; quantity: number; updated_at: string };
  expect(data.quantity).toBe(0);
  return { id: data.id, name, updatedAt: data.updated_at };
}

function card(page: Page, name: string) {
  return page.locator(CARD).filter({ hasText: name });
}

test("库存搜索和成员能力筛选只返回匹配物品", async ({ page, flow }) => {
  await flow.act(() => field(page, "Search items").fill(deposit.name), ITEMS);
  await expect(card(page, deposit.name)).toHaveCount(1);
  await expect(card(page, withdraw.name)).toHaveCount(0);

  await flow.act(
    () => selectFilterOption(page, page.locator(".storage-command"), "Stock", "Member deposit"),
    ITEMS,
  );
  await expect(card(page, deposit.name)).toHaveCount(1);
  await expect(card(page, withdraw.name)).toHaveCount(0);

  await field(page, "Search items").fill("");
  await flow.act(
    () => selectFilterOption(page, page.locator(".storage-command"), "Stock", "Member withdraw"),
    ITEMS,
  );
  await expect(card(page, deposit.name)).toHaveCount(0);
  await expect(card(page, withdraw.name)).toHaveCount(1);
});
