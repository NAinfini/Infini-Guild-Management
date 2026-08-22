import { MantineProvider } from "@mantine/core";
import {
  ADMIN_OPERATION_JOB_NAMES,
  type AdminOperationsResponse,
} from "@guild/shared/schemas/admin-operations";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AdminOperationsTab } from "./AdminOperationsTab";

const authMock = vi.hoisted(() => ({
  user: {
    id: "admin-1",
    role: "admin",
    permissions: { "admin.status.view": true },
  } as { id: string; role: string; permissions: Record<string, boolean> } | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../stores/auth", () => ({
  useAuthStore: (selector: (state: { user: unknown }) => unknown) => selector({ user: authMock.user }),
}));

function operationsFixture(connectionCount: number | null = 7): AdminOperationsResponse {
  return {
    observed_at: "2026-08-12T15:30:00.000Z",
    scheduled_jobs: ADMIN_OPERATION_JOB_NAMES.map((name, index) => ({
      name,
      schedule: name === "audit-archive" ? "daily" : "quarter-hourly",
      status: index === 0 ? "completed" : index === 1 ? "interrupted" : "never-run",
      started_at: index === 0 ? "2026-08-12T15:29:00.000Z" : null,
      finished_at: index === 0 ? "2026-08-12T15:29:02.000Z" : null,
      duration_ms: index === 0 ? 2_000 : null,
      processed: index === 0 ? 4 : null,
      batches: index === 0 ? 1 : null,
      has_more: index === 0 ? false : null,
      backlog: index === 0
        ? { count_precision: "exact", pending_count: 0, oldest_pending_at: null, reason: null, detail: null }
        : null,
      error_summary: null,
      lease: { state: "none" as const },
    })),
    realtime: connectionCount === null
      ? {
          state: "unavailable",
          runtime_source: "cloudflare-notifications-do",
          observed_at: "2026-08-12T15:30:00.000Z",
          connection_count: null,
        }
      : {
          state: "available",
          runtime_source: "cloudflare-notifications-do",
          observed_at: "2026-08-12T15:30:00.000Z",
          connection_count: connectionCount,
        },
    managed_data_usage: {
      media: {
        asset_count: 12,
        variant_count: 21,
        logical_bytes: 2_097_152,
        by_state: [
          { state: "uploading", asset_count: 1, variant_count: 1, logical_bytes: 100 },
          { state: "staged", asset_count: 1, variant_count: 2, logical_bytes: 200 },
          { state: "attached", asset_count: 9, variant_count: 17, logical_bytes: 2_096_000 },
          { state: "deleting", asset_count: 1, variant_count: 1, logical_bytes: 852 },
        ],
      },
      audit: { log_count: 53, archive_count: 2, archive_bytes: 2_048 },
    },
  };
}

function renderOperations(options: {
  operationsData?: AdminOperationsResponse | null;
  operationsLoading?: boolean;
  operationsError?: boolean;
} = {}) {
  render(
    <MantineProvider>
      <AdminOperationsTab
        statusLatencyMs={12}
        statusLoading={false}
        statusError={false}
        onRetryStatus={vi.fn()}
        onRetryOperations={vi.fn()}
        statusData={{ db: "ok", r2: "ok", ws: "ok", crons: "configured" }}
        statusHealthLogs={[
          {
            at: "2026-08-12T15:30:00.000Z",
            db: "ok",
            r2: "ok",
            ws: "ok",
            crons: "configured",
            latencyMs: 12,
          },
        ]}
        operationsData={"operationsData" in options ? options.operationsData ?? null : operationsFixture()}
        operationsLoading={options.operationsLoading ?? false}
        operationsError={options.operationsError ?? false}
      />
    </MantineProvider>,
  );
}

describe("AdminOperationsTab", () => {
  it("presents health, all configured jobs, realtime, managed usage, and bounded health history", () => {
    renderOperations();

    expect(screen.getByText("operations.health.title")).toBeInTheDocument();
    expect(screen.getAllByText("status.service.db")).toHaveLength(2);
    expect(screen.getByRole("table", { name: "operations.jobs.title" }).querySelectorAll("tbody tr")).toHaveLength(8);
    expect(screen.getByText("operations.jobs.name.recurrence-materialization")).toBeInTheDocument();
    expect(screen.getByText("operations.jobs.status.interrupted")).toBeInTheDocument();
    expect(screen.getAllByText("operations.schedule.daily")).toHaveLength(1);
    expect(screen.getByText("operations.realtime.title")).toBeInTheDocument();
    expect(screen.getByText("operations.realtime.state.available")).toBeInTheDocument();
    expect(screen.getByText("operations.usage.managedDisclosure")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "operations.usage.mediaByState" }).querySelectorAll("tbody tr")).toHaveLength(4);
    expect(screen.getByRole("table", { name: "status.healthLogs.title" }).querySelectorAll("tbody tr")).toHaveLength(1);
  });

  it("labels an unavailable exact realtime connection count instead of substituting zero", () => {
    renderOperations({ operationsData: operationsFixture(null) });

    expect(screen.getByText("operations.realtime.state.unavailable")).toBeInTheDocument();
    expect(screen.getAllByText("operations.value.unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("preserves the operation layout while data is loading or unavailable", () => {
    renderOperations({ operationsData: null, operationsLoading: true });

    expect(screen.getByText("operations.jobs.title")).toBeInTheDocument();
    expect(screen.getByText("operations.realtime.title")).toBeInTheDocument();
    expect(screen.getByText("operations.usage.title")).toBeInTheDocument();
  });

  it("keeps backup and restore outside the operations surface", () => {
    const componentSource = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/admin/AdminOperationsTab.tsx"),
      "utf8",
    );

    expect(componentSource).not.toMatch(/backup|restore/i);
  });

  it("requires status-view access", () => {
    authMock.user = { id: "member-1", role: "member", permissions: {} };
    renderOperations();

    expect(screen.getByText("adminOnly")).toBeInTheDocument();
    expect(screen.queryByText("operations.health.title")).not.toBeInTheDocument();
    authMock.user = {
      id: "admin-1",
      role: "admin",
      permissions: { "admin.status.view": true },
    };
  });
});
