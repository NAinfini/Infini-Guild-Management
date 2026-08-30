import { expect, test } from "../../support/test";

test("筛选面板关闭后把键盘焦点还给触发器", async ({ page }) => {
  await page.goto("/events");

  const toolbar = page.locator(".content-filter-toolbar:visible").first();
  const toggle = toolbar.locator(".content-filter-toolbar__toggle");
  await expect(toggle).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(
    ".content-filter-toolbar__popover:visible, .content-filter-toolbar__drawer-content:visible",
  ).first()).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
});
