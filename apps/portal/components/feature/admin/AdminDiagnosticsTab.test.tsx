import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EndpointResult } from "./AdminApiTestEngine";
import { AdminDiagnosticsTab } from "./AdminDiagnosticsTab";

type MockUser = {
  id: string;
  role: string;
  permissions: Record<string, boolean>;
} | null;

const authMock = vi.hoisted(() => ({
  user: {
    id: "admin-1",
    role: "admin",
    permissions: { "admin.status.view": true },
  } as MockUser,
}));

const apiRunnerMock = vi.hoisted(() => ({
  resultMap: new Map<string, EndpointResult>(),
  runningAll: false,
  runningCritical: false,
  selectedSuiteEndpointTotal: 0,
  runCategory: vi.fn(async () => undefined),
  runAllCategories: vi.fn(async () => undefined),
  runCriticalCategories: vi.fn(async () => undefined),
  clearDebug: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (
      key === "status.api.endpointCount" ? `${options?.count ?? 0} endpoints` : key
    ),
  }),
}));

vi.mock("../../../stores/auth", () => ({
  useAuthStore: (selector: (state: { user: unknown }) => unknown) => selector({ user: authMock.user }),
}));

vi.mock("../../../stores/notifications", () => ({
  useNotificationStore: (selector: (state: { setSuppressed: () => void }) => unknown) => (
    selector({ setSuppressed: vi.fn() })
  ),
}));

vi.mock("./useAdminApiTestRunner", () => ({
  useAdminApiTestRunner: () => ({
    debugLogs: [],
    runningSet: new Set<string>(),
    resultMap: apiRunnerMock.resultMap,
    runningAll: apiRunnerMock.runningAll,
    runningCritical: apiRunnerMock.runningCritical,
    selectedSuiteEndpointTotal: apiRunnerMock.selectedSuiteEndpointTotal,
    runCategory: apiRunnerMock.runCategory,
    runAllCategories: apiRunnerMock.runAllCategories,
    runCriticalCategories: apiRunnerMock.runCriticalCategories,
    clearDebug: apiRunnerMock.clearDebug,
    stop: apiRunnerMock.stop,
  }),
}));

function renderDiagnostics() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AdminDiagnosticsTab />
    </QueryClientProvider>,
  );
}

describe("AdminDiagnosticsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRunnerMock.resultMap = new Map();
    apiRunnerMock.runningAll = false;
    apiRunnerMock.runningCritical = false;
    apiRunnerMock.selectedSuiteEndpointTotal = 0;
    authMock.user = {
      id: "admin-1",
      role: "admin",
      permissions: { "admin.status.view": true },
    };
  });

  it("keeps the API test and debug consoles without rendering health content", () => {
    renderDiagnostics();

    expect(screen.getByText("status.section.apiTests")).toBeInTheDocument();
    expect(screen.getByText("status.api.debugTitle")).toBeInTheDocument();
    expect(screen.queryByText("status.section.health")).not.toBeInTheDocument();
    expect(screen.queryByText("status.healthLogs.title")).not.toBeInTheDocument();
  });

  it("runs the critical suite beside the full suite through the shared runner lifecycle", async () => {
    const user = userEvent.setup();
    renderDiagnostics();

    const quick = screen.getByRole("button", { name: "status.quickCheck" });
    const full = screen.getByRole("button", { name: "status.api.runAll" });
    expect(quick.parentElement).toBe(full.parentElement);

    await user.click(quick);
    await user.click(full);

    expect(apiRunnerMock.runCriticalCategories).toHaveBeenCalledOnce();
    expect(apiRunnerMock.runAllCategories).toHaveBeenCalledOnce();
  });

  it("keeps the runner as the diagnostics tab's single test lifecycle", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/admin/AdminDiagnosticsTab.tsx"),
      "utf8",
    );

    expect(source).toContain("useAdminApiTestRunner(visibleApiCategories, user)");
    expect(source).toContain("<AdminDataIntegrityTool />");
  });

  it("hides diagnostics from users without status access", () => {
    authMock.user = { id: "member-1", role: "member", permissions: {} };
    renderDiagnostics();

    expect(screen.getByText("adminOnly")).toBeInTheDocument();
    expect(screen.queryByText("status.section.apiTests")).not.toBeInTheDocument();
  });
});
