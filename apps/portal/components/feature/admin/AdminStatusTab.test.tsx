// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminStatusTab } from "./AdminStatusTab";

type MockUser = {
  id: string;
  role: string;
  permissions: Record<string, boolean>;
} | null;

const authMock = vi.hoisted(() => ({
  user: {
    id: "admin-1",
    role: "admin",
    permissions: {
      "admin.status.view": true,
      "admin.invite.manage": true,
      "admin.badges.manage": true,
    },
  } as MockUser,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === "status.api.endpointCount") return `${options?.count ?? 0} endpoints`;
      return key;
    },
  }),
}));

vi.mock("../../../stores/auth", () => ({
  useAuthStore: (selector: (state: { user: unknown }) => unknown) =>
    selector({ user: authMock.user }),
}));

vi.mock("../../../stores/notifications", () => ({
  useNotificationStore: (selector: (state: { setSuppressed: () => void }) => unknown) =>
    selector({ setSuppressed: vi.fn() }),
}));

type RenderStatusTabOptions = {
  onRunQuickCheck?: () => void;
  canCopyConfigSummary?: boolean;
  statusLatencyMs?: number | null;
  statusLoading?: boolean;
  statusChecking?: boolean;
  statusError?: boolean;
  statusData?: {
    db: string;
    r2: string;
    ws: string;
    crons: string;
    system_tests_enabled?: boolean;
  } | null;
  statusHealthLogs?: Array<{
    at: string;
    db: string;
    r2: string;
    ws: string;
    crons: string;
    latencyMs: number | null;
  }>;
};

function renderStatusTab(options: RenderStatusTabOptions = {}) {
  const onRunQuickCheck = options.onRunQuickCheck ?? vi.fn();
  render(
    <MantineProvider>
      <AdminStatusTab
        onRunQuickCheck={onRunQuickCheck}
        onCopyConfigSummary={vi.fn()}
        canCopyConfigSummary={options.canCopyConfigSummary ?? true}
        statusLatencyMs={options.statusLatencyMs ?? 12}
        statusLoading={options.statusLoading ?? false}
        statusChecking={options.statusChecking ?? false}
        statusError={options.statusError ?? false}
        statusData={"statusData" in options
          ? options.statusData ?? null
          : {
              db: "ok",
              r2: "ok",
              ws: "ok",
              crons: "ok",
              system_tests_enabled: true,
            }}
        statusHealthLogs={options.statusHealthLogs ?? []}
      />
    </MantineProvider>,
  );
  return { onRunQuickCheck };
}

describe("AdminStatusTab", () => {
  beforeEach(() => {
    authMock.user = {
      id: "admin-1",
      role: "admin",
      permissions: {
        "admin.status.view": true,
        "admin.invite.manage": true,
        "admin.badges.manage": true,
      },
    };
  });

  it("uses the server capability instead of the Vite build mode", () => {
    const source = readFileSync(resolve(process.cwd(), "apps/portal/components/feature/admin/AdminStatusTab.tsx"), "utf8");

    expect(source).not.toContain("import.meta.env.DEV");
    expect(source).toContain("system_tests_enabled");
  });

  it("clears stale endpoint results before a single-category run", () => {
    const source = readFileSync(resolve(process.cwd(), "apps/portal/components/feature/admin/useAdminApiTestRunner.ts"), "utf8");
    const runCategoryBlock = source.slice(
      source.indexOf("const runCategory = useCallback"),
      source.indexOf("const runAllCategories = useCallback"),
    );

    expect(runCategoryBlock).toContain("setResultMap(new Map())");
    expect(runCategoryBlock).toContain(
      "contextRef.current = { ...createInitialTestRunContext(), ...serverRun }",
    );
    expect(runCategoryBlock).toContain("finalizeServerRun");
  });

  it("renders the API test console when the server enables it", () => {
    renderStatusTab();

    expect(screen.getByText("status.section.apiTests")).toBeInTheDocument();
    expect(screen.getByText("status.api.debugTitle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "status.api.runAll" })).toHaveClass(
      "api-console__run-all",
    );
  });

  it("replaces the API test console with a clear notice when the server disables it", () => {
    renderStatusTab({
      statusData: {
        db: "ok",
        r2: "ok",
        ws: "configured",
        crons: "configured",
        system_tests_enabled: false,
      },
    });

    expect(screen.getByText("status.api.disabledTitle")).toBeInTheDocument();
    expect(screen.getByText("status.api.disabledDescription")).toBeInTheDocument();
    expect(screen.queryByText("status.section.apiTests")).not.toBeInTheDocument();
    expect(screen.queryByText("status.api.debugTitle")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "status.api.runAll" })).not.toBeInTheDocument();
  });

  it("runs the explicit quick check action", async () => {
    const user = userEvent.setup();
    const onRunQuickCheck = vi.fn();
    renderStatusTab({ onRunQuickCheck });

    await user.click(screen.getByRole("button", { name: "status.quickCheck" }));

    expect(onRunQuickCheck).toHaveBeenCalledOnce();
    expect(screen.getByText("status.quickCheckDescription")).toBeInTheDocument();
  });

  it("keeps the previous result visible while a quick check is in flight", () => {
    renderStatusTab({
      statusChecking: true,
      statusData: {
        db: "ok",
        r2: "ok",
        ws: "configured",
        crons: "configured",
        system_tests_enabled: false,
      },
    });

    expect(screen.getByRole("button", { name: "status.quickCheck" })).toBeDisabled();
    expect(screen.getByText("status.service.db")).toBeInTheDocument();
    expect(screen.getAllByText("status.value.ok")).toHaveLength(2);
    expect(screen.getAllByText("status.value.configured")).toHaveLength(2);
  });

  it("distinguishes verified services from configured-only services", () => {
    renderStatusTab({
      statusData: {
        db: "ok",
        r2: "ok",
        ws: "configured",
        crons: "configured",
        system_tests_enabled: true,
      },
    });

    expect(screen.getByText("status.section.health")).toBeInTheDocument();
    expect(screen.getByText("status.service.db")).toBeInTheDocument();
    expect(screen.getByText("status.service.r2")).toBeInTheDocument();
    expect(screen.getByText("status.service.ws")).toBeInTheDocument();
    expect(screen.getByText("status.service.crons")).toBeInTheDocument();
    expect(screen.getAllByText("status.value.ok")).toHaveLength(2);
    expect(screen.getAllByText("status.value.configured")).toHaveLength(2);
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("status.partiallyVerified")).toBeInTheDocument();
    expect(screen.getByText("status.healthLogs.empty")).toBeInTheDocument();
    expect(screen.getByText(/\d+ endpoints/)).toBeInTheDocument();
  });

  it("shows configured health-log services as warnings with localized labels", async () => {
    const user = userEvent.setup();
    renderStatusTab({
      statusHealthLogs: [{
        at: "2026-06-11T18:00:00.000Z",
        db: "configured",
        r2: "configured",
        ws: "configured",
        crons: "configured",
        latencyMs: 12,
      }],
    });

    await user.click(screen.getByRole("button", { name: /status\.healthLogs\.title/ }));
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("status.value.configured")).toHaveLength(4);
    expect(table.querySelectorAll(".health-log-dot--warn")).toHaveLength(4);
    expect(table.querySelectorAll(".health-log-dot--error")).toHaveLength(0);
  });

  it("keeps the health log, API console and debug console collapsed until asked", async () => {
    const user = userEvent.setup();
    renderStatusTab();

    const disclosures = screen.getAllByRole("button", { expanded: false });
    const labels = disclosures.map((node) => node.textContent);
    expect(labels.some((text) => text?.includes("status.healthLogs.title"))).toBe(true);
    expect(labels.some((text) => text?.includes("status.section.apiTests"))).toBe(true);
    expect(labels.some((text) => text?.includes("status.api.debugTitle"))).toBe(true);

    /* 健康面板不折叠：这一页最常做的事就是扫一眼四个服务，它必须一进来就在。 */
    expect(screen.getByText("status.service.db")).toBeVisible();

    const healthLogs = disclosures.find((node) => node.textContent?.includes("status.healthLogs.title"));
    await user.click(healthLogs!);
    expect(healthLogs).toHaveAttribute("aria-expanded", "true");
  });

  it("renders degraded system health and populated health logs", async () => {
    const user = userEvent.setup();
    renderStatusTab({
      statusLatencyMs: 450,
      statusData: { db: "ok", r2: "error", ws: "degraded", crons: "error" },
      statusHealthLogs: [
        {
          at: "2026-06-11T18:00:00.000Z",
          db: "ok",
          r2: "error",
          ws: "degraded",
          crons: "error",
          latencyMs: 450,
        },
      ],
    });

    expect(screen.getByText("status.degraded")).toBeInTheDocument();
    expect(screen.getAllByText("ERROR")).toHaveLength(4);
    expect(screen.getAllByText("DEGRADED")).toHaveLength(2);

    /* 日志表默认折起（Mantine Collapse 收拢后是 display:none），
       role 查询查不到隐藏节点——先真的展开，再断言表头。 */
    await user.click(screen.getByRole("button", { name: /status\.healthLogs\.title/ }));
    expect(screen.getByRole("columnheader", { name: "audit.table.time" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "status.service.db" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "status.service.r2" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "status.service.ws" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "status.service.crons" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "status.latency" })).toBeInTheDocument();
    expect(screen.getByText("450ms")).toBeInTheDocument();
  });

  it("shows the load error state for failed status queries", () => {
    renderStatusTab({
      statusError: true,
      statusData: null,
    });

    expect(screen.getByText("loadError")).toBeInTheDocument();
    expect(screen.queryByText("status.service.db")).not.toBeInTheDocument();
  });

  it("hides system health and API tests from users without status permission", () => {
    authMock.user = {
      id: "member-1",
      role: "member",
      permissions: {},
    };

    renderStatusTab();

    expect(screen.getByText("adminOnly")).toBeInTheDocument();
    expect(screen.queryByText("status.section.health")).not.toBeInTheDocument();
    expect(screen.queryByText("status.section.apiTests")).not.toBeInTheDocument();
  });
});
