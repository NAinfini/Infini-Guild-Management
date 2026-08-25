import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_SITE_OAUTH_SETTINGS } from "@guild/shared";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  params: { inviteCode: "INVITE-CODE" } as { inviteCode?: string },
  search: {} as { reason?: string; returnTo?: string; oauth?: "failed" },
  inviteValid: true,
  mutation: { mutate: vi.fn(), isPending: false },
  queryClient: { clear: vi.fn() },
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => mocks.mutation,
  useQueryClient: () => mocks.queryClient,
  useQuery: ({ queryKey }: { queryKey: readonly string[] }) => {
    if (queryKey[1] === "verify-invite") {
      return {
        data: { valid: mocks.inviteValid },
        isLoading: false,
        isFetching: false,
      };
    }
    return {
      data: { available: true },
      isLoading: false,
      isFetching: false,
    };
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => <a href={to} {...props}>{children}</a>,
  useNavigate: () => mocks.navigate,
  useParams: () => mocks.params,
  useSearch: () => mocks.search,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../stores/auth", () => ({
  useAuthStore: (selector: (state: { setSession: () => void }) => unknown) =>
    selector({ setSession: vi.fn() }),
}));

vi.mock("../../stores/site-config", () => ({
  useSiteConfigStore: (
    selector: (state: {
      siteName: string;
      siteDescription: string;
      siteLogoUrl: null;
      oauth: typeof DEFAULT_SITE_OAUTH_SETTINGS;
      features: {
        announcements: boolean;
        events: boolean;
        guildWar: boolean;
        gallery: boolean;
        wiki: boolean;
      };
    }) => unknown,
  ) => selector({
    siteName: "Infini",
    siteDescription: "A guild home.",
    siteLogoUrl: null,
    oauth: DEFAULT_SITE_OAUTH_SETTINGS,
    features: {
      announcements: true,
      events: true,
      guildWar: true,
      gallery: true,
      wiki: true,
    },
  }),
}));

vi.mock("../layout/PublicSiteHeader", () => ({
  PublicSiteHeader: ({
    actions,
    showNavigation,
  }: {
    actions?: React.ReactNode;
    showNavigation?: boolean;
  }) => (
    <header data-testid="public-site-header" data-show-navigation={String(showNavigation)}>
      {actions}
    </header>
  ),
}));

vi.mock("../../services/AuthService", () => ({
  checkUsername: vi.fn(),
  isApiRequestError: () => false,
  login: vi.fn(),
  register: vi.fn(),
  verifyInvite: vi.fn(),
}));

vi.mock("../shared/VisualThemeArtwork", () => ({
  VisualThemeScene: ({ className, variant }: { className?: string; variant?: string }) => (
    <div
      data-testid="visual-theme-scene"
      data-variant={variant}
      className={className}
      aria-hidden="true"
    />
  ),
}));

function renderLogin() {
  render(<LoginPage />);
}

function renderRegister() {
  render(<RegisterPage />);
}

describe("Auth page semantics", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.mutation.mutate.mockReset();
    mocks.queryClient.clear.mockReset();
    mocks.params = { inviteCode: "INVITE-CODE" };
    mocks.search = {};
    mocks.inviteValid = true;
  });

  it("makes the login password control keyboard reachable and stateful", async () => {
    const user = userEvent.setup();
    renderLogin();

    const toggle = screen.getByRole("button", { name: "aria.showPassword" });
    expect(toggle).not.toHaveAttribute("tabindex", "-1");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    toggle.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "aria.hidePassword" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("field.password")).toHaveAttribute("type", "text");

    expect(screen.getByRole("link", { name: "button.backToPortal" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "button.registerHere" })).toHaveAttribute(
      "href",
      "/register",
    );
  });

  it("uses one full-screen decorative scene and compact header across login and registration", () => {
    const { unmount } = render(<LoginPage />);
    expect(screen.getByTestId("visual-theme-scene")).toHaveClass("login-page__scene");
    expect(screen.getByTestId("visual-theme-scene")).toHaveAttribute("data-variant", "access");
    expect(screen.getByTestId("visual-theme-scene")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("public-site-header")).toHaveAttribute("data-show-navigation", "false");
    expect(screen.getByRole("link", { name: "button.visitorAccess" })).toHaveAttribute("href", "/dashboard");
    unmount();

    renderRegister();
    expect(screen.getByTestId("visual-theme-scene")).toHaveClass("login-page__scene");
    expect(screen.getByTestId("visual-theme-scene")).toHaveAttribute("data-variant", "access");
    expect(screen.getByTestId("visual-theme-scene")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("public-site-header")).toHaveAttribute("data-show-navigation", "false");
    expect(screen.getByRole("link", { name: "button.visitorAccess" })).toHaveAttribute("href", "/dashboard");
  });

  it("shows and announces a localized Caps Lock warning without sharing the eye control", () => {
    renderLogin();

    const password = screen.getByLabelText("field.password");
    const capsLockEvent = createEvent.keyDown(password, { key: "A" });
    Object.defineProperty(capsLockEvent, "getModifierState", {
      value: (modifier: string) => modifier === "CapsLock",
    });
    fireEvent(password, capsLockEvent);

    const warning = screen.getByRole("status");
    const toggle = screen.getByRole("button", { name: "aria.showPassword" });
    const passwordControl = password.closest(".login-page__password-control");
    expect(warning).toHaveTextContent("capsLockWarning");
    expect(warning).toHaveClass("login-page__caps-warning");
    expect(passwordControl).not.toBeNull();
    expect(toggle.closest(".login-page__password-actions")?.parentElement).toBe(passwordControl);
    expect(warning.parentElement).toBe(passwordControl?.parentElement);
    expect(warning.previousElementSibling).toBe(passwordControl);
    expect(warning.querySelector(".login-page__caps-icon")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(toggle).toBeInTheDocument();
  });

  it("gives both registration password controls accurate names and pressed state", async () => {
    const user = userEvent.setup();
    renderRegister();

    const passwordToggle = screen.getByRole("button", { name: "aria.showPassword" });
    const confirmToggle = screen.getByRole("button", { name: "aria.showConfirmPassword" });
    expect(passwordToggle).not.toHaveAttribute("tabindex", "-1");
    expect(confirmToggle).not.toHaveAttribute("tabindex", "-1");
    expect(passwordToggle).toHaveAttribute("aria-pressed", "false");
    expect(confirmToggle).toHaveAttribute("aria-pressed", "false");

    await user.click(confirmToggle);
    expect(
      screen.getByRole("button", { name: "aria.hideConfirmPassword" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("field.confirmPassword")).toHaveAttribute("type", "text");
    expect(screen.getByRole("link", { name: "button.backToLogin" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("keeps typed invite retry behavior on a semantic button", async () => {
    const user = userEvent.setup();
    mocks.params = {};
    mocks.inviteValid = false;
    renderRegister();

    fireEvent.change(screen.getByLabelText("field.inviteCode"), {
      target: { value: "BAD-CODE" },
    });
    await user.click(screen.getByRole("button", { name: "button.continue" }));

    const retry = screen.getByRole("button", { name: "button.retryInviteCode" });
    await user.click(retry);
    expect(screen.getByLabelText("field.inviteCode")).toBeInTheDocument();
  });

  it("uses real links or semantic buttons and a 44px password target", () => {
    const loginSource = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/LoginPage.tsx"),
      "utf8",
    );
    const registerSource = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/RegisterPage.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/AuthPages.css"),
      "utf8",
    );
    const frameSource = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/AuthPageFrame.tsx"),
      "utf8",
    );
    const resetSource = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/CompletePasswordResetPage.tsx"),
      "utf8",
    );
    const verifySource = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/VerifyEmailPage.tsx"),
      "utf8",
    );
    const designContract = readFileSync(resolve(process.cwd(), "DESIGN.md"), "utf8");

    expect(loginSource).not.toMatch(/<Anchor\b[^>]*\bonClick=/);
    expect(registerSource).not.toMatch(/<Anchor\b[^>]*\bonClick=/);
    expect(styles).toMatch(
      /\.login-page__eye-btn\s*\{[^}]*width:\s*var\(--control-hit-area\)[^}]*height:\s*var\(--control-hit-area\)/s,
    );
    expect(loginSource).toContain('className="login-page__eye-btn"');
    expect(registerSource.match(/className="login-page__eye-btn"/g)).toHaveLength(2);
    expect(styles).toMatch(
      /\.login-page__eye-btn::before\s*\{[^}]*width:\s*var\(--control-icon-size-regular\)[^}]*height:\s*var\(--control-icon-size-regular\)/s,
    );
    expect(styles).toMatch(
      /\.login-page__eye-btn:hover\s*\{[^}]*background:\s*transparent/s,
    );
    expect(styles).toMatch(
      /\.login-page__eye-btn:hover::before\s*\{[^}]*background:\s*var\(--surface-sunken\)/s,
    );
    expect(frameSource).toContain("showNavigation={false}");
    expect(frameSource).toContain('className="login-page__scene"');
    expect(frameSource.match(/<VisualThemeScene/g) ?? []).toHaveLength(1);
    expect(frameSource).not.toContain("formEyebrow");
    expect(frameSource).not.toContain("story-eyebrow");
    expect(frameSource).not.toContain("siteDescription");
    expect(frameSource).not.toContain("showCharacter");
    expect(frameSource).not.toContain("siteLogoUrl");
    expect(frameSource).toContain("ACTIVE_VISUAL_THEME.mark.src");
    expect(designContract).toContain("Looping background motion exists in exactly two places");
    expect(styles).toMatch(
      /\.login-page__scene\s*\{[^}]*pointer-events:\s*none/s,
    );
    expect(styles).not.toContain("login-page__story-art");
    expect(styles).not.toContain("login-page__story-list");
    expect(styles).not.toContain("lightfall");
    expect(styles).toMatch(
      /\.login-page__stage\s*\{[^}]*min-height:\s*100dvh[^}]*14vw[^}]*place-items:\s*center end/s,
    );
    expect(styles).toMatch(
      /\.login-page__card-brand\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*center[^}]*align-items:\s*center/s,
    );
    expect(styles).toMatch(
      /\.login-page__card-brand\s*\{[^}]*margin-bottom:\s*var\(--space-sm\)/s,
    );
    expect(styles).not.toMatch(/\.login-page__card-brand\s*\{[^}]*flex-direction:\s*column/s);
    const deprecatedUiName = ["man", "tine"].join("");
    for (const source of [loginSource, registerSource, resetSource, verifySource, frameSource, styles]) {
      expect(source.toLowerCase()).not.toContain(deprecatedUiName);
      expect(source).not.toContain("useDisclosure");
    }
  });
});
