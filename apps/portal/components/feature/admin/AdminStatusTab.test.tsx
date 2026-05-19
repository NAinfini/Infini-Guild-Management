// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AdminStatusTab } from "./AdminStatusTab";

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
    selector({
      user: {
        id: "admin-1",
        role: "admin",
        permissions: {
          "admin.status.view": true,
          "admin.invite.manage": true,
          "admin.badges.manage": true,
        },
      },
    }),
}));

vi.mock("../../../stores/notifications", () => ({
  useNotificationStore: (selector: (state: { setSuppressed: () => void }) => unknown) =>
    selector({ setSuppressed: vi.fn() }),
}));

function renderStatusTab() {
  render(
    <MantineProvider>
      <AdminStatusTab
        onCopyConfigSummary={vi.fn()}
        canCopyConfigSummary
        statusLatencyMs={12}
        statusLoading={false}
        statusError={false}
        statusData={{ db: "ok", r2: "ok", ws: "ok", crons: "ok" }}
        statusHealthLogs={[]}
      />
    </MantineProvider>,
  );
}

describe("AdminStatusTab", () => {
  it("does not hide the API test console behind the Vite dev flag", () => {
    const source = readFileSync(resolve(process.cwd(), "apps/portal/components/feature/admin/AdminStatusTab.tsx"), "utf8");

    expect(source).not.toContain("import.meta.env.DEV");
  });

  it("renders the API test console for authorized admins in production builds", () => {
    renderStatusTab();

    expect(screen.getByText("status.section.apiTests")).toBeInTheDocument();
    expect(screen.getByText("status.api.debugTitle")).toBeInTheDocument();
  });
});
