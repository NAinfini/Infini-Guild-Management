import type { Page } from "@playwright/test";
import { expect, readJson, test } from "../../support/test";

/*
 * 后台的八个页签本身：切换、URL 同步、徽章数字。
 *
 * 这一条只管导航，各页签内部的控件由同目录下的 admin-<tab>.spec.ts 分别覆盖。
 * 页签用的是 keepMounted={false}，切走的面板会整个卸载——所以「切过去内容真的
 * 渲染出来了」必须逐个断言，不能只看页签自己的选中态。
 *
 * 三个计数徽章（成员数、有效邀请码、角色数）都要和服务端对上：这些数字是管理员
 * 判断要不要点进去的唯一依据，对不上比不显示更糟。
 */

const TABS = [
  { value: "member", label: "Member Mgmt", heading: "Member Management" },
  { value: "invite", label: "Invite Links", heading: "Invite Links" },
  { value: "audit", label: "Audit Log", heading: "Audit Log" },
  { value: "roles", label: "Permissions", heading: "Permissions" },
  { value: "siteConfig", label: "Site Config", heading: "Site Config" },
  { value: "classes", label: "Classes", heading: "Classes" },
  { value: "badges", label: "Badges", heading: "Badges" },
  { value: "status", label: "Status", heading: "Status" },
] as const;

function tab(page: Page, label: string) {
  return page.getByRole("tab", { name: new RegExp(label) });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/admin");
  await expect(tab(page, "Member Mgmt")).toHaveAttribute("aria-selected", "true");
  await page.waitForLoadState("networkidle");
});

test("八个页签都在，逐个切过去面板真的换了内容", async ({ page }) => {
  await expect(page.getByRole("tab"), "八项一个都不能少").toHaveCount(TABS.length);

  for (const entry of TABS) {
    await tab(page, entry.label).click();
    await expect(tab(page, entry.label)).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("tabpanel"),
      `切到「${entry.label}」之后面板必须只剩这一个`,
    ).toHaveCount(1);
  }
});

test("URL 与页签双向同步：切页签改地址，直接带 tab 进来落在对应页签", async ({ page }) => {
  await tab(page, "Audit Log").click();
  await expect(page, "切页签必须写进地址栏，否则刷新就回到第一页").toHaveURL(/\/admin\?.*tab=audit/);

  /* 第一个页签是默认值，按设计从地址里去掉，不是「没同步」。 */
  await tab(page, "Member Mgmt").click();
  await expect(page).toHaveURL(/\/admin(\?(?!.*tab=).*)?$/);

  await page.goto("/admin?tab=badges");
  await expect(tab(page, "Badges")).toHaveAttribute("aria-selected", "true");

  /* 地址里塞一个不存在的页签，应该退回第一个页签而不是白屏。 */
  await page.goto("/admin?tab=member");
  await expect(tab(page, "Member Mgmt")).toHaveAttribute("aria-selected", "true");
});

test("页签徽章：成员数与角色数进来就对得上，邀请码那个要进过邀请页签才出现", async ({ page, api }) => {
  const users = await readJson(await api.get("/api/users?page=1&limit=500"), "读取成员") as {
    total: number;
  };
  const roles = await readJson(await api.get("/api/admin/roles"), "读取角色") as unknown[];
  const inviteStats = await readJson(await api.get("/api/admin/invite-links/stats"), "读取邀请统计") as {
    active: number;
  };

  /*
   * 现状如实记录，这是一处设计缺陷：
   * 邀请码统计（useAdminData.ts:87）配的是 enabled: activeTab === "invite"，
   * 于是这枚徽章——它存在的意义就是让人不进页签也能看到还有几个码有效——
   * 在没进过邀请页签之前根本不显示。成员数和角色数没有这个限制。
   */
  const counts = page.locator(".admin-page__nav-count");
  await expect(counts, "刚进来只有成员和角色两个徽章").toHaveCount(2);
  await expect(counts.nth(0), "成员徽章").toHaveText(String(users.total));
  await expect(counts.nth(1), "角色徽章").toHaveText(String(roles.length));

  await tab(page, "Invite Links").click();
  await expect(counts, "进过邀请页签之后第三枚才补上").toHaveCount(3);
  await expect(counts.nth(1), "有效邀请码徽章").toHaveText(String(inviteStats.active));
});

test("运维页签上的健康点：进过状态页签之前一直是「检查中」，进去之后才给出真实状态", async ({ page, api }) => {
  const status = await readJson(await api.get("/api/admin/status"), "读取系统状态") as {
    db: string; r2: string; ws: string; crons: string;
  };
  const values = [status.db, status.r2, status.ws, status.crons];
  const expected = values.every((value) => value === "ok")
    ? "All systems normal"
    : values.every((value) => value === "ok" || value === "configured")
      ? "Configured; runtime unverified"
      : "Degraded";

  const dot = page.locator(".admin-page__nav-dot");
  await expect(dot).toHaveCount(1);
  /*
   * 同上的缺陷，而且这个更糟：状态查询也只在状态页签激活时才发
   * （useAdminData.ts:118），所以这颗点在别的页签上永远停在「检查中」。
   * 一个「一眼看健康」的指示灯，只有先点进去看过才会亮——它想解决的问题
   * 恰恰是让人不用点进去。
   */
  await expect(dot, "还没进状态页签时只能是检查中").toHaveAttribute("aria-label", "Checking");

  await tab(page, "Status").click();
  /* 这颗点是健康状态的唯一载体，必须带可读标签——aria-hidden 的话读屏用户什么都拿不到。 */
  await expect(dot).toHaveAttribute("aria-label", expected);
});
