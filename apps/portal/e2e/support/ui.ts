import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 按字段标签取得可交互表单控件。
 * 必填标记属于标签文案的一部分，但不应改变用例的定位方式；所以允许标签末尾带星号。
 * Base UI 的 Select 触发器是带 listbox 语义的按钮，也纳入同一入口。
 */
export function field(scope: Locator | Page, label: string): Locator {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scope
    .getByLabel(new RegExp(`^${escaped}\\s*\\*?$`))
    .and(scope.locator("input, textarea, select, [contenteditable='true'], [role='combobox'], button[aria-haspopup='listbox']"));
}

/**
 * 选中一个原生或 Base UI Select 的选项。
 * Base UI 的选项浮层会移植到页面根部，因此选项从页面作用域定位，而非字段局部。
 */
export async function selectOption(scope: Locator | Page, label: string, optionText: string): Promise<void> {
  const control = field(scope, label);
  const isNativeSelect = await control.evaluate((node) => node instanceof HTMLSelectElement);
  if (isNativeSelect) {
    await control.selectOption({ label: optionText });
    await expect(control.locator("option:checked")).toHaveText(optionText);
    return;
  }

  await control.click();
  const page = control.page();
  await page.getByRole("option", { name: optionText, exact: true }).click();
  await expect(control).toContainText(optionText);
}

/**
 * 共享工具栏始终把次要筛选收进 Popover / Drawer。按无障碍名找到入口并确认已经展开；
 * 计数徽章会把名字变成 `Filter & sort (2)`，所以名称只允许多出末尾的数字计数。
 */
export async function ensureFiltersOpen(scope: Locator | Page): Promise<void> {
  const toggle = scope
    .getByRole("button", { name: /^Filter & sort(?: \(\d+\))?$/ })
    .first();
  if (!(await toggle.isVisible())) return;

  const dismissAutofocusedCombobox = async (): Promise<void> => {
    const expandedCombobox = toggle.page().getByRole("combobox", { expanded: true }).first();
    if (await expandedCombobox.isVisible()) {
      await expandedCombobox.press("Escape");
    }
  };

  const focusFirstVisibleDialogButton = async (): Promise<void> => {
    const dialog = toggle.page()
      .getByRole("dialog", { name: /^Filter & sort(?: \(\d+\))?$/ })
      .first();
    const buttons = dialog.getByRole("button");
    for (let index = 0; index < await buttons.count(); index += 1) {
      const button = buttons.nth(index);
      if (await button.isVisible()) {
        await button.focus();
        return;
      }
    }
  };

  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  // 弹层打开时可能自动聚焦第一个可搜索选择器，并把内层 listbox 展开到筛选面板之上。
  // 先收起内层 listbox；若 Escape 连外层一起收掉，只重开一次并转移到面板内的按钮。
  await dismissAutofocusedCombobox();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await focusFirstVisibleDialogButton();
  } else {
    await focusFirstVisibleDialogButton();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/**
 * 选中响应式筛选栏里的 Select 选项。
 * 紧凑布局的选项 portal 在面板外，点击后可能让 Popover 关闭并卸载输入框；
 * 必须按筛选栏作用域重开面板，再重新定位输入框确认值，不能把元素消失当成选中成功。
 */
export async function selectFilterOption(
  page: Page,
  toolbarScope: Locator | Page,
  label: string,
  optionText: string,
): Promise<void> {
  await ensureFiltersOpen(toolbarScope);
  const radio = page.getByRole("radio", { name: optionText, exact: true });
  if (await radio.count()) {
    await radio.click();
    await expect(radio).toBeChecked();
    return;
  }

  await selectOption(page, label, optionText);
  await ensureFiltersOpen(toolbarScope);
}

/** 按 radio 语义和可访问名称取得分组单选项。 */
export function radioOption(scope: Locator | Page, label: string): Locator {
  return scope.getByRole("radio", { name: label, exact: true });
}

/** 选择并确认一个单选项。 */
export async function selectRadioOption(
  scope: Locator | Page,
  label: string,
): Promise<void> {
  const option = radioOption(scope, label);
  await option.focus();
  await option.press("Space");
  await expect(option).toBeChecked();
}

/**
 * 按可访问名称取得 Base UI 开关。
 * 有些开关的可见标签还带说明文字，所以按标题前缀匹配；同页重名会由 strict mode 直接暴露。
 */
export function toggle(scope: Locator | Page, label: string): Locator {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scope.getByRole("switch", { name: new RegExp(`^${escaped}`) });
}

/**
 * 将一个开关设到明确状态，避免依赖实现细节或重复点击带来的反转。
 */
export async function setToggle(scope: Locator | Page, label: string, checked: boolean): Promise<void> {
  const control = toggle(scope, label);
  const current = await control.getAttribute("aria-checked");
  if ((current === "true") !== checked) {
    await control.click();
  }
  await expect(control).toHaveAttribute("aria-checked", String(checked));
}

/** 读一个整数文本节点，读不出数字就直接失败——静默当成 0 会把断言变成摆设。 */
export async function readInteger(locator: Locator, label: string): Promise<number> {
  const raw = (await locator.innerText()).trim();
  const value = Number.parseInt(raw, 10);
  expect(Number.isInteger(value), `${label} 期望是整数，实际读到 ${JSON.stringify(raw)}`).toBe(true);
  return value;
}

/** 当前最上层的对话框或抽屉。只在页面上确定只有一个弹层时用。 */
export function topDialog(page: Page): Locator {
  return page.getByRole("dialog").last();
}

/**
 * 按标题定位弹窗。
 * 抽屉上再叠一个确认框时，DOM 顺序并不等于叠放顺序，.last() 可能拿到底下那层。
 * 凡是有多层弹窗的场景，一律按标题取。
 */
export function dialogTitled(page: Page, title: string): Locator {
  return page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

/**
 * 等所有弹窗彻底退场。
 * Base UI 的对话框和遮罩会分别做退场动画；两个都消失后才能继续点击页面。
 */
export async function expectNoDialog(page: Page): Promise<void> {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[data-slot$='overlay']")).toHaveCount(0);
}

/** 确认框：先确认它真的弹出来了，再返回给调用方点按钮。 */
export async function confirmDialog(page: Page, title: string): Promise<Locator> {
  const dialog = dialogTitled(page, title);
  await expect(dialog, `没有弹出确认框「${title}」`).toBeVisible();
  return dialog;
}
