import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../support/test";

/*
 * 设置页：主题、主色、语言。
 *
 * 三组都是纯客户端偏好——写 localStorage、改 <html> 上的 data-* 属性，
 * 一个请求都不该发（SettingsPage.tsx → preferences store → ThemeProvider）。
 * 所以每条用例的验收是三件事一起看：属性变了、localStorage 落盘了、
 * 刷新之后还在。少了最后一步，「切了但没存住」根本测不出来。
 *
 * 不需要收尾还原：每条用例都是全新的浏览器上下文，localStorage 从空开始，
 * 而 storageState 是从纯 API 通道存的，本身不含任何 origin 数据。
 */

/** 偏好卡片由 RadioGroupItem 承担选择语义，无障碍名含标题和说明。 */
function optionRadio(page: Page, label: string): Locator {
  return page.getByRole("radio", { name: new RegExp(`^${label}`) });
}

async function readStorage(page: Page, key: string): Promise<string | null> {
  return page.evaluate((name) => localStorage.getItem(name), key);
}

async function readRootAttribute(page: Page, name: string): Promise<string | null> {
  return page.evaluate((attribute) => document.documentElement.getAttribute(attribute), name);
}

/**
 * 刷新之后不能直接读 data-*：这些属性是 ThemeProvider 挂载后由 effect 写上去的，
 * load 事件回来时根节点上还什么都没有，直接读到的是 null——看着像偏好没存住，
 * 其实只是读早了。等属性自己出现，才是在验「刷新后仍然生效」。
 */
async function expectRootAttribute(page: Page, name: string, value: string, message: string): Promise<void> {
  await expect.poll(() => readRootAttribute(page, name), { message }).toBe(value);
}

/**
 * 等这一屏的后台请求跑完。
 * 刷新之后外壳还在预取公告和名单，紧接着断言「这个控件不碰网络」会把那些
 * 在途响应算到点击头上，报成偶发的假失败。
 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText("Appearance", { exact: true })).toBeVisible();
  await settle(page);
});

test("主题：切到深色后属性、落盘、刷新三处一致，切回浅色同样成立", async ({ page, flow }) => {
  expect(await readRootAttribute(page, "data-theme"), "默认是浅色").toBe("light");
  await expect(optionRadio(page, "Light")).toHaveAttribute("aria-checked", "true");

  await flow.clickWithoutApi(optionRadio(page, "Dark"));
  expect(await readRootAttribute(page, "data-theme")).toBe("dark");
  expect(await readStorage(page, "themeMode"), "偏好必须落盘，否则刷新就丢").toBe("dark");
  await expect(optionRadio(page, "Dark")).toHaveAttribute("aria-checked", "true");
  await expect(optionRadio(page, "Light")).toHaveAttribute("aria-checked", "false");

  await page.reload();
  await expectRootAttribute(page, "data-theme", "dark", "刷新后必须还是深色");

  await settle(page);
  await flow.clickWithoutApi(optionRadio(page, "Light"));
  expect(await readRootAttribute(page, "data-theme")).toBe("light");
  expect(await readStorage(page, "themeMode")).toBe("light");
});

test("主色：四块色卡各自生效并落盘，刷新后保持", async ({ page, flow }) => {
  expect(await readRootAttribute(page, "data-accent"), "默认主色是 teal").toBe("teal");

  /* 卡片标签和存进去的值并不一一对应：Amber 存的是 orange。按标签点、按值断言。 */
  for (const [label, value] of [["Indigo", "indigo"], ["Violet", "violet"], ["Amber", "orange"]] as const) {
    await flow.clickWithoutApi(optionRadio(page, label));
    expect(await readRootAttribute(page, "data-accent"), `${label} 应该写入 ${value}`).toBe(value);
    expect(await readStorage(page, "accent")).toBe(value);
    await expect(optionRadio(page, label)).toHaveAttribute("aria-checked", "true");
  }

  await page.reload();
  await expectRootAttribute(page, "data-accent", "orange", "刷新后必须还是最后选的那个");

  await settle(page);
  await flow.clickWithoutApi(optionRadio(page, "Teal"));
  expect(await readRootAttribute(page, "data-accent")).toBe("teal");
});

test("语言：切到中文后整页文案跟着换，落盘且刷新后保持", async ({ page, flow }) => {
  expect(await readStorage(page, "locale"), "进来时还没有人写过这个键").toBeNull();

  await flow.clickWithoutApi(optionRadio(page, "中文"));
  await expect(page.getByText("外观", { exact: true }), "分组标题必须换成中文").toBeVisible();
  await expect(page.getByText("主题", { exact: true })).toBeVisible();
  expect(await readStorage(page, "locale")).toBe("zh");
  expect(await readRootAttribute(page, "data-locale"), "根节点上的语言标记也要同步").toBe("zh");

  await page.reload();
  await expect(page.getByText("外观", { exact: true }), "刷新后必须还是中文").toBeVisible();

  await settle(page);
  await flow.clickWithoutApi(optionRadio(page, "English"));
  await expect(page.getByText("Appearance", { exact: true })).toBeVisible();
  expect(await readStorage(page, "locale")).toBe("en");
});
