import { expect, test } from "../../support/test";

/*
 * 游客可以直接浏览的路由。这里只钉「进得去、渲染出内容、没有未捕获异常」，
 * 每个页面上的具体控件由各自的 spec 逐个验证。
 */
const PUBLIC_ROUTES = [
  "/",
  "/events",
  "/roster",
  "/announcements",
  "/guild-war",
  "/gallery",
  "/wiki",
  "/settings",
  "/tools",
  "/login",
] as const;

test("慢速路由切换保留当前内容，并显示顶部进度", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.locator(".settings-page")).toBeVisible();
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  const pattern = /\/assets\/EventsPage-[^/]+\.js$/;
  await page.route(pattern, async (route) => { requested = true; await ready; await route.continue(); });
  try {
    await page.locator(".app-nav-groups").getByRole("button", { name: "Events", exact: true }).click();
    await expect.poll(() => requested).toBe(true);
    await expect(page.locator(".settings-page")).toBeVisible();
    await expect(page.locator('.route-progress[data-active="true"]')).toBeVisible();
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.locator(".events-page")).toBeVisible();
  await expect(page.locator('.route-progress[data-active="true"]')).toHaveCount(0);
  await page.unroute(pattern);
});

for (const route of PUBLIC_ROUTES) {
  test(`游客可以打开 ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("#root")).not.toBeEmpty();
    await expect(page.locator('.route-progress[data-active="true"]')).toHaveCount(0);
  });
}

test("受保护路由会把游客送去登录页并带上回跳地址", async ({ page }) => {
  await page.goto("/storage");
  await page.waitForURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/storage");
});

test("公开首页的跳转链接把键盘焦点移到主内容", async ({ page }) => {
  await page.goto("/");
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/splash-done/);

  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.locator("#landing-main")).toBeFocused();
});
