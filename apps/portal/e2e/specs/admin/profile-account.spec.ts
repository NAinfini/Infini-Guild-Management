import { request, type APIRequestContext, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { MUTATION_HEADERS } from "../../support/api";
import { PORTAL_ORIGIN } from "../../support/config";
import { createThrowawayMember, uniqueTag, type ThrowawayMember } from "../../support/members";
import {
  createFlow,
  expect,
  identityHeaders,
  readJson,
  test,
  watchPageDefects,
  type Flow,
} from "../../support/test";
import { field } from "../../support/ui";

/*
 * 个人资料页「账号」屏：改密码、登录用户名和登出；公开显示名归「个人资料」屏保存。
 *
 * 这一屏和别处不同，三个控件都会把当前会话作废：
 *   - 改密码成功：服务端删掉该用户全部会话并清 cookie（UserService.ts:737），
 *     前端跳 /login?reason=expired；
 *   - 改登录名成功：前端清会话后跳 /login；
 *   - 改公开显示名成功：经 PATCH /api/users/:id/profile 保存，当前会话保持有效；
 *   - 登出：POST /api/auth/logout 后跳 /login。
 * 所以整屏不能用共享的 admin 会话跑——跑完这条用例，后面所有用例的登录态就没了。
 * 每条用例改成：管理员建一个一次性账号（POST /api/admin/users，已登记进清理注册表，
 * 收尾时连同它的审计行一起硬删）→ 用它单开一个浏览器上下文 → 在那里点控件。
 *
 * 这也是 systemTestTrackingMiddleware 放行「本次运行创建的账号」的原因：
 * 改密码 / 改登录名 / 改公开显示名只允许操作自己，用管理员的会话根本走不到，而这些接口
 * 都会写审计行；不认这类会话，审计行就挂在没登记的用户身上，清理阶段直接抛错。
 */

const CHANGE_PASSWORD = { method: "PATCH", path: /^\/api\/auth\/security\/password$/ } as const;
const CHANGE_LOGIN_NAME = { method: "PATCH", path: /^\/api\/auth\/security\/login-name$/ } as const;
const UPDATE_PROFILE = { method: "PATCH", path: /^\/api\/users\/[^/]+\/profile$/ } as const;
const LOGOUT = { method: "POST", path: /^\/api\/auth\/logout$/ } as const;

let account: ThrowawayMember;
let context: BrowserContext;
let page: Page;
let flow: Flow;
let assertPageClean: () => void;

/*
 * 每条用例自己开的旁路通道都必须挂运行头。
 * 登录是中间件放行的匿名路径，挂上没问题；而且必须挂——登录成功和失败都会写
 * user_auth 审计行（AuthService 的 login / login_failed），不挂运行头这些行就没登记，
 * 收尾时 deleteRegisteredUsers 撞见它们会直接抛错，报成「清理失败」。
 */
let sideChannelHeaders: Record<string, string>;

/** 单开一条登录通道换 storageState；不复用用例的 api（那是管理员的会话）。 */
async function signIn(loginName: string, password: string): Promise<APIRequestContext> {
  const session = await request.newContext({
    baseURL: PORTAL_ORIGIN,
    extraHTTPHeaders: sideChannelHeaders,
  });
  const response = await session.post("/api/auth/login", {
    data: { login_name: loginName, password, stay_logged_in: true },
  });
  expect(response.status(), `${loginName} 登录返回 ${response.status()}: ${await response.text()}`).toBe(200);
  return session;
}

/** 只验一次登录能不能过，验完就把通道丢掉。 */
async function loginStatus(loginName: string, password: string): Promise<number> {
  const probe = await request.newContext({
    baseURL: PORTAL_ORIGIN,
    extraHTTPHeaders: sideChannelHeaders,
  });
  const response = await probe.post("/api/auth/login", { data: { login_name: loginName, password } });
  const status = response.status();
  await probe.dispose();
  return status;
}

test.beforeEach(async ({ api, browser, clientAddress, trackArtifacts }) => {
  sideChannelHeaders = { ...MUTATION_HEADERS, ...identityHeaders(clientAddress, trackArtifacts) };
  const created = await createThrowawayMember(api, uniqueTag("acct"));
  const permanentLoginName = `${created.login_name}_p`;
  const permanentPassword = "e2e-profile-password-1";
  const session = await signIn(created.login_name, created.password);
  const completion = await session.post("/api/auth/complete-password-reset", {
    data: {
      login_name: permanentLoginName,
      new_password: permanentPassword,
      confirm_new_password: permanentPassword,
    },
  });
  expect(completion.status(), `完成一次性凭据设置返回 ${completion.status()}: ${await completion.text()}`).toBe(200);
  account = { ...created, login_name: permanentLoginName, password: permanentPassword };
  const storageState = await session.storageState();
  await session.dispose();

  context = await browser.newContext({
    storageState,
    // fixture 只管默认上下文，这条自己开的必须把两类头装齐，否则审计行登记不上。
    extraHTTPHeaders: identityHeaders(clientAddress, trackArtifacts),
  });
  page = await context.newPage();
  assertPageClean = watchPageDefects(page);
  flow = createFlow(page);

  await page.goto("/profile?tab=account");
  await expect(page.getByRole("heading", { name: "Security confirmation", exact: true })).toBeVisible();
  await expect(passwordSecurityCard().getByRole("heading", { name: "Password and security", exact: true })).toBeVisible();
});

test.afterEach(async () => {
  await context.close();
  // 账号本身由运行收尾时按 id 硬删（连带 member_profiles、审计行、登录失败记录）。
  assertPageClean();
});

function cardTitled(title: string): Locator {
  return page.locator(".profile-account__card").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}
function loginCard(): Locator { return cardTitled("Login username"); }
function passwordSecurityCard(): Locator { return cardTitled("Password and security"); }
function currentPasswordField(): Locator { return field(page, "Current password"); }
function submitButton(card: Locator, name: string): Locator {
  return card.getByRole("button", { name, exact: true });
}

/** 在一段操作里盯着 /api/，用来证明纯客户端校验真的没碰网络。 */
async function expectNoApiCalls(action: () => Promise<void>): Promise<void> {
  const calls: string[] = [];
  const record = (response: { url: () => string; request: () => { method: () => string } }): void => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith("/api/")) calls.push(`${response.request().method()} ${path}`);
  };
  page.on("response", record);
  try {
    await action();
    await page.waitForTimeout(300);
  } finally {
    page.off("response", record);
  }
  expect(calls, "客户端校验阶段本不该发请求").toEqual([]);
}

test("改密码卡：当前密码填错时保留会话并显示表单错误，密码没变", async () => {
  const card = passwordSecurityCard();
  await currentPasswordField().fill("definitely-not-the-password");
  await field(card, "New password").fill("e2e-new-password-1");
  await field(card, "Confirm new password").fill("e2e-new-password-1");

  await flow.click(submitButton(card, "Change password"), { ...CHANGE_PASSWORD, status: 401 });

  await expect(page).toHaveURL(/\/profile\?tab=account/);
  await expect(page.locator('[data-slot="toast-description"]').filter({
    hasText: "Current password is incorrect",
  })).toBeVisible();

  expect(
    await loginStatus(account.login_name, account.password),
    "改密码失败后原密码必须照常可用",
  ).toBe(200);
});

test("改密码卡：填对当前密码后旧密码立即失效、新密码可登录", async () => {
  const newPassword = "e2e-new-password-1";
  const card = passwordSecurityCard();
  await currentPasswordField().fill(account.password);
  await field(card, "New password").fill(newPassword);
  await field(card, "Confirm new password").fill(newPassword);

  await flow.click(submitButton(card, "Change password"), CHANGE_PASSWORD);
  await expect(page).toHaveURL(/\/login\?.*reason=expired/);

  expect(
    await loginStatus(account.login_name, newPassword),
    "新密码必须能登录",
  ).toBe(200);
  expect(
    await loginStatus(account.login_name, account.password),
    "旧密码必须立即失效",
  ).toBe(401);
});

test("改登录名：非法值不发请求，合法改名后仅新登录名可用", async ({ api }) => {
  const card = loginCard();
  const submit = submitButton(card, "Save login name");
  await expect(submit, "什么都没填时不该能提交").toBeDisabled();

  await expectNoApiCalls(async () => {
    await currentPasswordField().fill(account.password);
    await field(card, "Login username").fill("bad name!");
    await expect(submit, "有校验错误时不该能提交").toBeDisabled();
  });

  const renamed = `${account.login_name}_r`;
  await field(card, "Login username").fill(renamed);
  await expect(submit).toBeEnabled();
  await flow.click(submit, CHANGE_LOGIN_NAME);
  await expect(page).toHaveURL(/\/login(\?|$)/);

  const detail = await readJson(await api.get(`/api/users/${account.id}`), "回读账号") as {
    user: { display_name: string };
  };
  expect(detail.user.display_name, "修改登录用户名不得改变公开显示名").toBe(account.display_name);
  const renamedSession = await signIn(renamed, account.password);
  try {
    const oldLoginStatus = await loginStatus(account.login_name, account.password);

    // 把测试账号改回原登录名，事务会精确清掉上一步为旧登录名留下的失败计数。
    const restored = await renamedSession.patch("/api/auth/security/login-name", {
      data: { currentPassword: account.password, login_name: account.login_name },
    });
    expect(
      restored.status(),
      `恢复测试账号登录名返回 ${restored.status()}: ${await restored.text()}`,
    ).toBe(200);

    const restoredLoginStatus = await loginStatus(account.login_name, account.password);
    expect(oldLoginStatus, "旧登录用户名必须立即失效").toBe(401);
    expect(restoredLoginStatus, "恢复后的测试账号必须仍可登录").toBe(200);
  } finally {
    await renamedSession.dispose();
  }
});

test("改公开显示名：资料更新，但登录用户名与当前会话保持有效", async ({ api }) => {
  const renamed = `${account.display_name}_r`;
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(page).toHaveURL(/\/profile(?:\?|$)/);
  await field(page, "Public display name").fill(renamed);

  await flow.click(page.getByRole("button", { name: "Save Profile", exact: true }), UPDATE_PROFILE);
  await expect(page).toHaveURL(/\/profile(?:\?|$)/);

  const detail = await readJson(await api.get(`/api/users/${account.id}`), "回读账号") as {
    user: { display_name: string };
  };
  expect(detail.user.display_name, "公开显示名必须真正更新").toBe(renamed);
  expect(
    await loginStatus(account.login_name, account.password),
    "修改公开显示名不能改变登录凭据",
  ).toBe(200);
});

test("登出条：点一次跳回登录页，服务端的会话当场作废", async ({ clientAddress }) => {
  await flow.click(page.getByRole("button", { name: "Sign out", exact: true }), LOGOUT);
  await expect(page).toHaveURL(/\/login(\?|$)/);

  /*
   * 会话是否真的没了，只能拿这份 cookie 去问服务端——不能沿用浏览器上下文自己发请求：
   * 它挂着系统测试运行头，一旦没了会话用户，中间件按设计就直接 403
   * （只有登录/注册两条匿名路径例外），读到的 403 说明不了会话的死活。
   */
  const cookieOnly = await request.newContext({
    baseURL: PORTAL_ORIGIN,
    storageState: await context.storageState(),
    extraHTTPHeaders: { ...MUTATION_HEADERS, "X-Forwarded-For": clientAddress },
  });
  const me = await cookieOnly.get("/api/auth/me");
  const status = me.status();
  await cookieOnly.dispose();
  expect(status, "登出后这份 cookie 必须再也换不到会话").toBe(401);
});
