import { expect, test } from "../../support/test";

/*
 * 页头通知浮层的键盘可达性。
 *
 * 为什么单独立一条 e2e：升到 Mantine 9 之后，同一段流程在 jsdom 里是坏的。
 * 但在真浏览器里量过，焦点是正常进浮层的——Mantine 的 useFocusTrap 在浮层内没有
 * 可聚焦子元素时（通知为空只有一句占位文案），会退回聚焦浮层自身，靠的是
 * Popover.Dropdown 上那个 tabIndex=-1。所以坏的是 jsdom 的时序，不是线上。
 *
 * 这条用例就是那个判定，别把它降级成单测——单测环境正是不可信的那一环。
 */

test("通知浮层能用键盘打开，Escape 关掉并把焦点还回按钮", async ({ page }) => {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  // 未读与否会换 aria-label，两种都接受。
  const trigger = page.getByRole("button", { name: /^Notifications( \(unread\))?$/ });
  await expect(trigger).toBeVisible();

  await trigger.focus();
  await page.keyboard.press("Enter");

  const dropdown = page.getByRole("dialog");
  await expect(dropdown, "回车必须打开浮层").toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  /*
   * 焦点落在浮层自身还是落在浮层里的某个控件，取决于当时有没有通知条目，两种都算
   * 数——要守的是「焦点离开了触发器、进到浮层这棵树里」。写成 locator(":focus")
   * 只能匹配后代，空通知时焦点正好在浮层自己身上，会误判成回归。
   */
  await expect
    .poll(
      () => dropdown.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)),
      { message: "trapFocus 必须把焦点移进浮层，否则 Escape 收不到、键盘用户出不来" },
    )
    .toBe(true);

  await page.keyboard.press("Escape");
  await expect(dropdown, "Escape 必须关掉浮层").toBeHidden();
  await expect(trigger).not.toHaveAttribute("aria-expanded", "true");
  await expect(trigger, "returnFocus 必须把焦点还回触发按钮").toBeFocused();
});
