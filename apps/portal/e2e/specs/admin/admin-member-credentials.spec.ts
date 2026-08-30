import { request, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { MUTATION_HEADERS } from "../../support/api";
import { ADMIN_PASSWORD, PORTAL_ORIGIN } from "../../support/config";
import { createThrowawayMember, uniqueTag } from "../../support/members";
import { expect, identityHeaders, test } from "../../support/test";
import { expectToast } from "../../support/ui";

/*
 * 重置密码的产出物只进剪贴板，所以验收必须走到「拿这个结果去登录」为止：
 * 只断言接口 200，等于把「服务端改了密码但没生效」这类问题全部放过。
 */

const RESET_PASSWORD = { method: "POST", path: /^\/api\/admin\/users\/[^/]+\/reset-password$/ } as const;

type LoginPayload = {
  error_code?: string;
  message?: string;
  details?: {
    retry_after_seconds?: number;
  };
};
type LoginResult = { status: number; message: string; payload: LoginPayload };

let trackArtifactsFlag: boolean;

/*
 * 登录探针专用的客户端地址，和 fixture 分配的 10.42.x.y、globalSetup 的 10.41.0.1 都错开。
 * 跨用例不复用，因为限流窗口是一整分钟，上一条用例花掉的配额会算到下一条头上。
 *
 * 号段按 workerIndex 切，理由和 support/test.ts 里的 clientAddress 完全一样：
 * 模块级计数器的生命周期是 worker 进程，Playwright 一有失败就换进程、计数器归零，
 * 于是刚被花光配额的地址会重新发给下一条用例，429 会干扰登录结果断言。
 */
const PROBE_IDS_PER_WORKER = 1;
let probeCounter = 0;
let probeAddress: string;

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

function searchBox(page: Page): Locator {
  return page.getByRole("textbox", { name: "Search members", exact: true });
}
function memberRow(page: Page, display_name: string): Locator {
  return page.getByRole("row", { name: `${display_name} member row`, exact: true });
}
function menuItem(page: Page, name: string): Locator {
  return page.getByRole("menuitem", { name, exact: true });
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
  await expectToast(page, "Temporary login name and password copied to clipboard");

  const copied = (await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n");
  expect(copied, "剪贴板必须包含服务端刚生成的临时登录名和口令")
    .toBe(`${payload.temporary_login_name}\n${payload.temporary_password}`);

  const recoveredPassword = "E2e-recovered-password-1";
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
