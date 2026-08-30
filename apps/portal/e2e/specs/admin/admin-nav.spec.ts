import type { Locator, Page } from "@playwright/test";
import { expect, readJson, test } from "../../support/test";

/*
 * 后台采用单一侧栏上下文导航，而不是页签。每个入口都要有明确的当前页状态，
 * 并和地址栏的 tab 查询参数保持同步。
 */

const ADMIN_AREAS = [
  { tab: "member", label: "Member Mgmt" },
  { tab: "invite", label: "Invite Links" },
  { tab: "roles", label: "Permissions" },
  { tab: "classes", label: "Classes" },
  { tab: "badges", label: "Badges" },
  { tab: "siteConfig", label: "Site Config" },
  { tab: "importantNotices", label: "Notices" },
  { tab: "operations", label: "Operations Overview" },
  { tab: "diagnostics", label: "Diagnostic Tools" },
  { tab: "audit", label: "Audit Log" },
] as const;

function navigationItem(page: Page, label: string): Locator {
  return page.locator(".app-sider").getByRole("button", { name: label, exact: true });
}

function statusState(value: string): "ok" | "configured" | "error" {
  if (value === "ok" || value.startsWith("ok (")) return "ok";
  if (
    value === "configured"
    || value.startsWith("configured (")
    || value === "degraded"
    || value.startsWith("degraded (")
  ) return "configured";
  return "error";
}

function healthLabel(status: { db: string; r2: string; ws: string; crons: string }): string {
  const states = [status.db, status.r2, status.ws, status.crons].map(statusState);
  if (states.every((state) => state === "ok")) return "All systems normal";
  if (!states.includes("error")) return "Configured; runtime unverified";
  return "Degraded";
}

test.beforeEach(async ({ page }) => {
  await page.goto("/admin");
  await expect(navigationItem(page, "Member Mgmt")).toHaveAttribute("aria-current", "page");
  await page.waitForLoadState("networkidle");
});

test("门户跳转链接把键盘焦点移到主工作区", async ({ page }) => {
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("十个后台区都在侧栏中，逐个切换后只保留当前工作区", async ({ page }) => {
  await expect(page.locator(".app-sider .app-nav-item"), "十个后台入口都必须可达").toHaveCount(ADMIN_AREAS.length);

  for (const area of ADMIN_AREAS) {
    const item = navigationItem(page, area.label);
    await item.click();
    await expect(item).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL(
      area.tab === "member"
        ? /\/admin(\?(?!.*tab=).*)?$/
        : new RegExp(`/admin\\?.*tab=${area.tab}`),
    );
    await expect(page.locator(".admin-page__panel"), `切到「${area.label}」后只能留下当前工作区`).toHaveCount(1);
  }
});

test("侧栏导航和地址栏双向同步", async ({ page }) => {
  await navigationItem(page, "Audit Log").click();
  await expect(page).toHaveURL(/\/admin\?.*tab=audit/);

  await navigationItem(page, "Member Mgmt").click();
  await expect(page).toHaveURL(/\/admin(\?(?!.*tab=).*)?$/);

  await page.goto("/admin?tab=diagnostics");
  await expect(navigationItem(page, "Diagnostic Tools")).toHaveAttribute("aria-current", "page");

  await page.goto("/admin?tab=member");
  await expect(navigationItem(page, "Member Mgmt")).toHaveAttribute("aria-current", "page");
});

test("侧栏徽章显示已加载的成员、角色和邀请链接统计", async ({ page, api }) => {
  const users = await readJson(await api.get("/api/users?page=1&limit=500"), "读取成员") as { total: number };
  const roles = await readJson(await api.get("/api/admin/roles"), "读取角色") as unknown[];
  const inviteStats = await readJson(await api.get("/api/admin/invite-links/stats"), "读取邀请统计") as { active: number };

  await expect(navigationItem(page, "Member Mgmt").locator(".app-nav-count")).toHaveText(String(users.total));
  await expect(navigationItem(page, "Permissions").locator(".app-nav-count")).toHaveText(String(roles.length));

  await navigationItem(page, "Invite Links").click();
  await expect(navigationItem(page, "Invite Links").locator(".app-nav-count")).toHaveText(String(inviteStats.active));
});

test("Operations 入口在健康检查完成后给出可访问的状态", async ({ page, api }) => {
  const status = await readJson(await api.get("/api/admin/status"), "读取系统状态") as {
    db: string; r2: string; ws: string; crons: string;
  };
  const operations = navigationItem(page, "Operations Overview");
  const indicator = operations.locator(".app-nav-status");

  await expect(indicator).toHaveAccessibleName("Checking");
  await operations.click();
  await expect(operations).toHaveAttribute("aria-current", "page");
  await expect(indicator).toHaveAccessibleName(healthLabel(status));
});
