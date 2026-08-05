import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 按标题取输入框。
 * Mantine 的必填星号渲染成 <span aria-hidden> *</span>（InputLabel.mjs），
 * 无障碍名里没有它，但 getByLabel 比对的是标签的文本内容，星号会被算进去——
 * 于是 exact: "Member" 在必填字段上永远匹配不到，报的却是「元素不存在」。
 * 这里把星号并进匹配规则，让一个字段是否必填不再改变用例的取元素方式。
 */
export function field(scope: Locator | Page, label: string): Locator {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /*
   * 只认真正的表单控件。
   * Mantine 的 Select 如果是用 aria-label 而不是可见 label 标注的，会把同一个
   * aria-label 同时挂在 input 和下拉的 role="listbox" 上；Combobox 的下拉默认
   * keepMounted，即使收起来也在 DOM 里，于是 getByLabel 一次命中两个元素，
   * 报的是 strict mode violation，看上去像选择器写错了，其实是控件自带的重名。
   */
  return scope
    .getByLabel(new RegExp(`^${escaped}\\s*\\*?$`))
    .and(scope.locator("input, textarea, select, [contenteditable='true']"));
}

/**
 * 选中一个 Mantine Select 的选项。
 * Mantine 的下拉是 portal 到 body 的独立节点，直接在字段作用域里找选项是找不到的。
 */
export async function selectOption(scope: Locator | Page, label: string, optionText: string): Promise<void> {
  const input = field(scope, label);
  await input.click();
  const page = "page" in input ? input.page() : (scope as Page);
  await page.getByRole("option", { name: optionText, exact: true }).click();
  await expect(input).toHaveValue(optionText);
}

/**
 * 窄工具栏会把次要筛选收进 Popover / Drawer。宽屏时按钮根本不渲染，窄屏时则先按
 * 无障碍名找到它并确认已经展开；计数徽章会把名字变成 `Filter & sort (2)`，所以名称
 * 只允许多出末尾的数字计数，不靠布局类名猜当前是哪一种呈现。
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

  // FocusTrap 会自动聚焦第一个可搜索下拉，并把它展开到筛选面板之上。
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

/** 按 radio 语义和可访问名称取得 SegmentedControl 的选项，不依赖 Mantine 内部类名。 */
export function segmentedControlOption(scope: Locator | Page, label: string): Locator {
  return scope.getByRole("radio", { name: label, exact: true });
}

/** 选择并确认一个 SegmentedControl 选项。 */
export async function selectSegmentedControlOption(
  scope: Locator | Page,
  label: string,
): Promise<void> {
  const option = segmentedControlOption(scope, label);
  await option.focus();
  await option.press("Space");
  await expect(option).toBeChecked();
}

/**
 * 按标题取开关或复选框。
 * Mantine 的 Switch 把 input、标题和描述一起包在同一个 <label>（Switch-body）里，
 * 所以带 description 的开关，label 的 textContent 是「标题+描述」拼起来的一整串。
 * getByLabel 比的正是 textContent，exact 匹配于是永远命中不了，
 * 报的却是「元素不存在」——看上去像标题写错了，其实是控件把描述算进了名字。
 * 这里按标题前缀匹配再与真正的 input 求交；万一前缀撞名，strict mode 会直接报出来。
 */
export function toggleInput(scope: Locator | Page, label: string): Locator {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scope
    .getByLabel(new RegExp(`^${escaped}`))
    .and(scope.locator("input[type='checkbox'], input[type='radio']"));
}

/**
 * 点掉一个 Mantine 输入控件右侧的清除按钮。
 * 这个按钮渲染成 <button tabindex="-1" aria-hidden="true" class="mantine-InputClearButton-root">，
 * 因为 aria-hidden，getByRole("button") 按无障碍规则会直接跳过它——
 * 用角色去取永远超时，报的却是「元素不存在」，看着像选择器写错。
 * 它是纯鼠标可达的装饰性控件，只能按类名取，并且必须限定在目标字段的 wrapper 里，
 * 否则一页上多个可清除字段会撞成 strict mode violation。
 */
export function clearButton(scope: Locator | Page, label: string): Locator {
  return scope
    .locator(".mantine-Input-wrapper")
    .filter({ has: field(scope, label) })
    .locator("button.mantine-InputClearButton-root");
}

/** 读一个整数文本节点，读不出数字就直接失败——静默当成 0 会把断言变成摆设。 */
export async function readInteger(locator: Locator, label: string): Promise<number> {
  const raw = (await locator.innerText()).trim();
  const value = Number.parseInt(raw, 10);
  expect(Number.isInteger(value), `${label} 期望是整数，实际读到 ${JSON.stringify(raw)}`).toBe(true);
  return value;
}

/** 当前打开的 Mantine Modal / Drawer。只在页面上确定只有一个弹窗时用。 */
export function topDialog(page: Page): Locator {
  return page.getByRole("dialog").last();
}

/**
 * 按标题定位弹窗。
 * 抽屉上再叠一个确认框时，DOM 顺序并不等于叠放顺序——Mantine 的 confirm modal
 * 可能挂在抽屉节点之前，此时 .last() 拿到的是底下那层，点击就点到了错误的按钮上。
 * 凡是有多层弹窗的场景，一律按标题取。
 */
export function dialogTitled(page: Page, title: string): Locator {
  return page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

/**
 * 等所有弹窗彻底退场。
 * Mantine 卸载 role="dialog" 的时机比卸载遮罩早：只等 dialog 归零就往下点，
 * 会撞上还在做退场动画的 .mantine-Overlay-root，点击被它吞掉，
 * 表现成「按钮没反应」的偶发失败。两个都要等。
 */
export async function expectNoDialog(page: Page): Promise<void> {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".mantine-Overlay-root")).toHaveCount(0);
}

/** 确认框：先确认它真的弹出来了，再返回给调用方点按钮。 */
export async function confirmDialog(page: Page, title: string): Promise<Locator> {
  const dialog = dialogTitled(page, title);
  await expect(dialog, `没有弹出确认框「${title}」`).toBeVisible();
  return dialog;
}
