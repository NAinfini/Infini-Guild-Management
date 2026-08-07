import { request, type APIRequestContext, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { MUTATION_HEADERS } from "../../support/api";
import { PORTAL_ORIGIN } from "../../support/config";
import { readAssignableRole } from "../../support/members";
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
 * 个人资料页「账号」屏：改密码卡、改用户名卡、登出条。
 *
 * 这一屏和别处不同，三个控件都会把当前会话作废：
 *   - 改密码成功：服务端删掉该用户全部会话并清 cookie（UserService.ts:737），
 *     前端跳 /login?reason=expired；
 *   - 改用户名成功：前端清会话后跳 /login；
 *   - 登出：POST /api/auth/logout 后跳 /login。
 * 所以整屏不能用共享的 admin 会话跑——跑完这条用例，后面所有用例的登录态就没了。
 * 每条用例改成：管理员建一个一次性账号（POST /api/admin/users，已登记进清理注册表，
 * 收尾时连同它的审计行一起硬删）→ 用它单开一个浏览器上下文 → 在那里点控件。
 *
 * 这也是 systemTestTrackingMiddleware 放行「本次运行创建的账号」的原因：
 * 改密码 / 改用户名只允许操作自己，用管理员的会话根本走不到，而这两个接口
 * 都会写审计行；不认这类会话，审计行就挂在没登记的用户身上，清理阶段直接抛错。
 */

const CHANGE_PASSWORD = { method: "POST", path: /^\/api\/users\/[^/]+\/change-password$/ } as const;
const CHANGE_USERNAME = { method: "POST", path: /^\/api\/users\/[^/]+\/change-username$/ } as const;
const LOGOUT = { method: "POST", path: /^\/api\/auth\/logout$/ } as const;

type Throwaway = { id: string; username: string; password: string };

let account: Throwaway;
let context: BrowserContext;
let page: Page;
let flow: Flow;
let assertPageClean: () => void;

/* 一次性账号的用户名。不能以 systemtest 开头（那是保留前缀，见 AdminService.createMember）。 */
let accountCounter = 0;
function throwawayUsername(): string {
  accountCounter += 1;
  return `e2e_acct_${Date.now().toString(36)}_${accountCounter}`;
}

/*
 * 每条用例自己开的旁路通道都必须挂运行头。
 * 登录是中间件放行的匿名路径，挂上没问题；而且必须挂——登录成功和失败都会写
 * user_auth 审计行（AuthService 的 login / login_failed），不挂运行头这些行就没登记，
 * 收尾时 deleteRegisteredUsers 撞见它们会直接抛错，报成「清理失败」。
 */
let sideChannelHeaders: Record<string, string>;

/** 单开一条登录通道换 storageState；不复用用例的 api（那是管理员的会话）。 */
async function signIn(username: string, password: string): Promise<APIRequestContext> {
  const session = await request.newContext({
    baseURL: PORTAL_ORIGIN,
    extraHTTPHeaders: sideChannelHeaders,
  });
  const response = await session.post("/api/auth/login", {
    data: { username, password, stay_logged_in: true },
  });
  expect(response.status(), `${username} 登录返回 ${response.status()}: ${await response.text()}`).toBe(200);
  return session;
}

/** 只验一次登录能不能过，验完就把通道丢掉。 */
async function loginStatus(username: string, password: string): Promise<number> {
  const probe = await request.newContext({
    baseURL: PORTAL_ORIGIN,
    extraHTTPHeaders: sideChannelHeaders,
  });
  const response = await probe.post("/api/auth/login", { data: { username, password } });
  const status = response.status();
  await probe.dispose();
  return status;
}

test.beforeEach(async ({ api, browser, clientAddress, trackArtifacts }) => {
  sideChannelHeaders = { ...MUTATION_HEADERS, ...identityHeaders(clientAddress, trackArtifacts) };
  const username = throwawayUsername();
  const role = await readAssignableRole(api);
  const created = await readJson(
    await api.post("/api/admin/users", { data: { username, role_id: role.id } }),
    "创建一次性账号",
  ) as { user_id: string; username: string; temporary_password: string };
  account = { id: created.user_id, username: created.username, password: created.temporary_password };

  const session = await signIn(account.username, account.password);
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
  await expect(passwordCard().getByRole("heading", { name: "Change password", exact: true })).toBeVisible();
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
function passwordCard(): Locator { return cardTitled("Change password"); }
function usernameCard(): Locator { return cardTitled("Change username"); }
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

test("改密码卡：当前密码填错时服务端 401，会话被当成过期直接踢出，密码没变", async () => {
  const card = passwordCard();
  await field(card, "Current password").fill("definitely-not-the-password");
  await field(card, "New password").fill("e2e-new-password-1");
  await field(card, "Confirm new password").fill("e2e-new-password-1");

  await flow.click(submitButton(card, "Change password"), { ...CHANGE_PASSWORD, status: 401 });

  /*
   * 现状如实记录，这是一处缺陷：
   * 服务端回的是「Current password is incorrect」，但 401 会先被全局处理器
   * （client.ts:109 派发 guild-api-unauthorized）当成会话过期，用户看到的是
   * 「会话已过期」并被直接踢回登录页——填错一次密码就得重新登录，
   * 而且提示词把真正的原因盖掉了。
   */
  await expect(page).toHaveURL(/\/login\?.*reason=expired/);

  expect(
    await loginStatus(account.username, account.password),
    "改密码失败后原密码必须照常可用",
  ).toBe(200);
});

test("改密码卡：填对当前密码后旧密码立即失效、新密码可登录", async () => {
  const newPassword = "e2e-new-password-1";
  const card = passwordCard();
  await field(card, "Current password").fill(account.password);
  await field(card, "New password").fill(newPassword);
  await field(card, "Confirm new password").fill(newPassword);

  await flow.click(submitButton(card, "Change password"), CHANGE_PASSWORD);
  await expect(page).toHaveURL(/\/login\?.*reason=expired/);

  expect(
    await loginStatus(account.username, newPassword),
    "新密码必须能登录",
  ).toBe(200);
  expect(
    await loginStatus(account.username, account.password),
    "旧密码必须立即失效",
  ).toBe(401);
});

test("改用户名卡：非法用户名当场报错且按钮禁用，合法改名后新名字可登录", async ({ api }) => {
  const card = usernameCard();
  const submit = submitButton(card, "Change username");
  await expect(submit, "什么都没填时不该能提交").toBeDisabled();

  await expectNoApiCalls(async () => {
    await field(card, "Current password").fill(account.password);
    await field(card, "New username").fill("bad name!");
    await expect(
      card.getByText("Username may only contain letters, numbers, and underscores."),
      "非法字符必须当场提示",
    ).toBeVisible();
    await expect(submit, "有校验错误时不该能提交").toBeDisabled();
  });

  const renamed = `${account.username}_r`;
  await field(card, "New username").fill(renamed);
  await expect(submit).toBeEnabled();
  await flow.click(submit, CHANGE_USERNAME);
  await expect(page).toHaveURL(/\/login(\?|$)/);

  const detail = await readJson(await api.get(`/api/users/${account.id}`), "回读账号") as {
    user: { username: string };
  };
  expect(detail.user.username, "服务端的用户名必须真的改了").toBe(renamed);
  expect(
    await loginStatus(renamed, account.password),
    "改名后用新名字必须能登录",
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
