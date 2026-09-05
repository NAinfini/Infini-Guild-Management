import {
  request,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { MUTATION_HEADERS } from "../../support/api";
import { PORTAL_ORIGIN } from "../../support/config";
import { createThrowawayMember, uniqueTag } from "../../support/members";
import {
  createFlow,
  expect,
  identityHeaders,
  test,
  watchPageDefects,
} from "../../support/test";

/*
 * 设置页：主题、主色、语言、动效，以及服务端通知偏好。
 *
 * 外观与语言都是纯客户端偏好——写 localStorage、改 <html> 上的 data-* 属性，
 * 不该请求 API（SettingsPage.tsx → preferences store → ThemeProvider）。
 * 所以每条用例的验收是三件事一起看：属性变了、localStorage 落盘了、
 * 刷新之后还在。少了最后一步，「切了但没存住」根本测不出来。
 *
 * 客户端偏好不需要收尾还原：每条用例都是全新的浏览器上下文，localStorage 从空开始，
 * 而 storageState 是从纯 API 通道存的，本身不含任何 origin 数据。通知偏好则用
 * 本轮登记的一次性账号验证；不触碰种子管理员，收尾由 user artifact 的外键级联清理。
 */

/** 偏好卡片由 RadioGroupItem 承担选择语义，无障碍名含标题和说明。 */
function optionRadio(page: Page, label: string): Locator {
  return page.getByRole("radio", { name: new RegExp(`^${label}`) });
}

type NotificationPreferences = {
  member_joined: boolean;
  announcement_published: boolean;
  event_created: boolean;
  wiki_article_created: boolean;
  updated_at: string | null;
};

type NotificationPreferenceSession = {
  api: APIRequestContext;
  page: Page;
  close: () => Promise<void>;
};

async function expectPostOk(
  response: Awaited<ReturnType<APIRequestContext["post"]>>,
  label: string,
): Promise<void> {
  expect(response.ok(), `${label} 返回 ${response.status()}: ${await response.text()}`).toBe(true);
}

async function createNotificationPreferenceSession({
  adminApi,
  browser,
  clientAddress,
  trackArtifacts,
}: {
  adminApi: APIRequestContext;
  browser: Browser;
  clientAddress: string;
  trackArtifacts: boolean;
}): Promise<NotificationPreferenceSession> {
  const account = await createThrowawayMember(adminApi, uniqueTag("notification_preferences"));
  const permanentLoginName = `${account.login_name}_ready`;
  const permanentPassword = "E2e-notification-preferences-password-1";
  const sessionHeaders = identityHeaders(clientAddress, trackArtifacts);
  const auth = await request.newContext({
    baseURL: PORTAL_ORIGIN,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { ...MUTATION_HEADERS, ...sessionHeaders },
  });

  try {
    await expectPostOk(await auth.post("/api/auth/login", {
      data: {
        login_name: account.login_name,
        password: account.password,
        stay_logged_in: true,
      },
    }), "临时通知偏好账号登录");
    await expectPostOk(await auth.post("/api/auth/complete-password-reset", {
      data: {
        login_name: permanentLoginName,
        new_password: permanentPassword,
        confirm_new_password: permanentPassword,
      },
    }), "临时通知偏好账号完成首次凭据设置");

    const context = await browser.newContext({
      baseURL: PORTAL_ORIGIN,
      storageState: await auth.storageState(),
      ignoreHTTPSErrors: true,
      locale: "en-US",
      timezoneId: "UTC",
      extraHTTPHeaders: sessionHeaders,
    });
    const page = await context.newPage();
    const assertClean = watchPageDefects(page);
    return {
      api: auth,
      page,
      close: async () => {
        try {
          assertClean();
        } finally {
          await context.close();
          await auth.dispose();
        }
      },
    };
  } catch (error) {
    await auth.dispose();
    throw error;
  }
}

async function readNotificationPreferences(api: APIRequestContext): Promise<NotificationPreferences> {
  const response = await api.get("/api/notifications/preferences");
  expect(response.ok(), `读取通知偏好返回 ${response.status()}: ${await response.text()}`).toBe(true);
  return await response.json() as NotificationPreferences;
}

async function readStorage(page: Page, key: string): Promise<string | null> {
  return page.evaluate((name) => localStorage.getItem(name), key);
}

async function readRootAttribute(page: Page, name: string): Promise<string | null> {
  return page.evaluate((attribute) => document.documentElement.getAttribute(attribute), name);
}

async function readOptionTransitionSeconds(page: Page): Promise<number[]> {
  return page.locator(".settings-option-card").first().evaluate((element) =>
    getComputedStyle(element).transitionDuration.split(",").map((duration) => {
      const value = duration.trim();
      return parseFloat(value) / (value.endsWith("ms") ? 1000 : 1);
    }),
  );
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
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto("/settings");
  await expect(page.getByText("Appearance", { exact: true })).toBeVisible();
  await settle(page);
});

test("主题：切到深色后属性、落盘、刷新三处一致，切回浅色同样成立", async ({ page, flow }) => {
  expect(await readRootAttribute(page, "data-theme"), "默认跟随当前浅色系统").toBe("light");
  await expect(optionRadio(page, "System")).toHaveAttribute("aria-checked", "true");
  await expect(optionRadio(page, "Light")).toHaveAttribute("aria-checked", "false");

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

test("系统主题：实时响应设备变化，显式选择优先，切回系统后继续跟随", async ({ page, flow }) => {
  expect(await readStorage(page, "themeMode")).toBeNull();
  await expect(optionRadio(page, "System")).toHaveAttribute("aria-checked", "true");

  await page.emulateMedia({ colorScheme: "dark" });
  await expectRootAttribute(page, "data-theme", "dark", "系统改为深色时应实时响应");
  await expect(optionRadio(page, "System")).toHaveAttribute("aria-checked", "true");

  await flow.clickWithoutApi(optionRadio(page, "Light"));
  await expectRootAttribute(page, "data-theme", "light", "手动浅色应覆盖系统深色");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expectRootAttribute(page, "data-theme", "light", "后续系统变化不能覆盖手动选择");
  expect(await readStorage(page, "themeMode")).toBe("light");

  await page.reload();
  await expectRootAttribute(page, "data-theme", "light", "刷新后仍应尊重手动浅色");
  await expect(optionRadio(page, "Light")).toHaveAttribute("aria-checked", "true");
  await settle(page);
  await flow.clickWithoutApi(optionRadio(page, "System"));
  expect(await readStorage(page, "themeMode")).toBe("system");
  await expectRootAttribute(page, "data-theme", "dark", "重新选择系统后应采用当前深色偏好");

  await page.emulateMedia({ colorScheme: "light" });
  await expectRootAttribute(page, "data-theme", "light", "切回系统后仍能实时变化");
  await page.reload();
  await expectRootAttribute(page, "data-theme", "light", "刷新保留跟随系统");
  await expect(optionRadio(page, "System")).toHaveAttribute("aria-checked", "true");
});

test("减少动效：手动偏好落盘，关闭后跟随系统，不能覆盖系统减少动效", async ({ page, flow }) => {
  const toggle = page.getByRole("switch", { name: "Reduce motion", exact: true });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(await readStorage(page, "motionPreference")).toBeNull();
  await expectRootAttribute(page, "data-motion", "full", "无手动或系统限制时保留完整动效");
  expect((await readOptionTransitionSeconds(page)).some((duration) => duration > 0.001)).toBe(true);

  await flow.clickWithoutApi(toggle);
  expect(await readStorage(page, "motionPreference")).toBe("reduce");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expectRootAttribute(page, "data-motion", "reduced", "手动减少动效应立即生效");
  expect((await readOptionTransitionSeconds(page)).every((duration) => duration <= 0.001)).toBe(true);

  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expectRootAttribute(page, "data-motion", "reduced", "刷新后仍减少动效");
  await settle(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await flow.clickWithoutApi(toggle);
  expect(await readStorage(page, "motionPreference")).toBe("system");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expectRootAttribute(page, "data-motion", "reduced", "关闭开关不能覆盖系统减少动效");
  expect((await readOptionTransitionSeconds(page)).every((duration) => duration <= 0.001)).toBe(true);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expectRootAttribute(page, "data-motion", "full", "跟随系统应响应恢复完整动效");
  expect((await readOptionTransitionSeconds(page)).some((duration) => duration > 0.001)).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectRootAttribute(page, "data-motion", "reduced", "跟随系统应实时响应减少动效");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expectRootAttribute(page, "data-motion", "reduced", "刷新后仍遵循系统减少动效");
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

test("通知偏好：切换后写入服务端，刷新仍保持", async ({
  api,
  browser,
  clientAddress,
  trackArtifacts,
}) => {
  const session = await createNotificationPreferenceSession({
    adminApi: api,
    browser,
    clientAddress,
    trackArtifacts,
  });

  try {
    await session.page.goto("/settings");
    await expect(session.page.getByText("Appearance", { exact: true })).toBeVisible();
    await settle(session.page);

    const original = await readNotificationPreferences(session.api);
    const toggle = session.page.getByRole("switch", { name: /^New members/ });
    const nextValue = !original.member_joined;
    const flow = createFlow(session.page);

    await expect(toggle).toHaveAttribute("aria-checked", String(original.member_joined));
    await flow.click(toggle, { method: "PATCH", path: /^\/api\/notifications\/preferences$/ });

    const saved = await readNotificationPreferences(session.api);
    expect(saved.member_joined).toBe(nextValue);

    await session.page.reload();
    await expect(session.page.getByRole("switch", { name: /^New members/ }))
      .toHaveAttribute("aria-checked", String(nextValue));
  } finally {
    await session.close();
  }
});
