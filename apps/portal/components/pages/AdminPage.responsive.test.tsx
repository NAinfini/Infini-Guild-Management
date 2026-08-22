import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "./AdminPage";

const responsive = vi.hoisted(() => ({
  width: 1440,
  queries: [] as string[],
}));
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
    classes: false,
    badges: false,
    operations: true,
    diagnostics: true,
  },
  refreshStatus: vi.fn(),
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
  /* 页签徽章上的计数直接读这几个 query，数据没到就如实不显示。 */
  usersQuery: { data: null },
  userRowsRaw: [],
  inviteStatsQuery: { data: null },
  isAdmin: true,
  isModerator: true,
  memberMediaController: {},
  createMemberModalOpen: false,
  createMemberModalHandlers: { close: vi.fn() },
  createMember: vi.fn(),
  createMemberMutation: { isPending: false },
}));

vi.mock("@mantine/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mantine/hooks")>();
  return {
    ...actual,
    useMediaQuery: (query: string) => {
      responsive.queries.push(query);
      return responsive.width < 1280;
    },
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => router.navigate,
  useSearch: () => router.search,
}));

vi.mock("../../hooks/useAdminPageController", () => ({
  useAdminPageController: () => controller,
}));

vi.mock("../layout/PageLayout", () => ({
  PageLayout: ({ children, className }: { children: ReactNode; className?: string }) => (
    <main className={className}>{children}</main>
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

vi.mock("../feature/admin/AdminMemberDetailModal", () => ({
  AdminMemberDetailModal: () => null,
}));

vi.mock("../feature/admin/CreateMemberModal", () => ({
  CreateMemberModal: () => null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function renderPage() {
  return render(
    <MantineProvider>
      <AdminPage />
    </MantineProvider>,
  );
}

describe("AdminPage responsive and permission states", () => {
  beforeEach(() => {
    responsive.width = 1440;
    responsive.queries.length = 0;
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
      classes: false,
      badges: false,
      operations: true,
      diagnostics: true,
    });
  });

  it.each([768, 1024])(
    "keeps one horizontal tablist at %ipx",
    (width) => {
      responsive.width = width;
      renderPage();

      expect(screen.getByRole("tablist")).toHaveAttribute("aria-orientation", "horizontal");
      expect(screen.getByRole("tab", { name: /tab\.operations/ })).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "navigation.section" })).not.toBeInTheDocument();
      expect(responsive.queries).toContain("(max-width: 79.99em)");
    },
  );

  it("keeps the tab panel from becoming a second vertical scroll container", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/pages/AdminPage.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const panelRule = css.match(/\.admin-page__panel\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(panelRule).toContain("overflow-x: clip");
    expect(panelRule).toContain("overflow-y: visible");
    expect(panelRule).not.toMatch(/overflow-y:\s*(auto|scroll|hidden)/);
  });

  it("leaves the navigation rail without a divider on its trailing edge", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/pages/AdminPage.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    // 分隔线画在 Mantine 的 ::before 里，border 是写死的 1px；元素自身的 border-*
    // 覆盖不到伪元素，能撤掉它的只有 content。
    expect(css).toMatch(/\.admin-page__domain-nav::before\s*\{[^}]*content:\s*none/);
    expect(css.match(/\.admin-page__domain-nav\s*\{([^}]*)\}/)?.[1]).not.toMatch(/border/);

    // 横排那一档的下划线是这里显式声明的，不能被上面那条一起撤掉。
    const compactRule = css.match(
      /\.admin-page__workspace--compact\s+\.admin-page__domain-nav\s*\{([^}]*)\}/,
    )?.[1];
    expect(compactRule).toMatch(/border-block-end:\s*1px solid var\(--border-subtle\)/);
  });

  it("shows the shared classes and categories workspace when its permission gate allows it", async () => {
    Object.assign(controller.tabAccess, { operations: false, diagnostics: false, classes: true });
    router.search = { tab: "classes" };

    renderPage();

    expect(screen.getByRole("tab", { name: /tab\.classes/ })).toBeInTheDocument();
    expect(await screen.findByText("classes-and-categories-panel")).toBeInTheDocument();
  });

  it("keeps the efficient vertical tab navigation at 1440px", () => {
    renderPage();

    expect(screen.getByRole("tablist")).toHaveAttribute("aria-orientation", "vertical");
    expect(screen.getByRole("tab", { name: /tab\.operations/ })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "navigation.section" })).not.toBeInTheDocument();
  });

  it("treats descriptive healthy runtime signals as healthy instead of failed", () => {
    controller.statusQuery.data = {
      db: "ok",
      r2: "ok",
      ws: "ok (Durable Object)",
      crons: "configured (Cron Triggers)",
    };

    renderPage();

    expect(screen.getByRole("img", { name: "header.health.configured" }))
      .toHaveClass("admin-page__nav-dot--configured");
  });

  it("shows a permission explanation and dashboard path when no tab is available", () => {
    Object.assign(controller.tabAccess, {
      member: false,
      invite: false,
      audit: false,
      roles: false,
      siteConfig: false,
      classes: false,
      badges: false,
      operations: false,
      diagnostics: false,
    });
    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("noAccessibleTabs.title");
    expect(screen.getByText("noAccessibleTabs.description")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "noAccessibleTabs.back" }));
    expect(router.navigate).toHaveBeenCalledWith({ to: "/" });
  });
});
