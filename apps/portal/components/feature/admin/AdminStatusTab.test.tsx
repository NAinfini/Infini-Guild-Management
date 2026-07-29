// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
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
  canCopyConfigSummary?: boolean;
  statusLatencyMs?: number | null;
  statusLoading?: boolean;
  statusError?: boolean;
  statusData?: {
    db: string;
    r2: string;
    ws: string;
    crons: string;
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
  render(
    <MantineProvider>
      <AdminStatusTab
        onCopyConfigSummary={vi.fn()}
        canCopyConfigSummary={options.canCopyConfigSummary ?? true}
        statusLatencyMs={options.statusLatencyMs ?? 12}
        statusLoading={options.statusLoading ?? false}
        statusError={options.statusError ?? false}
        statusData={options.statusData ?? { db: "ok", r2: "ok", ws: "ok", crons: "ok" }}
        statusHealthLogs={options.statusHealthLogs ?? []}
      />
    </MantineProvider>,
  );
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

  it("does not hide the API test console behind the Vite dev flag", () => {
    const source = readFileSync(resolve(process.cwd(), "apps/portal/components/feature/admin/AdminStatusTab.tsx"), "utf8");

    expect(source).not.toContain("import.meta.env.DEV");
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

  it("renders the API test console for authorized admins in production builds", () => {
    renderStatusTab();

    expect(screen.getByText("status.section.apiTests")).toBeInTheDocument();
    expect(screen.getByText("status.api.debugTitle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "status.api.runAll" })).toHaveClass(
      "api-console__run-all",
    );
  });

  it("renders healthy service tiles, latency, empty health logs, and endpoint count", () => {
    renderStatusTab();

    expect(screen.getByText("status.section.health")).toBeInTheDocument();
    expect(screen.getByText("D1")).toBeInTheDocument();
    expect(screen.getByText("R2")).toBeInTheDocument();
    expect(screen.getByText("WS")).toBeInTheDocument();
    expect(screen.getByText("Crons")).toBeInTheDocument();
    expect(screen.getAllByText("OK")).toHaveLength(4);
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("status.operational")).toBeInTheDocument();
    expect(screen.getByText("status.healthLogs.empty")).toBeInTheDocument();
    expect(screen.getByText(/\d+ endpoints/)).toBeInTheDocument();
  });

  it("renders degraded system health and populated health logs", () => {
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
    expect(screen.getAllByText("ERROR")).toHaveLength(2);
    expect(screen.getByText("DEGRADED")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "audit.table.time" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "DB" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "R2" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "WS" })).toBeInTheDocument();
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
    expect(screen.queryByText("D1")).not.toBeInTheDocument();
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
