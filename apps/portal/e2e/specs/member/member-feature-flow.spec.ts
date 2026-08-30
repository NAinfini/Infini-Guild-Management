import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { request, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { MUTATION_HEADERS } from "../../support/api";
import { PORTAL_ORIGIN, SLOT_INDEX, stateFileFor } from "../../support/config";
import { expect, identityHeaders, readJson, test } from "../../support/test";
import { confirmDialog, readInteger, topDialog } from "../../support/ui";

const JOIN_EVENT = { method: "POST", path: /^\/api\/events\/[^/]+\/join$/ } as const;
const LEAVE_EVENT = { method: "DELETE", path: /^\/api\/events\/[^/]+\/leave$/ } as const;
const STORAGE_TRANSACTION = {
  method: "POST",
  path: /^\/api\/storage\/items\/[^/]+\/transactions$/,
} as const;

type EventDetail = {
  participants: Array<{ user_id: string }>;
};

type Inbox = {
  data: Array<{
    id: string;
    entity_id: string;
    kind: string;
    payload: { title?: string };
    read_at: string | null;
  }>;
};

async function createTrackedAdminApi(apiClientAddress: string): Promise<APIRequestContext> {
  return await request.newContext({
    baseURL: PORTAL_ORIGIN,
    storageState: stateFileFor("admin", SLOT_INDEX),
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      ...MUTATION_HEADERS,
      ...identityHeaders(apiClientAddress, true),
    },
  });
}

function eventCard(page: Page, title: string): Locator {
  return page.locator(".event-card").filter({ hasText: title });
}

function storageCard(page: Page, name: string): Locator {
  return page.locator(".storage-item-card").filter({ hasText: name });
}

test("ordinary member joins and leaves an event without receiving management controls", async ({
  page,
  api,
  flow,
  apiClientAddress,
}) => {
  const adminApi = await createTrackedAdminApi(apiClientAddress);
  const stamp = Date.now();
  const title = `${SYSTEM_TEST_CONTENT_MARKER} Member Event ${stamp}`;
  let eventId: string | null = null;

  try {
    const created = await readJson(await adminApi.post("/api/events", {
      data: {
        type: "social",
        title,
        start_at: new Date(Date.now() + 400 * 24 * 60 * 60_000).toISOString(),
        end_at: new Date(Date.now() + 400 * 24 * 60 * 60_000 + 2 * 60 * 60_000).toISOString(),
      },
    }), "管理员创建普通成员报名活动") as { id: string };
    eventId = created.id;

    const me = await readJson(await api.get("/api/auth/me"), "回读普通成员会话") as {
      user: { id: string };
    };
    await page.goto(`/events?search=${stamp}`);
    const card = eventCard(page, title);
    await expect(card).toHaveCount(1);
    await expect(
      card.getByRole("button", { name: "Event actions", exact: true }),
      "普通成员不能得到活动管理菜单",
    ).toHaveCount(0);

    await flow.click(card.getByRole("button", { name: "Join", exact: true }), JOIN_EVENT);
    await expect(card.locator(".event-card__capacity")).toHaveText("1/∞");
    expect(
      (await readJson(await api.get(`/api/events/${eventId}`), "报名后回读活动") as EventDetail)
        .participants.map(({ user_id }) => user_id),
    ).toEqual([me.user.id]);

    const leave = card.getByRole("button", { name: "Cancel signup", exact: true });
    await leave.click();
    await flow.act(async () => {
      await (await confirmDialog(page, "Leave event?"))
        .getByRole("button", { name: "Confirm", exact: true }).click();
    }, LEAVE_EVENT);

    await expect(card.locator(".event-card__capacity")).toHaveText("0/∞");
    expect(
      (await readJson(await api.get(`/api/events/${eventId}`), "退出后回读活动") as EventDetail).participants,
    ).toEqual([]);
  } finally {
    if (eventId) {
      const removed = await adminApi.delete(`/api/events/${eventId}/destroy`);
      expect([200, 204, 404], `清理普通成员活动返回 ${removed.status()}`).toContain(removed.status());
    }
    await adminApi.dispose();
  }
});

test("ordinary member deposits and withdraws only through an item opened to members", async ({
  page,
  api,
  flow,
  apiClientAddress,
}) => {
  const adminApi = await createTrackedAdminApi(apiClientAddress);
  const stamp = Date.now();
  const itemName = `${SYSTEM_TEST_CONTENT_MARKER} Member Stock ${stamp}`;

  try {
    const storage = await readJson(await adminApi.post("/api/storage/storages", {
      data: { name: `${SYSTEM_TEST_CONTENT_MARKER} Member Storage ${stamp}`, description: null },
    }), "管理员创建普通成员仓库") as { id: string };
    const item = await readJson(await adminApi.post("/api/storage/items", {
      data: {
        storage_id: storage.id,
        category_id: null,
        name: itemName,
        description: null,
        allow_member_deposit: true,
        allow_member_withdraw: true,
      },
    }), "管理员创建开放存取物品") as { id: string };
    await readJson(await adminApi.post(`/api/storage/items/${item.id}/transactions`, {
      data: {
        idempotency_key: `e2e-member-stock-${item.id}`,
        type: "intake",
        quantity: 5,
        recipient_user_id: null,
        note: null,
      },
    }), "管理员预置普通成员物品库存");

    const me = await readJson(await api.get("/api/auth/me"), "回读普通成员会话") as {
      user: { id: string };
    };
    await page.goto(`/storage?storageId=${storage.id}`);
    const card = storageCard(page, itemName);
    const stock = card.locator(".storage-item-card__stock-value");
    await expect(card).toHaveCount(1);
    expect(await readInteger(stock, "普通成员初始库存")).toBe(5);
    await expect(page.getByRole("button", { name: "New Item", exact: true })).toHaveCount(0);

    await card.getByRole("button", { name: "Deposit", exact: true }).click();
    const deposit = topDialog(page);
    await expect(deposit.getByRole("combobox"), "普通成员不能替别人选择领取人").toHaveCount(0);
    await deposit.getByLabel("Quantity", { exact: true }).fill("2");
    await flow.click(
      deposit.getByRole("button", { name: "Submit Deposit", exact: true }),
      STORAGE_TRANSACTION,
    );
    await expect.poll(() => readInteger(stock, "普通成员存入后库存")).toBe(7);

    await card.getByRole("button", { name: "Withdraw", exact: true }).click();
    const withdraw = topDialog(page);
    await expect(withdraw.getByRole("combobox"), "普通成员出库默认绑定自己").toHaveCount(0);
    await withdraw.getByLabel("Quantity", { exact: true }).fill("3");
    await flow.click(
      withdraw.getByRole("button", { name: "Submit Withdraw", exact: true }),
      STORAGE_TRANSACTION,
    );
    await expect.poll(() => readInteger(stock, "普通成员取出后库存")).toBe(4);

    const persisted = await readJson(await api.get(`/api/storage/items/${item.id}`), "普通成员回读最终库存") as {
      quantity: number;
    };
    expect(persisted.quantity).toBe(4);
    const ledger = await readJson(
      await adminApi.get(`/api/storage/transactions?page=1&limit=20&item_id=${item.id}`),
      "管理员回读普通成员库存流水",
    ) as {
      data: Array<{ actor_id: string; quantity_delta: number; recipient_user_id: string | null }>;
    };
    const memberRows = ledger.data.filter(({ actor_id }) => actor_id === me.user.id);
    expect(memberRows.map(({ quantity_delta }) => quantity_delta).sort((left, right) => left - right))
      .toEqual([-3, 2]);
    expect(memberRows.map(({ recipient_user_id }) => recipient_user_id)).toEqual([me.user.id, me.user.id]);
  } finally {
    await adminApi.dispose();
  }
});

test("ordinary member opens an announcement notification, marks it read, and lands on its detail", async ({
  page,
  api,
  apiClientAddress,
}) => {
  const adminApi = await createTrackedAdminApi(apiClientAddress);
  const title = `${SYSTEM_TEST_CONTENT_MARKER} Member Notice ${Date.now()}`;
  let announcementId: string | null = null;

  try {
    const announcement = await readJson(await adminApi.post("/api/announcements", {
      data: {
        title,
        category: "announcement",
        body_json: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Member notification route." }] }],
        }),
        pinned: false,
        status: "published",
      },
    }), "管理员发布普通成员通知公告") as { id: string };
    announcementId = announcement.id;

    let notificationId: string | null = null;
    await expect.poll(async () => {
      const inbox = await readJson(await api.get("/api/notifications?limit=50"), "普通成员读取通知") as Inbox;
      notificationId = inbox.data.find((item) =>
        item.kind === "announcement_published"
        && item.entity_id === announcementId
        && item.payload.title === title)?.id ?? null;
      return notificationId;
    }).not.toBeNull();

    await page.goto("/dashboard");
    await page.getByRole("button", { name: /Notifications/, exact: false }).click();
    const notification = page.getByRole("dialog").getByRole("button", {
      name: `Open Announcement Published: ${title} notification`,
      exact: true,
    });
    await expect(notification).toBeVisible();

    const markRead = page.waitForResponse((response) =>
      response.request().method() === "PATCH"
      && new URL(response.url()).pathname === "/api/notifications/read");
    await notification.click();
    expect((await markRead).ok(), "打开通知必须成功写入已读状态").toBe(true);
    await expect(page).toHaveURL(new RegExp(`/announcements/${announcementId}$`));
    await expect(page.locator(".announcement-reader-title")).toHaveText(title);

    await expect.poll(async () => {
      const inbox = await readJson(await api.get("/api/notifications?limit=50"), "回读通知已读状态") as Inbox;
      return inbox.data.find(({ id }) => id === notificationId)?.read_at ?? null;
    }).not.toBeNull();
  } finally {
    if (announcementId) {
      const detail = await adminApi.get(`/api/announcements/${announcementId}`);
      if (detail.status() === 200) {
        const etag = detail.headers().etag;
        expect(etag, "通知公告必须带 ETag 才能精确清理").toBeTruthy();
        const removed = await adminApi.delete(`/api/announcements/${announcementId}/permanent`, {
          headers: { "If-Match": etag as string },
        });
        expect([200, 204, 404], `清理通知公告返回 ${removed.status()}`).toContain(removed.status());
      }
    }
    await adminApi.dispose();
  }
});
