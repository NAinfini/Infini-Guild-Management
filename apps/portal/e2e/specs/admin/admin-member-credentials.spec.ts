import { request, type Locator, type Page } from "@playwright/test";
import { MUTATION_HEADERS } from "../../support/api";
import { PORTAL_ORIGIN } from "../../support/config";
import { createThrowawayMember, uniqueTag } from "../../support/members";
import { expect, identityHeaders, test } from "../../support/test";

/*
 * 行操作菜单里的两件凭据类操作：重置密码、清除登录锁。
 *
 * 这两个控件在界面上什么都不改——点完只有一句提示，唯一的产出物一个进了剪贴板、
 * 一个只存在于 login_failures 表里。所以验收必须走到「拿这个结果去登录」为止：
 * 只断言接口 200，等于把「服务端改了密码但没生效」这类问题全部放过。
 *
 * 关于登录次数：/api/auth/login 上叠了两层限流，按 IP 和按用户名各 5 次/分钟
 * （apps/shared/config/limits.ts:80）。锁定阶梯本身是「前 3 次免费、第 4 次失败开始锁」
 * （login-lockout.ts:26）。两者相加，同一个用户名在一分钟内最多只够 4 次失败 + 1 次验证，
 * 所以下面每个账号的登录尝试都严格卡在 5 次以内，对照组也必须换一个客户端地址。
 */

const RESET_PASSWORD = { method: "POST", path: /^\/api\/admin\/users\/[^/]+\/reset-password$/ } as const;
const RESET_LOGIN_LOCK = { method: "POST", path: /^\/api\/admin\/users\/[^/]+\/reset-login-lock$/ } as const;

type LoginResult = { status: number; message: string };

let trackArtifactsFlag: boolean;

/*
 * 登录探针专用的客户端地址，和 fixture 分配的 10.42.x.y、globalSetup 的 10.41.0.1 都错开。
 * 每条用例、每个账号各占一个地址，两个原因：
 *   - 同一条用例里的对照组必须换地址，否则 10 次登录会先撞上 IP 限流，
 *     429 就分不清是「账号被锁」还是「请求太密」；
 *   - 跨用例也不能复用，限流窗口是一整分钟，上一条用例花掉的配额会算到下一条头上。
 */
let probeCounter = 0;
let probeAddress: string;
let controlAddress: string;

/**
 * 单开一条通道试一次登录。
 * 必须挂运行头：登录成功和失败都会写 user_auth 审计行，没登记的审计行会让
 * 收尾阶段的 deleteRegisteredUsers 直接抛错，报成「清理失败」。
 */
async function attemptLogin(username: string, password: string, address: string): Promise<LoginResult> {
  const probe = await request.newContext({
    baseURL: PORTAL_ORIGIN,
    extraHTTPHeaders: { ...MUTATION_HEADERS, ...identityHeaders(address, trackArtifactsFlag) },
  });
  const response = await probe.post("/api/auth/login", { data: { username, password } });
  const status = response.status();
  const body = await response.text();
  await probe.dispose();
  return { status, message: body };
}

/** 连续打错密码。第 4 次之后阶梯开始锁账号（前 3 次是免费的打字容错）。 */
async function failLogins(username: string, address: string, times: number): Promise<void> {
  for (let attempt = 1; attempt <= times; attempt += 1) {
    const result = await attemptLogin(username, "definitely-not-the-password", address);
    expect(result.status, `第 ${attempt} 次故意打错密码应当是 401`).toBe(401);
  }
}

function searchBox(page: Page): Locator {
  return page.getByPlaceholder("Search members...");
}
function memberRow(page: Page, username: string): Locator {
  return page.getByRole("row", { name: `${username} member row`, exact: true });
}
function menuItem(page: Page, name: string): Locator {
  return page.getByRole("menuitem", { name, exact: true });
}

async function expectNotified(page: Page, text: string): Promise<void> {
  await expect(
    page.locator(".mantine-Notification-description").filter({ hasText: text }),
    `没有弹出通知「${text}」`,
  ).toBeVisible();
}

async function openMembers(page: Page, tag: string): Promise<void> {
  await page.goto("/admin");
  await expect(searchBox(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
  await searchBox(page).fill(tag);
}

async function openRowMenu(page: Page, username: string): Promise<void> {
  await memberRow(page, username).getByRole("button", { name: "Actions", exact: true }).click();
  await expect(page.locator("[data-admin-user-action-menu]")).toBeVisible();
}

test.beforeEach(async ({ context, trackArtifacts }) => {
  trackArtifactsFlag = trackArtifacts;
  probeCounter += 1;
  probeAddress = `10.43.${probeCounter}.1`;
  controlAddress = `10.43.${probeCounter}.2`;
  /* 重置密码的产出物只进剪贴板，没有这个权限这条用例验不到终点。 */
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test("重置密码：剪贴板里的新口令能登进去，原来的口令当场作废", async ({ page, api, flow }) => {
  const tag = uniqueTag("pwd");
  const member = await createThrowawayMember(api, tag);
  await openMembers(page, tag);

  await openRowMenu(page, member.username);
  const payload = await flow.click(menuItem(page, "Reset Password"), RESET_PASSWORD) as {
    temporary_password: string;
  };
  await expectNotified(page, "Temporary password copied to clipboard");

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied, "剪贴板里必须就是服务端刚生成的那一串，否则管理员发出去的是个假口令")
    .toBe(payload.temporary_password);

  const withNew = await attemptLogin(member.username, payload.temporary_password, probeAddress);
  expect(withNew.status, `新口令应当能登录：${withNew.message}`).toBe(200);

  const withOld = await attemptLogin(member.username, member.password, probeAddress);
  expect(withOld.status, "旧口令必须立刻失效").toBe(401);
});

test("清除登录锁：连错四次之后账号被锁，点掉锁的那个才立刻能登，没点的对照组仍然被挡", async ({ page, api, flow }) => {
  const tag = uniqueTag("lock");
  const target = await createThrowawayMember(api, tag);
  const control = await createThrowawayMember(api, tag);

  await failLogins(target.username, probeAddress, 4);
  await failLogins(control.username, controlAddress, 4);

  /*
   * 对照组先确认锁真的生效了。没有这一步，后面「清完能登」的断言就悬空了——
   * 锁根本没上的话，那一条照样绿。
   * 429 有两个可能来源，所以连文案一起断言：限流说的是 Too many requests，
   * 账号锁说的是 This account is locked。
   */
  const blocked = await attemptLogin(control.username, control.password, controlAddress);
  expect(blocked.status, "连错四次之后，正确口令也该被挡在门外").toBe(429);
  expect(blocked.message, "挡住它的必须是账号锁，不是请求限流").toContain("This account is locked");

  await openMembers(page, tag);
  await openRowMenu(page, target.username);
  await flow.click(menuItem(page, "Clear Login Lock"), RESET_LOGIN_LOCK);
  await expectNotified(page, "Login lock cleared; the user can sign in again immediately");

  const unlocked = await attemptLogin(target.username, target.password, probeAddress);
  expect(unlocked.status, `清锁之后应当立刻能登：${unlocked.message}`).toBe(200);
});
