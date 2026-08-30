import { request, type APIRequestContext, type Browser } from "@playwright/test";
import { MUTATION_HEADERS } from "../../support/api";
import { PORTAL_ORIGIN } from "../../support/config";
import { createThrowawayMember, uniqueTag, type ThrowawayMember } from "../../support/members";
import {
  createFlow,
  expect,
  identityHeaders,
  test,
  watchPageDefects,
} from "../../support/test";

const LOGIN = { method: "POST", path: /^\/api\/auth\/login$/ } as const;
const COMPLETE_PASSWORD_RESET = { method: "POST", path: /^\/api\/auth\/complete-password-reset$/ } as const;

async function openUnauthenticatedPage(
  browser: Browser,
  clientAddress: string,
) {
  const context = await browser.newContext({
    baseURL: PORTAL_ORIGIN,
    storageState: { cookies: [], origins: [] },
    ignoreHTTPSErrors: true,
    locale: "en-US",
    timezoneId: "UTC",
    extraHTTPHeaders: identityHeaders(clientAddress, false),
  });
  const trackedAuthHeaders = identityHeaders(clientAddress, true);
  await context.route("**/api/auth/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const trackedMutation = request.method() === "POST"
      && (pathname === "/api/auth/login" || pathname === "/api/auth/complete-password-reset");
    await route.continue({
      headers: trackedMutation
        ? { ...request.headers(), ...trackedAuthHeaders }
        : request.headers(),
    });
  });
  const page = await context.newPage();
  return { context, page, flow: createFlow(page), assertPageClean: watchPageDefects(page) };
}

async function createReadyMember(
  api: APIRequestContext,
  clientAddress: string,
): Promise<ThrowawayMember> {
  const created = await createThrowawayMember(api, uniqueTag("auth_safe_return"));
  const loginName = `${created.login_name}_ready`;
  const password = "E2e-auth-ready-password-1";
  const auth = await request.newContext({
    baseURL: PORTAL_ORIGIN,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { ...MUTATION_HEADERS, ...identityHeaders(clientAddress, true) },
  });

  try {
    const login = await auth.post("/api/auth/login", {
      data: { login_name: created.login_name, password: created.password, stay_logged_in: true },
    });
    expect(login.ok(), `临时成员登录返回 ${login.status()}: ${await login.text()}`).toBe(true);

    const completion = await auth.post("/api/auth/complete-password-reset", {
      data: { login_name: loginName, new_password: password, confirm_new_password: password },
    });
    expect(completion.ok(), `临时成员设置永久凭据返回 ${completion.status()}: ${await completion.text()}`).toBe(true);
  } finally {
    await auth.dispose();
  }

  return { ...created, login_name: loginName, password };
}

test("临时成员登录后必须完成改密，并回到原受保护页面", async ({
  api,
  browser,
  clientAddress,
}) => {
  const member = await createThrowawayMember(api, uniqueTag("auth_forced_reset"));
  const guest = await openUnauthenticatedPage(browser, clientAddress);
  const loginName = `${member.login_name}_ready`;
  const password = "E2e-auth-reset-password-1";

  try {
    await guest.page.goto("/storage");
    await expect(guest.page).toHaveURL((url) => (
      url.pathname === "/login" && url.searchParams.get("returnTo") === "/storage"
    ));

    await guest.page.getByLabel("Login name", { exact: true }).fill(member.login_name);
    await guest.page.getByLabel("Password", { exact: true }).fill(member.password);
    await guest.flow.click(guest.page.getByRole("button", { name: "Sign in", exact: true }), LOGIN);
    await expect(guest.page).toHaveURL((url) => (
      url.pathname === "/complete-password-reset" && url.searchParams.get("returnTo") === "/storage"
    ));
    await expect(guest.page.getByRole("heading", { name: "Set up your account", exact: true })).toBeVisible();

    await guest.page.getByLabel("Login name", { exact: true }).fill(loginName);
    await guest.page.getByLabel("Password", { exact: true }).fill(password);
    await guest.page.getByLabel("Confirm password", { exact: true }).fill(password);
    await guest.flow.click(
      guest.page.getByRole("button", { name: "Save account credentials", exact: true }),
      COMPLETE_PASSWORD_RESET,
    );

    await expect(guest.page, "完成强制改密后必须保留安全的回跳目标").toHaveURL("/storage");
  } finally {
    await guest.context.close();
    guest.assertPageClean();
  }
});

test("错误登录保持通用错误，合法登录忽略不安全的回跳地址", async ({
  api,
  browser,
  clientAddress,
}) => {
  const member = await createReadyMember(api, clientAddress);
  const guest = await openUnauthenticatedPage(browser, clientAddress);

  try {
    await guest.page.goto("/login?returnTo=%2F%2Fattacker.example%2Fsteal");
    await guest.page.getByLabel("Login name", { exact: true }).fill(member.login_name);
    await guest.page.getByLabel("Password", { exact: true }).fill("definitely-not-the-password");
    await guest.flow.click(
      guest.page.getByRole("button", { name: "Sign in", exact: true }),
      { ...LOGIN, status: 401 },
    );
    await expect(guest.page.getByRole("alert")).toHaveText("Invalid credentials");
    await expect(guest.page).toHaveURL(/\/login\?/);

    await guest.page.getByLabel("Password", { exact: true }).fill(member.password);
    await guest.flow.click(guest.page.getByRole("button", { name: "Sign in", exact: true }), LOGIN);
    await expect(guest.page, "不安全 returnTo 不能离开当前站点").toHaveURL("/dashboard");
  } finally {
    await guest.context.close();
    guest.assertPageClean();
  }
});
