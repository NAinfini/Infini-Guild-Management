import { request, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { MUTATION_HEADERS } from "../../support/api";
import { ADMIN_PASSWORD, PORTAL_ORIGIN } from "../../support/config";
import { createThrowawayMember, uniqueTag } from "../../support/members";
import { expect, identityHeaders, test } from "../../support/test";
import { confirmDialog } from "../../support/ui";

/*
 * 行操作菜单里的两件凭据类操作：重置密码、清除登录锁。
 *
 * 这两个控件在界面上什么都不改——点完只有一句提示，唯一的产出物一个进了剪贴板、
 * 一个只存在于 login_failures 表里。所以验收必须走到「拿这个结果去登录」为止：
 * 只断言接口 200，等于把「服务端改了密码但没生效」这类问题全部放过。
 *
 * 关于登录次数：/api/auth/login 上叠了两层限流，按 IP 和按登录名各 5 次/分钟
 * （apps/shared/config/limits.ts:80）。锁定阶梯本身是「前 3 次免费、第 4 次失败开始锁」
 * （login-lockout.ts:26）。两者相加，同一个用户名在一分钟内最多只够 4 次失败 + 1 次验证，
 * 所以下面每个登录名的登录尝试都严格卡在 5 次以内，对照组也必须换一个客户端地址。
 */

const RESET_PASSWORD = { method: "POST", path: /^\/api\/admin\/users\/[^/]+\/reset-password$/ } as const;
const RESET_LOGIN_LOCK = { method: "POST", path: /^\/api\/admin\/users\/[^/]+\/reset-login-lock$/ } as const;

type LoginPayload = {
  error_code?: string;
  message?: string;
  details?: {
    retry_after_seconds?: number;
    locked_until?: string;
  };
};
type LoginResult = { status: number; message: string; payload: LoginPayload };

let trackArtifactsFlag: boolean;

/*
 * 登录探针专用的客户端地址，和 fixture 分配的 10.42.x.y、globalSetup 的 10.41.0.1 都错开。
 * 每条用例、每个账号各占一个地址，两个原因：
 *   - 同一条用例里的对照组必须换地址，否则 10 次登录会先撞上 IP 限流，
 *     429 就分不清是「账号被锁」还是「请求太密」；
 *   - 跨用例也不能复用，限流窗口是一整分钟，上一条用例花掉的配额会算到下一条头上。
 *
 * 号段按 workerIndex 切，理由和 support/test.ts 里的 clientAddress 完全一样：
 * 模块级计数器的生命周期是 worker 进程，Playwright 一有失败就换进程、计数器归零，
 * 于是刚被花光配额的地址会重新发给下一条用例，429 冒充成「账号被锁」。
 */
const PROBE_IDS_PER_WORKER = 2;
let probeCounter = 0;
let probeAddress: string;
let controlAddress: string;

/**
 * 单开一条通道试一次登录。
 * 必须挂运行头：登录成功和失败都会写 user_auth 审计行，没登记的审计行会让
 * 收尾阶段的 deleteRegisteredUsers 直接抛错，报成「清理失败」。
 */
async function attemptLogin(loginName: string, password: string, address: string): Promise<LoginResult> {
  const probe = await request.newContext({
    baseURL: PORTAL_ORIGIN,
    extraHTTPHeaders: { ...MUTATION_HEADERS, ...identityHeaders(address, trackArtifactsFlag) },
  });
  const response = await probe.post("/api/auth/login", { data: { login_name: loginName, password } });
  const status = response.status();
  const payload = await response.json() as LoginPayload;
  await probe.dispose();
  return { status, message: JSON.stringify(payload), payload };
}

async function signIn(loginName: string, password: string, address: string): Promise<APIRequestContext> {
  const session = await request.newContext({
    baseURL: PORTAL_ORIGIN,
    extraHTTPHeaders: { ...MUTATION_HEADERS, ...identityHeaders(address, trackArtifactsFlag) },
  });
  const response = await session.post("/api/auth/login", { data: { login_name: loginName, password } });
  expect(response.status(), `${loginName} 登录返回 ${response.status()}: ${await response.text()}`).toBe(200);
  return session;
}

/** 连续打错密码。第 4 次之后阶梯开始锁账号（前 3 次是免费的打字容错）。 */
async function failLogins(loginName: string, address: string, times: number): Promise<void> {
  for (let attempt = 1; attempt <= times; attempt += 1) {
    const result = await attemptLogin(loginName, "definitely-not-the-password", address);
    const expectedStatus = attempt < 4 ? 401 : 429;
    expect(result.status, `第 ${attempt} 次故意打错密码应当是 ${expectedStatus}`).toBe(expectedStatus);
  }
}

function searchBox(page: Page): Locator {
  return page.getByRole("textbox", { name: "Search members", exact: true });
}
function memberRow(page: Page, display_name: string): Locator {
  return page.getByRole("row", { name: `${display_name} member row`, exact: true });
}
function menuItem(page: Page, name: string): Locator {
  return page.getByRole("menuitem", { name, exact: true });
}

async function expectNotified(page: Page, text: string): Promise<void> {
  await expect(
    page.locator('[data-slot="toast-description"]').filter({ hasText: text }),
    `没有弹出通知「${text}」`,
  ).toBeVisible();
}

async function openMembers(page: Page, tag: string): Promise<void> {
  await page.goto("/admin");
  await expect(searchBox(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
  await searchBox(page).fill(tag);
}

async function openRowMenu(page: Page, display_name: string): Promise<void> {
  await memberRow(page, display_name).getByRole("button", { name: "Actions", exact: true }).click();
  await expect(page.locator("[data-admin-user-action-menu]")).toBeVisible();
}

test.beforeEach(async ({ context, trackArtifacts }, testInfo) => {
  trackArtifactsFlag = trackArtifacts;
  probeCounter += 1;
  const probeId = testInfo.workerIndex * PROBE_IDS_PER_WORKER + probeCounter;
  if (probeCounter > PROBE_IDS_PER_WORKER || probeId > 254) {
    throw new Error(
      `登录探针地址号段用尽（worker ${testInfo.workerIndex} 的第 ${probeCounter} 条）：第三段只有 254 个可用值`,
    );
  }
  probeAddress = `10.43.${probeId}.1`;
  controlAddress = `10.43.${probeId}.2`;
  /* 重置密码的产出物只进剪贴板，没有这个权限这条用例验不到终点。 */
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test("重置密码：剪贴板里的新口令能登进去，原来的口令当场作废", async ({ page, api, flow }) => {
  const tag = uniqueTag("pwd");
  const member = await createThrowawayMember(api, tag);
  await openMembers(page, tag);

  await openRowMenu(page, member.display_name);
  await flow.clickWithoutApi(menuItem(page, "Reset Password"));
  const confirmation = page.getByRole("dialog", { name: "Confirm password reset" });
  await confirmation.getByRole("textbox", { name: "Your current password", exact: true }).fill(ADMIN_PASSWORD);
  const payload = await flow.click(
    confirmation.getByRole("button", { name: "Reset member credentials", exact: true }),
    RESET_PASSWORD,
  ) as {
    temporary_login_name: string;
    temporary_password: string;
  };
  await expectNotified(page, "Temporary login name and password copied to clipboard");

  const copied = (await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n");
  expect(copied, "剪贴板必须包含服务端刚生成的临时登录名和口令")
    .toBe(`${payload.temporary_login_name}\n${payload.temporary_password}`);

  const recoveredPassword = "e2e-recovered-password-1";
  const recovery = await signIn(payload.temporary_login_name, payload.temporary_password, probeAddress);
  const invalidatedImmediately = await attemptLogin(member.login_name, member.password, probeAddress);
  try {
    const completion = await recovery.post("/api/auth/complete-password-reset", {
      data: {
        login_name: member.login_name,
        new_password: recoveredPassword,
        confirm_new_password: recoveredPassword,
      },
    });
    expect(
      completion.status(),
      `临时凭据登录后应能完成恢复：${completion.status()} ${await completion.text()}`,
    ).toBe(200);
  } finally {
    await recovery.dispose();
  }

  const withOldPassword = await attemptLogin(member.login_name, member.password, probeAddress);
  const withRecovered = await attemptLogin(member.login_name, recoveredPassword, probeAddress);

  expect(invalidatedImmediately.status, "管理员重置后旧登录名和口令必须立刻失效").toBe(401);
  expect(withOldPassword.status, "完成恢复后原密码仍必须失效").toBe(401);
  expect(withRecovered.status, `恢复后的凭据应当能登录：${withRecovered.message}`).toBe(200);
});

test("清除登录锁：连错四次之后账号被锁，点掉锁的那个才立刻能登，没点的对照组仍然被挡", async ({ page, api, flow }) => {
  const tag = uniqueTag("lock");
  const target = await createThrowawayMember(api, tag);
  const control = await createThrowawayMember(api, tag);

  await failLogins(target.login_name, probeAddress, 4);
  await failLogins(control.login_name, controlAddress, 4);

  /*
   * 对照组先确认锁真的生效了。没有这一步，后面「清完能登」的断言就悬空了——
   * 锁根本没上的话，那一条照样绿。
   * 429 有两个可能来源，所以连结构化详情一起断言：普通请求限流只有重试秒数，
   * 账号锁还必须给出锁定截止时间，供客户端持续展示剩余时长。
   */
  const blocked = await attemptLogin(control.login_name, control.password, controlAddress);
  expect(blocked.status, "连错四次之后，正确口令也该被挡在门外").toBe(429);
  expect(blocked.payload.error_code, "账号锁使用统一的限流错误合同").toBe("RATE_LIMITED");
  expect(blocked.payload.details?.retry_after_seconds, "客户端必须拿到剩余锁定秒数").toBeGreaterThan(0);
  expect(blocked.payload.details?.locked_until, "锁定截止时间能区分账号锁和普通请求限流")
    .toEqual(expect.any(String));

  await openMembers(page, tag);
  await openRowMenu(page, target.display_name);
  await flow.clickWithoutApi(menuItem(page, "Clear Login Lock"));
  const confirmation = await confirmDialog(page, "Clear login lock?");
  await expect(
    confirmation,
    "管理员确认前必须看到当前剩余锁定时长",
  ).toContainText(/Current lock time remaining: \d+ seconds?/);
  await flow.click(
    confirmation.getByRole("button", { name: "Clear Login Lock", exact: true }),
    RESET_LOGIN_LOCK,
  );
  await expectNotified(page, "Login lock cleared; the user can sign in again immediately");

  const unlocked = await attemptLogin(target.login_name, target.password, probeAddress);
  expect(unlocked.status, `清锁之后应当立刻能登：${unlocked.message}`).toBe(200);
});
