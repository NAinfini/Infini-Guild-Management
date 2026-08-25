import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdminContextNavigationProvider,
  useAdminContextNavigation,
} from "../layout/AdminContextNavigation";
import { AdminPage } from "./AdminPage";

const router = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: {} as { tab?: string },
}));
const controller = vi.hoisted(() => ({
  canAccessAdmin: true,
  tabAccess: {
    member: false,
    invite: false,
    audit: false,
    roles: false,
    siteConfig: false,
    importantNotices: false,
    classes: false,
    badges: false,
    operations: true,
    diagnostics: true,
  },
  statusLatencyMs: null,
  statusQuery: {
    data: null as null | { db: string; r2: string; ws: string; crons: string },
    isLoading: false,
    isFetching: false,
    isError: false,
  },
  operationsQuery: { data: null, isLoading: false, isFetching: false, isError: false },
  statusHealthLogs: [],
  selectedMemberDetail: null,
  memberDetailForm: {},
  closeMemberDetail: vi.fn(),
  patchMemberDetailForm: vi.fn(),
  saveSelectedMemberProfile: vi.fn(),
  updateMemberProfileMutation: { isPending: false },
  rolesQuery: { data: [] },
  usersQuery: { data: null },
  userRowsRaw: [],
  inviteStatsQuery: { data: null },
  memberMediaController: {},
  createMemberModalOpen: false,
  createMemberModalHandlers: { close: vi.fn() },
  createMember: vi.fn(),
  createMemberMutation: { isPending: false },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => router.navigate,
  useSearch: () => router.search,
}));

vi.mock("../../hooks/useAdminPageController", () => ({
  useAdminPageController: () => ({
    ...controller,
    activeTab: router.search.tab === "diagnostics" ? "diagnostics" : "operations",
  }),
}));

vi.mock("../layout/PageLayout", () => ({
  PageLayout: ({
    children,
    className,
    workspaceMode = "scroll",
  }: {
    children: ReactNode;
    className?: string;
    workspaceMode?: "scroll" | "contained";
  }) => (
    <main className={className} data-workspace-mode={workspaceMode}>{children}</main>
  ),
}));

vi.mock("../feature/admin/AdminOperationsTab", () => ({
  AdminOperationsTab: () => <div>operations-panel</div>,
}));

vi.mock("../feature/admin/AdminDiagnosticsTab", () => ({
  AdminDiagnosticsTab: () => <div>diagnostics-panel</div>,
}));

vi.mock("../feature/admin/AdminClassesPanel", () => ({
  AdminClassesPanel: () => <div>classes-and-categories-panel</div>,
}));

vi.mock("../feature/admin/AdminMemberDetailInspector", () => ({
  AdminMemberDetailInspector: () => null,
}));

vi.mock("../feature/admin/CreateMemberModal", () => ({
  CreateMemberModal: () => null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function NavigationStatusProbe() {
  const { status } = useAdminContextNavigation();
  return <output>{JSON.stringify(status)}</output>;
}

function renderPage() {
  return render(
    <AdminContextNavigationProvider>
      <AdminPage />
      <NavigationStatusProbe />
    </AdminContextNavigationProvider>,
  );
}

describe("AdminPage context navigation", () => {
  beforeEach(() => {
    router.navigate.mockReset();
    router.search = {};
    controller.statusQuery.data = null;
    controller.canAccessAdmin = true;
    Object.assign(controller.tabAccess, {
      member: false,
      invite: false,
      audit: false,
      roles: false,
      siteConfig: false,
      importantNotices: false,
      classes: false,
      badges: false,
      operations: true,
      diagnostics: true,
    });
  });

  it("renders only the panel named by the URL without an internal tablist", async () => {
    router.search = { tab: "diagnostics" };
    renderPage();

    expect(await screen.findByText("diagnostics-panel")).toBeInTheDocument();
    expect(screen.queryByText("operations-panel")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("uses the shared contained workbench for its active console panel", async () => {
    renderPage();

    expect(await screen.findByText("operations-panel")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("data-workspace-mode", "contained");
  });

  it("falls back to the first permitted panel when the URL names an unavailable one", async () => {
    router.search = { tab: "audit" };
    renderPage();

    expect(await screen.findByText("operations-panel")).toBeInTheDocument();
    expect(screen.queryByText("diagnostics-panel")).not.toBeInTheDocument();
  });

  it("keeps the panel from becoming a second vertical scroll container", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/pages/AdminPage.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const panelRule = css.match(/\.admin-page__panel\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(panelRule).toContain("overflow-x: clip");
    expect(panelRule).toContain("overflow-y: visible");
    expect(panelRule).not.toMatch(/overflow-y:\s*(auto|scroll|hidden)/);
  });

  it("moves health state into the shared sidebar context instead of a page tab", async () => {
    controller.statusQuery.data = {
      db: "ok",
      r2: "ok",
      ws: "ok (Durable Object)",
      crons: "configured (Cron Triggers)",
    };
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent('"healthState":"configured"');
    });
  });

  it("removes the obsolete admin tab rail and its horizontal-scroll fallback", () => {
    const source = readFileSync(resolve(process.cwd(), "apps/portal/components/pages/AdminPage.tsx"), "utf8");
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/pages/AdminPage.css"), "utf8");

    expect(source).not.toContain("<Tabs");
    expect(source).not.toContain("Tabs.Panel");
    expect(css).not.toContain("admin-page__workspace");
    expect(css).not.toContain("admin-page__domain-nav");
  });

  it("shows a permission explanation and dashboard path when no admin area is available", () => {
    Object.assign(controller.tabAccess, {
      member: false,
      invite: false,
      audit: false,
      roles: false,
      siteConfig: false,
      importantNotices: false,
      classes: false,
      badges: false,
      operations: false,
      diagnostics: false,
    });
    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("noAccessibleTabs.title");
    expect(screen.getByText("noAccessibleTabs.description")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "noAccessibleTabs.back" }));
    expect(router.navigate).toHaveBeenCalledWith({ to: "/dashboard" });
  });
});
