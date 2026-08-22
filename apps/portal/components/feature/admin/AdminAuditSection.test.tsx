import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAuditSection } from "./AdminAuditSection";

const { auditViewerSpy } = vi.hoisted(() => ({ auditViewerSpy: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "audit.entityType.event") return "Event";
      if (key === "audit.filter.entityTimeline") return `Timeline: ${String(options?.entity ?? "")}`;
      if (key === "audit.filter.unknownEntity") return "Unknown entity";
      return key;
    },
  }),
}));

vi.mock("./AuditLogViewer", () => ({
  AuditLogViewer: (props: unknown) => {
    auditViewerSpy(props);
    return <div>audit rows</div>;
  },
}));
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

type SectionProps = ComponentProps<typeof AdminAuditSection>;

function renderSection(overrides: Partial<SectionProps> = {}) {
  const props: SectionProps = {
    auditSearch: "",
    onAuditSearchChange: vi.fn(),
    auditDateFrom: "",
    auditDateTo: "",
    onAuditDateFromChange: vi.fn(),
    onAuditDateToChange: vi.fn(),
    onSetDatePreset: vi.fn(),
    onDownloadFilteredCsv: vi.fn(),
    onDownloadFilteredJson: vi.fn(),
    exportAuditLogPending: false,
    auditLoading: false,
    auditError: false,
    onRetryAudit: vi.fn(),
    onRetryArchiveMonths: vi.fn(),
    auditRows: [],
    auditHasMore: false,
    auditLoadingMore: false,
    onAuditLoadMore: vi.fn(),
    auditEntityType: "",
    auditEntityId: "",
    onSelectAuditEntity: vi.fn(),
    onClearAuditEntity: vi.fn(),
    rolesData: [],
    archiveMonths: [],
    archiveMonthsLoading: false,
    archiveMonthsError: false,
    ...overrides,
  };
  render(
    <MantineProvider>
      <AdminAuditSection {...props} />
    </MantineProvider>,
  );
  return props;
}

/* 不借实现里的 date-fns 复述算法，自己按本地时区拼一份 yyyy-MM-dd。 */
function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() - offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

describe("AdminAuditSection filters", () => {
  beforeEach(() => {
    auditViewerSpy.mockClear();
    window.ResizeObserver = WideResizeObserver as unknown as typeof ResizeObserver;
  });

  /* 进页面时区间就是最近七天，工具条得指着「7 天」，不能指着「自定义」还摊开两个空手填框。 */
  it("highlights the default seven-day preset", () => {
    renderSection({ auditDateFrom: isoDate(7), auditDateTo: isoDate(0) });

    expect(screen.getByRole("radio", { name: "audit.last7Days" })).toBeChecked();
    expect(screen.queryByLabelText("audit.aria.dateFrom")).not.toBeInTheDocument();
  });

  /* 认不出来的区间（手填的、翻过页的旧区间）才落到自定义，并把手填框摊开。 */
  it("falls back to custom and opens the manual inputs for a hand-picked range", () => {
    renderSection({ auditDateFrom: "2026-01-01", auditDateTo: "2026-03-05" });

    expect(screen.getByRole("radio", { name: "audit.range.custom" })).toBeChecked();
    expect(screen.getByLabelText("audit.aria.dateFrom")).toHaveValue("2026-01-01");
  });

  it("asks the hook for a range instead of computing dates itself", async () => {
    const user = userEvent.setup();
    const onSetDatePreset = vi.fn();
    renderSection({ auditDateFrom: isoDate(1), auditDateTo: isoDate(0), onSetDatePreset });

    await user.click(screen.getByRole("radio", { name: "audit.last7Days" }));

    expect(onSetDatePreset).toHaveBeenCalledWith("7d");
  });

  it("keeps export visible and does not repeat the selected date range as an active filter", async () => {
    const user = userEvent.setup();
    const { onAuditSearchChange, onAuditDateFromChange, onAuditDateToChange } = renderSection({
      auditSearch: "member",
      auditDateFrom: "2026-08-01T00:00",
      auditDateTo: "2026-08-04T23:59",
    });

    expect(screen.getByRole("button", { name: "audit.export" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "audit.aria.search" })).toHaveValue("member");

    expect(screen.queryByRole("button", { name: "common:filter.clearAll" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "audit.filter.searchChip" }));
    expect(screen.queryByRole("button", { name: "audit.filter.dateRange" })).not.toBeInTheDocument();

    expect(onAuditSearchChange).toHaveBeenCalledWith("");
    expect(onAuditDateFromChange).not.toHaveBeenCalled();
    expect(onAuditDateToChange).not.toHaveBeenCalled();
  });

  it("shows an exact entity timeline as a removable filter", async () => {
    const user = userEvent.setup();
    const onClearAuditEntity = vi.fn();
    const entityId = "fcd3254e-6e59-46b9-bf99-6d9fb4e10660";
    renderSection({
      auditEntityType: "event",
      auditEntityId: entityId,
      auditRows: [{
        event_id: "event-1",
        request_id: "request-1",
        actor: { kind: "user", id: "admin-1", label: "GuildAdmin" },
        subject: { type: "event", id: entityId, label: "Summer Raid" },
        action: "update",
        payload: { schema_version: 2, changes: [], context: [] },
        occurred_at: "2026-08-14T12:00:00.000-04:00",
      }],
      onClearAuditEntity,
    });

    const chip = screen.getByRole("button", { name: "Timeline: Summer Raid" });
    expect(chip).not.toHaveTextContent(entityId);
    expect(chip).not.toHaveTextContent("event/");
    await user.click(chip);
    expect(onClearAuditEntity).toHaveBeenCalledOnce();
  });

  it("passes dynamic role data into the audit value resolver", () => {
    const rolesData: SectionProps["rolesData"] = [{
      id: "raid-lead",
      name: "Raid Lead",
      level: 200,
      color: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      permissions: {} as SectionProps["rolesData"][number]["permissions"],
      assigned_user_count: 0,
    }];
    renderSection({ rolesData });

    expect(auditViewerSpy).toHaveBeenCalledWith(expect.objectContaining({ rolesData }));
  });
});
