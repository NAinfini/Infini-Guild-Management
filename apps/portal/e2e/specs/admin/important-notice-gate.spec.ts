import type { ImportantNotice, ImportantNoticeActive } from "@guild/shared";
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
} from "../../support/members";
import {
  createFlow,
  expect,
  identityHeaders,
  readJson,
  test,
  watchPageDefects,
} from "../../support/test";

const ACKNOWLEDGE_NOTICE = { method: "PUT", path: /^\/api\/important-notices\/[^/]+\/acknowledgement$/ } as const;

type MemberSession = {
  api: APIRequestContext;
  context: BrowserContext;
  page: Page;
  assertClean: () => void;
};

function requiredMemberRole(roles: Awaited<ReturnType<typeof readAssignableRoles>>) {
  const role = roles.find((candidate) => candidate.id === "member");
  if (!role) throw new Error("E2E role catalog is missing the ordinary member role");
  return role;
}

async function expectOk(response: Awaited<ReturnType<APIRequestContext["post"]>>, label: string): Promise<void> {
  expect(response.ok(), `${label} -> ${response.status()}: ${await response.text()}`).toBe(true);
}

async function createMemberSession({
  adminApi,
  browser,
  clientAddress,
  trackArtifacts,
}: {
  adminApi: APIRequestContext;
  browser: Browser;
  clientAddress: string;
  trackArtifacts: boolean;
}): Promise<MemberSession> {
  const account = await createThrowawayMember(
    adminApi,
    uniqueTag("important_notice_member"),
    requiredMemberRole(await readAssignableRoles(adminApi)),
  );
  const loginName = `${account.login_name}_ready`;
  const password = "E2e-important-notice-password-1";
  const api = await request.newContext({
    baseURL: PORTAL_ORIGIN,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      ...MUTATION_HEADERS,
      ...identityHeaders(clientAddress, trackArtifacts),
    },
  });

  try {
    await expectOk(await api.post("/api/auth/login", {
      data: { login_name: account.login_name, password: account.password, stay_logged_in: true },
    }), "普通成员临时凭据登录");
    await expectOk(await api.post("/api/auth/complete-password-reset", {
      data: { login_name: loginName, new_password: password, confirm_new_password: password },
    }), "普通成员完成首次凭据设置");

    const context = await browser.newContext({
      baseURL: PORTAL_ORIGIN,
      storageState: await api.storageState(),
      ignoreHTTPSErrors: true,
      locale: "en-US",
      timezoneId: "UTC",
      extraHTTPHeaders: clientIdentityHeaders(clientAddress),
    });
    const page = await context.newPage();
    return { api, context, page, assertClean: watchPageDefects(page) };
  } catch (error) {
    await api.dispose();
    throw error;
  }
}

async function removeNotice(api: APIRequestContext, notice: ImportantNotice): Promise<void> {
  let current = notice;
  if (current.status === "published" || current.status === "scheduled") {
    current = await readJson(
      await api.post(`/api/admin/important-notices/${current.id}/withdraw`),
      "测试清理：撤回重要通知",
    ) as ImportantNotice;
    expect(current.status, "撤回后的通知不能继续投递").toBe("withdrawn");
  }
  await readJson(
    await api.delete(`/api/admin/important-notices/${current.id}`),
    "测试清理：删除重要通知",
  );
}

test("required notice blocks a new member until acknowledgement, then preserves the requested route", async ({
  api,
  browser,
  clientAddress,
  trackArtifacts,
}) => {
  const title = `E2E required notice ${uniqueTag("gate")}`;
  let notice: ImportantNotice | null = null;
  let member: MemberSession | null = null;

  try {
    notice = await readJson(await api.post("/api/admin/important-notices", {
      data: {
        title,
        body_json: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Acknowledge this before continuing." }] }],
        }),
        status: "draft",
        requires_acknowledgement: true,
        audience_scope: "all",
        audience_role_ids: [],
      },
    }), "管理员创建需确认的重要通知") as ImportantNotice;
    expect(notice).toMatchObject({ status: "draft", requires_acknowledgement: true });

    notice = await readJson(
      await api.post(`/api/admin/important-notices/${notice.id}/publish`),
      "管理员发布需确认的重要通知",
    ) as ImportantNotice;
    expect(notice).toMatchObject({ status: "published", requires_acknowledgement: true, publication_revision: 1 });
    const noticeId = notice.id;

    member = await createMemberSession({ adminApi: api, browser, clientAddress, trackArtifacts });
    await member.page.goto("/dashboard");

    const dialog = member.page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(member.page).toHaveURL(/\/dashboard$/);
    await expect(member.page.locator("#root"), "未确认时门户内容必须不可交互").toHaveAttribute("inert", "");

    await createFlow(member.page).click(
      dialog.getByRole("button", { name: /I have read this/, exact: false }),
      ACKNOWLEDGE_NOTICE,
    );

    await expect(dialog).toHaveCount(0);
    await expect(member.page.locator("#root")).not.toHaveAttribute("inert", "");
    await expect(member.page).toHaveURL(/\/dashboard$/);
    await expect(member.page.locator(".dashboard-page")).toBeVisible();

    const active = await readJson(
      await member.api.get("/api/important-notices/active"),
      "回读普通成员的重要通知确认状态",
    ) as { data: ImportantNoticeActive[] };
    expect(active.data.find((entry) => entry.id === noticeId)?.acknowledged_at).toEqual(expect.any(String));
  } finally {
    try {
      if (member) {
        try {
          await member.context.close();
          member.assertClean();
        } finally {
          await member.api.dispose();
        }
      }
    } finally {
      if (notice) await removeNotice(api, notice);
    }
  }
});
