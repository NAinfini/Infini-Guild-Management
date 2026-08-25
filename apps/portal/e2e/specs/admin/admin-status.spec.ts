import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, readJson, test } from "../../support/test";

type StatusData = { db: string; r2: string; ws: string; crons: string };

const SERVICE_LABEL = {
  db: "Member and event data",
  r2: "Media storage",
  ws: "Live updates",
  crons: "Scheduled jobs",
} as const;

function serviceState(value: string): "ok" | "configured" | "error" {
  if (value === "ok" || value.startsWith("ok (")) return "ok";
  if (
    value === "configured"
    || value.startsWith("configured (")
    || value === "degraded"
    || value.startsWith("degraded (")
  ) return "configured";
  return "error";
}

function statusLabel(value: string): string {
  if (value === "ok" || value.startsWith("ok (")) return "Verified";
  if (value === "configured" || value.startsWith("configured (")) return "Configured only";
  return value.toUpperCase();
}

function overallLabel(status: StatusData): string {
  const states = [status.db, status.r2, status.ws, status.crons].map(serviceState);
  if (states.every((state) => state === "ok")) return "Operational";
  if (states.includes("error")) return "Degraded";
  return "Configured · runtime unverified";
}

function sidebarItem(page: Page, label: string): Locator {
  return page.locator(".app-sider").getByRole("button", { name: label, exact: true });
}

function healthLedger(page: Page): Locator {
  return page.getByRole("region", { name: "System Health", exact: true });
}

function healthRow(ledger: Locator, label: string): Locator {
  return ledger.locator(".system-health-ledger__row").filter({ hasText: label });
}

function apiConsole(page: Page): Locator {
  return page.getByRole("region", { name: "API Test Console", exact: true });
}

function debugConsole(page: Page): Locator {
  return page.locator(".api-debug");
}

function category(page: Page, label: string): Locator {
  return page.locator(".api-cat").filter({ has: page.getByRole("button", { name: label, exact: true }) });
}

async function serverStatus(api: APIRequestContext): Promise<StatusData> {
  return await readJson(await api.get("/api/admin/status"), "读取系统状态") as StatusData;
}

async function openOperations(page: Page): Promise<void> {
  await page.goto("/admin?tab=operations");
  await expect(sidebarItem(page, "Operations Overview")).toHaveAttribute("aria-current", "page");
  await expect(healthLedger(page)).toBeVisible();
}

async function openDiagnostics(page: Page): Promise<void> {
  await page.goto("/admin?tab=diagnostics");
  await expect(sidebarItem(page, "Diagnostic Tools")).toHaveAttribute("aria-current", "page");
  await expect(apiConsole(page)).toBeVisible();
}

test("运维总览把服务状态和延迟展示为当前健康账本", async ({ page, api }) => {
  const status = await serverStatus(api);
  await openOperations(page);

  const ledger = healthLedger(page);
  await expect(ledger.locator(".system-health-ledger__row")).toHaveCount(4);
  await expect(healthRow(ledger, SERVICE_LABEL.db)).toContainText(statusLabel(status.db));
  await expect(healthRow(ledger, SERVICE_LABEL.r2)).toContainText(statusLabel(status.r2));
  await expect(healthRow(ledger, SERVICE_LABEL.ws)).toContainText(statusLabel(status.ws));
  await expect(healthRow(ledger, SERVICE_LABEL.crons)).toContainText(statusLabel(status.crons));
  await expect(ledger.locator(".system-health-ledger__overall")).toHaveText(overallLabel(status));
  await expect(ledger.locator(".system-health-ledger__latency")).toHaveText(/^\d+ ms$/);
  await expect(page.getByRole("table", { name: "Scheduled Jobs", exact: true })).toBeVisible();
});

test("运维总览和诊断工具各自只呈现所属工作区", async ({ page }) => {
  await openOperations(page);
  await expect(healthLedger(page)).toBeVisible();
  await expect(apiConsole(page)).toHaveCount(0);

  await openDiagnostics(page);
  await expect(apiConsole(page)).toBeVisible();
  await expect(healthLedger(page)).toHaveCount(0);
  await expect(page.locator(".api-cat").first()).toBeVisible();
});

test("诊断分类用当前展开控件呈现端点数", async ({ page }) => {
  await openDiagnostics(page);

  const system = category(page, "System");
  const toggle = system.getByRole("button", { name: /^System: \d+\/\d+$/ });
  const total = Number.parseInt(await system.locator(".api-cat__metric--total").innerText(), 10);
  expect(total, "System 分类必须至少包含一个端点").toBeGreaterThan(0);

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(system.locator(".api-cat__endpoints .api-ep")).toHaveCount(total);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("运行 System 分类会写入调试日志，清空后同步重置结果", async ({ page }) => {
  await openDiagnostics(page);
  const system = category(page, "System");
  const total = Number.parseInt(await system.locator(".api-cat__metric--total").innerText(), 10);
  expect(total, "System 分类必须至少包含一个端点").toBeGreaterThan(0);

  await system.getByRole("button", { name: "System", exact: true }).click();
  await expect(system.locator(".api-cat__state")).toHaveText("All passed", { timeout: 60_000 });
  await expect(system.locator(".api-cat__metric--pass")).toHaveText(String(total));
  await expect(system.locator(".api-cat__metric--fail")).toHaveText("0");
  await expect(system.locator(".api-cat__progress-fill--pass")).toBeVisible();
  await expect(debugConsole(page).locator(".api-debug__row")).toHaveCount(total + 3);
  await expect(
    debugConsole(page).getByText("Teardown complete — every test row was deleted", { exact: true }),
  ).toBeVisible();

  await debugConsole(page).getByRole("button", { name: "Clear console", exact: true }).click();
  await expect(debugConsole(page).locator(".api-debug__row")).toHaveCount(0);
  await expect(debugConsole(page).getByText("No test results yet. Run a category to see output here.")).toBeVisible();
  await expect(system.locator(".api-cat__metric--pass")).toHaveText("0");
  await expect(system.locator(".api-cat__state")).toHaveText("Not run");
});
