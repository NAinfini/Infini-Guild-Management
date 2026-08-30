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

for (const route of PUBLIC_ROUTES) {
  test(`游客可以打开 ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("#root")).not.toBeEmpty();
    // 路由级 loading 占位必须让位给真实内容，否则等于页面卡在加载态。
    await expect(page.locator(".route-loading")).toHaveCount(0);
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
