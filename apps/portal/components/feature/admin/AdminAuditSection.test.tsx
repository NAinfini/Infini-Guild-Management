// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAuditSection } from "./AdminAuditSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../stores/auth", () => ({
  useAuthStore: (selector: (state: { user: { role: string } }) => unknown) =>
    selector({ user: { role: "admin" } }),
}));

vi.mock("../../../utils/permissions", () => ({
  canManageRoles: () => true,
  canViewStatus: () => true,
}));

vi.mock("./AuditLogViewer", () => ({ AuditLogViewer: () => <div>audit rows</div> }));
vi.mock("./AuditArchiveExplorer", () => ({ AuditArchiveExplorer: () => <div>archives</div> }));

class WideResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  disconnect() {}
  unobserve() {}
  observe() {
    this.callback(
      [{ contentRect: { width: 1200 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

describe("AdminAuditSection filters", () => {
  beforeEach(() => {
    window.ResizeObserver = WideResizeObserver as unknown as typeof ResizeObserver;
  });

  it("keeps export visible and lets filters be dismissed individually", async () => {
    const user = userEvent.setup();
    const onAuditSearchChange = vi.fn();
    const onAuditDateFromChange = vi.fn();
    const onAuditDateToChange = vi.fn();

    render(
      <MantineProvider>
        <AdminAuditSection
          auditSearch="member"
          onAuditSearchChange={onAuditSearchChange}
          auditDateFrom="2026-08-01T00:00"
          auditDateTo="2026-08-04T23:59"
          onAuditDateFromChange={onAuditDateFromChange}
          onAuditDateToChange={onAuditDateToChange}
          onSetDatePreset={vi.fn()}
          onDownloadFilteredCsv={vi.fn()}
          onDownloadFilteredJson={vi.fn()}
          exportAuditLogPending={false}
          auditLoading={false}
          auditError={false}
          auditRows={[]}
          auditPageCurrent={1}
          auditPageSize={25}
          auditTotal={0}
          onAuditPageChange={vi.fn()}
          rolesData={[]}
          archiveMonths={[]}
          archiveMonthsLoading={false}
          archiveMonthsError={false}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole("button", { name: "audit.export" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "audit.aria.search" })).toHaveValue("member");

    expect(screen.queryByRole("button", { name: "common:filter.clearAll" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "audit.filter.searchChip" }));
    await user.click(screen.getByRole("button", { name: "audit.filter.dateRange" }));

    expect(onAuditSearchChange).toHaveBeenCalledWith("");
    expect(onAuditDateFromChange).toHaveBeenCalledWith("");
    expect(onAuditDateToChange).toHaveBeenCalledWith("");
  });
});
