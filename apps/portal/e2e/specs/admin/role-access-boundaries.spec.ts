import type { AdminRole } from "@guild/shared";
import {
  request,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { MUTATION_HEADERS } from "../../support/api";
import { clientIdentityHeaders, PORTAL_ORIGIN } from "../../support/config";
import {
  createThrowawayMember,
  readAssignableRoles,
  uniqueTag,
  type ThrowawayMember,
} from "../../support/members";
import {
  expect,
  identityHeaders,
  test,
  watchPageDefects,
} from "../../support/test";

type RoleSession = {
  account: ThrowawayMember;
  context: BrowserContext;
  page: Page;
  assertClean: () => void;
};

async function expectOk(response: Awaited<ReturnType<APIRequestContext["post"]>>, label: string): Promise<void> {
  expect(response.ok(), `${label} -> ${response.status()}: ${await response.text()}`).toBe(true);
}

async function createRoleSession({
  adminApi,
  browser,
  clientAddress,
  trackArtifacts,
  role,
  tag,
}: {
  adminApi: APIRequestContext;
  browser: Browser;
  clientAddress: string;
  trackArtifacts: boolean;
  role: AdminRole;
  tag: string;
}): Promise<RoleSession> {
  const created = await createThrowawayMember(adminApi, tag, role);
  const permanentLoginName = `${created.login_name}_ready`;
  const permanentPassword = "E2e-role-password-1";
  /* 临时账号已经由管理员请求登记进本轮 run；首次登录和设永久密码产生的
     user_auth 审计也必须带 run 头，才能在收尾时按精确审计 id 删除。
     浏览器只做读取和导航，保留普通客户端头，停用后才会看见真实的 401。 */
  const sessionHeaders = identityHeaders(clientAddress, trackArtifacts);
  const browserHeaders = clientIdentityHeaders(clientAddress);
  const auth = await request.newContext({
    baseURL: PORTAL_ORIGIN,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { ...MUTATION_HEADERS, ...sessionHeaders },
  });

  try {
    await expectOk(await auth.post("/api/auth/login", {
      data: {
        login_name: created.login_name,
        password: created.password,
        stay_logged_in: true,
      },
    }), `${role.name} 临时凭据登录`);
    await expectOk(await auth.post("/api/auth/complete-password-reset", {
      data: {
        login_name: permanentLoginName,
        new_password: permanentPassword,
        confirm_new_password: permanentPassword,
      },
    }), `${role.name} 完成首次凭据设置`);

    const context = await browser.newContext({
      baseURL: PORTAL_ORIGIN,
      storageState: await auth.storageState(),
      ignoreHTTPSErrors: true,
      locale: "en-US",
      timezoneId: "UTC",
      extraHTTPHeaders: browserHeaders,
    });
    const page = await context.newPage();
    return {
      account: {
        ...created,
        login_name: permanentLoginName,
        password: permanentPassword,
      },
      context,
      page,
      assertClean: watchPageDefects(page),
    };
  } finally {
    await auth.dispose();
  }
}

async function closeRoleSession(session: RoleSession): Promise<void> {
  await session.context.close();
  session.assertClean();
}

function roleById(roles: readonly AdminRole[], id: string): AdminRole {
  const role = roles.find((candidate) => candidate.id === id);
  if (!role) throw new Error(`E2E 角色列表缺少 ${id}`);
  return role;
}

test("普通成员只能进入成员功能，越权路由被拒绝，停用后现有会话立即失效", async ({
  api,
  browser,
  clientAddress,
  trackArtifacts,
}) => {
  const roles = await readAssignableRoles(api);
  const session = await createRoleSession({
    adminApi: api,
    browser,
    clientAddress,
    trackArtifacts,
    role: roleById(roles, "member"),
    tag: uniqueTag("role_member"),
  });

  try {
    await session.page.goto("/profile");
    await expect(session.page.getByRole("heading", { name: "My Profile", exact: true })).toBeVisible();
    await expect(
      session.page.locator(".app-sider").getByRole("button", { name: "Admin", exact: true }),
      "普通成员不应看到后台入口",
    ).toHaveCount(0);

    await session.page.goto("/gallery");
    await expect(
      session.page.locator(".gallery-filters").getByRole("button", { name: "Add Media", exact: true }),
      "默认成员的 gallery.upload 权限必须在界面上可用",
    ).toBeVisible();

    await session.page.goto("/events/new");
    await expect(session.page).toHaveURL(/\/403$/);
    await expect(session.page.getByRole("heading", { name: "Unable to access this page", exact: true })).toBeVisible();

    await session.page.goto("/admin");
    await expect(session.page).toHaveURL(/\/403$/);
    await expect(session.page.getByRole("heading", { name: "Unable to access this page", exact: true })).toBeVisible();

    await expectOk(await api.patch(`/api/admin/users/${session.account.id}/deactivate`, {
      data: { reason: "E2E session revocation boundary" },
    }), "管理员停用普通成员");
    await session.page.goto("/profile");
    await expect(session.page).toHaveURL((url) =>
      url.pathname === "/login"
      && url.searchParams.get("returnTo") === "/profile"
      && url.searchParams.get("reason") === "required",
    );
  } finally {
    await closeRoleSession(session);
  }
});

test("版主能进入获授权工作区，但看不到站点配置与高权限成员操作", async ({
  api,
  browser,
  clientAddress,
  trackArtifacts,
}) => {
  const roles = await readAssignableRoles(api);
  const memberRole = roleById(roles, "member");
  const target = await createThrowawayMember(api, uniqueTag("role_target"), memberRole);
  const session = await createRoleSession({
    adminApi: api,
    browser,
    clientAddress,
    trackArtifacts,
    role: roleById(roles, "moderator"),
    tag: uniqueTag("role_moderator"),
  });

  try {
    await session.page.goto("/admin");
    await expect(
      session.page.locator(".app-sider").getByRole("button", { name: "Member Mgmt", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(session.page.getByRole("button", { name: "Create Member", exact: true })).toBeVisible();

    for (const forbiddenArea of ["Classes", "Badges", "Site Config", "Notices"]) {
      await expect(
        session.page.locator(".app-sider").getByRole("button", { name: forbiddenArea, exact: true }),
        `版主不应看到 ${forbiddenArea} 工作区`,
      ).toHaveCount(0);
    }
    await expect(
      session.page.locator(".app-sider .app-nav-item"),
      "版主后台应只显示其六个可访问工作区",
    ).toHaveCount(6);

    await session.page.goto("/admin?tab=siteConfig");
    await expect(session.page).toHaveURL(/\/admin(?:\?|$)/);
    await expect(
      session.page.locator(".app-sider").getByRole("button", { name: "Member Mgmt", exact: true }),
      "不可访问的后台查询参数必须回落到首个获授权工作区",
    ).toHaveAttribute("aria-current", "page");

    await session.page.getByRole("textbox", { name: "Search members", exact: true }).fill(target.display_name);
    const targetRow = session.page.getByRole("row", {
      name: `${target.display_name} member row`,
      exact: true,
    });
    await expect(targetRow).toBeVisible();
    await targetRow.getByRole("button", { name: "Actions", exact: true }).click();
    const actionMenu = session.page.locator("[data-admin-user-action-menu]");
    for (const forbiddenAction of ["Change Role", "Deactivate", "Reset Password", "Remove member"]) {
      await expect(
        actionMenu.getByRole("menuitem", { name: forbiddenAction, exact: true }),
        `版主缺少对应权限时，${forbiddenAction} 必须明确禁用`,
      ).toHaveAttribute("aria-disabled", "true");
    }
    await session.page.keyboard.press("Escape");

    await session.page.goto("/events/new");
    await expect(session.page.getByRole("heading", { name: "Create Event", exact: true })).toBeVisible();

    await session.page.goto("/gallery");
    await expect(
      session.page.locator(".gallery-filters").getByRole("button", { name: "Add Media", exact: true }),
    ).toBeVisible();
  } finally {
    await closeRoleSession(session);
  }
});
