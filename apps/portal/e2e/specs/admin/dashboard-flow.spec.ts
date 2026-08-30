import type { APIRequestContext } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { clientIdentityHeaders, PORTAL_ORIGIN, SLOT_INDEX, stateFileFor } from "../../support/config";
import { expect, readJson, test } from "../../support/test";

type DashboardEventFixture = Readonly<{ id: string; title: string }>;

async function createDashboardEvent(
  api: APIRequestContext,
  title: string,
): Promise<DashboardEventFixture> {
  const startAt = new Date(Date.now() + 2 * 60 * 60_000);
  return await readJson(
    await api.post("/api/events", {
      data: {
        type: "social",
        title,
        start_at: startAt.toISOString(),
        end_at: new Date(startAt.getTime() + 60 * 60_000).toISOString(),
        capacity: 1,
      },
    }),
    "创建仪表盘活动",
  ) as DashboardEventFixture;
}

async function createDashboardFixtures(api: APIRequestContext) {
  const stamp = Date.now();
  const event = await createDashboardEvent(api, `${SYSTEM_TEST_CONTENT_MARKER} Dashboard event ${stamp}`);
  await readJson(await api.post(`/api/events/${event.id}/join`), "报名仪表盘活动");

  const warName = `${SYSTEM_TEST_CONTENT_MARKER} Dashboard war ${stamp}`;
  await readJson(
    await api.post("/api/guild-war/history", {
      data: {
        war_name: warName,
        enemy_name: `Dashboard opponent ${stamp}`,
        result: "win",
        own_stats: { kills: 12, towers: 3 },
        enemy_stats: { kills: 8, towers: 1 },
      },
    }),
    "创建仪表盘战史",
  ) as { id: string };

  const announcementTitle = `${SYSTEM_TEST_CONTENT_MARKER} Dashboard bulletin ${stamp}`;
  const announcement = await readJson(
    await api.post("/api/announcements", {
      data: {
        title: announcementTitle,
        body_json: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "dashboard fixture" }] }],
        }),
        category: "announcement",
        pinned: true,
        status: "published",
        publish_at: new Date().toISOString(),
      },
    }),
    "创建仪表盘公告",
  ) as { id: string };

  return { event, warName, announcement, announcementTitle };
}

test("仪表盘卡片展示真实数据，并进入对应工作区", async ({ page, api }) => {
  const fixture = await createDashboardFixtures(api);

  await page.goto("/dashboard");

  const signups = page.locator(".dashboard-workspace__signups");
  await expect(signups.getByRole("heading", { name: "My Signups", exact: true })).toBeVisible();
  await expect(signups).toContainText(fixture.event.title);

  const attention = page.locator(".dashboard-attention");
  await expect(attention.getByRole("heading", { name: "Events to watch", exact: true })).toBeVisible();
  await expect(attention).toContainText(fixture.event.title);
  await expect(attention.getByText("Starting soon", { exact: true })).toBeVisible();
  await expect(attention.getByText("At capacity", { exact: true })).toBeVisible();

  const warCard = page.locator(".war-report-card");
  await expect(warCard.getByRole("heading", { name: "Recent guild wars", exact: true })).toBeVisible();
  await expect(warCard).toContainText(fixture.warName);

  const bulletin = page.locator(".dashboard-bulletin-card");
  await expect(bulletin.getByText("Latest guild bulletin", { exact: true })).toBeVisible();
  await expect(bulletin).toContainText(fixture.announcementTitle);

  await signups.getByRole("button").filter({ hasText: fixture.event.title }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${fixture.event.id}$`));

  await page.goto("/dashboard");
  const eventRow = page.locator(".upcoming-event-row").filter({ hasText: fixture.event.title });
  await expect(eventRow).toBeVisible();
  await eventRow.getByRole("button", { name: "View event", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${fixture.event.id}$`));

  await page.goto("/dashboard");
  await page.locator(".war-report-card").getByRole("button", { name: "View report", exact: true }).click();
  await expect(page).toHaveURL((url) => (
    url.pathname === "/guild-war"
    && url.searchParams.get("tab") === "history"
    && url.searchParams.get("warName") === fixture.warName
  ));

  await page.goto("/dashboard");
  await page.locator(".dashboard-bulletin-card")
    .getByRole("button").filter({ hasText: fixture.announcementTitle })
    .click();
  await expect(page).toHaveURL(new RegExp(`/announcements/${fixture.announcement.id}$`));
});

test("仪表盘初始读取失败后，重试能恢复真实活动数据", async ({ api, browser, clientAddress }) => {
  const title = `${SYSTEM_TEST_CONTENT_MARKER} Dashboard retry ${Date.now()}`;
  await createDashboardEvent(api, title);

  // 默认 page 会将所有 5xx 归为产品缺陷；本条故意注入一次 5xx，因此隔离出专用页面。
  const context = await browser.newContext({
    baseURL: PORTAL_ORIGIN,
    storageState: stateFileFor("admin", SLOT_INDEX),
    ignoreHTTPSErrors: true,
    locale: "en-US",
    timezoneId: "UTC",
    extraHTTPHeaders: clientIdentityHeaders(clientAddress),
  });
  const retryPage = await context.newPage();
  let eventRequests = 0;
  await retryPage.route("**/api/dashboard/events", async (route) => {
    eventRequests += 1;
    // 全局 QueryClient 会自动重试一次瞬时 5xx；连续两次失败才会进入显式错误态。
    if (eventRequests <= 2) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error_code: "SERVER_ERROR", message: "temporary dashboard failure" }),
      });
      return;
    }
    await route.continue();
  });

  try {
    await retryPage.goto("/dashboard");
    await expect(retryPage.getByText("Unable to load data. Please try again later.", { exact: true })).toBeVisible();

    const retried = retryPage.waitForResponse((response) => (
      response.request().method() === "GET"
      && new URL(response.url()).pathname === "/api/dashboard/events"
      && response.status() === 200
    ));
    await retryPage.getByRole("button", { name: "Retry", exact: true }).click();
    await retried;

    await expect(retryPage.locator(".upcoming-event-row").filter({ hasText: title })).toBeVisible();
    expect(eventRequests, "显式重试必须在查询层的一次自动重试之后重新请求活动读模型").toBe(3);
  } finally {
    await context.close();
  }
});
