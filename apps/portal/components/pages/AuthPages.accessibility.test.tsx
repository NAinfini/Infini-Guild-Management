import { DEFAULT_SITE_OAUTH_SETTINGS } from "@guild/shared";
import { act, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  params: { inviteCode: "A1B2C3D4E5" } as { inviteCode?: string },
  search: {} as { reason?: string; returnTo?: string; oauth?: "failed" },
  inviteValid: true,
  verifiedInviteCode: "",
  mutation: { mutate: vi.fn(), isPending: false },
  mutationOptions: [] as Array<{ onError?: (error: unknown) => void }>,
  queryClient: { clear: vi.fn() },
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: { onError?: (error: unknown) => void }) => {
    mocks.mutationOptions.push(options);
    return mocks.mutation;
  },
  useQueryClient: () => mocks.queryClient,
  useQuery: ({ queryKey }: { queryKey: readonly string[] }) => {
    if (queryKey[1] === "verify-invite") {
      mocks.verifiedInviteCode = queryKey[2] ?? "";
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
  isApiRequestError: (error: unknown) => Boolean(
    error && typeof error === "object" && "status" in error,
  ),
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
    mocks.mutationOptions = [];
    mocks.queryClient.clear.mockReset();
    mocks.params = { inviteCode: "A1B2C3D4E5" };
    mocks.search = {};
    mocks.inviteValid = true;
    mocks.verifiedInviteCode = "";
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

  it("shows a localized generic message for login request throttling", () => {
    renderLogin();

    act(() => {
      mocks.mutationOptions[0]?.onError?.({
        status: 429,
        message: "Too many authentication requests; retry in 17 seconds",
        details: { retry_after_seconds: 17 },
      });
    });

    expect(screen.getByRole("alert")).toHaveTextContent("tooManyAttempts");
    expect(screen.getByRole("alert")).not.toHaveTextContent("17");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Too many authentication requests");
  });

  it("shows and announces a localized Caps Lock warning", () => {
    renderLogin();

    const password = screen.getByLabelText("field.password");
    const capsLockEvent = createEvent.keyDown(password, { key: "A" });
    Object.defineProperty(capsLockEvent, "getModifierState", {
      value: (modifier: string) => modifier === "CapsLock",
    });
    fireEvent(password, capsLockEvent);

    const warning = screen.getByRole("status");
    const toggle = screen.getByRole("button", { name: "aria.showPassword" });
    expect(warning).toHaveTextContent("capsLockWarning");
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

  it("explains registration password rules and clears stale errors after the requirements are met", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.type(screen.getByLabelText("field.loginName"), "new_member");
    await user.type(screen.getByLabelText("field.displayName"), "NewMember");
    const password = screen.getByLabelText("field.password");
    const confirmation = screen.getByLabelText("field.confirmPassword");
    await user.type(password, "violet7!");
    await user.type(confirmation, "Different!");
    await user.click(screen.getByRole("button", { name: "button.register" }));
    expect(await screen.findByText("auth:validation.password.uppercase")).toBeInTheDocument();
    expect(screen.getByText("validation.passwordMismatch")).toBeInTheDocument();
    expect(mocks.mutation.mutate).not.toHaveBeenCalled();

    await user.clear(password);
    await user.type(password, "Violets!");
    await user.clear(confirmation);
    await user.type(confirmation, "Violets!");
    expect(password).toHaveAttribute("aria-invalid", "false");
    expect(confirmation).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText("validation.passwordMismatch")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "button.register" }));
    await waitFor(() => expect(mocks.mutation.mutate).toHaveBeenCalledWith({
      login_name: "new_member", display_name: "NewMember", password: "Violets!", confirmPassword: "Violets!",
    }));
  });

  it("localizes empty registration names instead of rendering schema messages", async () => {
    const user = userEvent.setup();
    renderRegister();

    await user.click(screen.getByRole("button", { name: "button.register" }));

    expect(await screen.findByText("validation.loginNameRequired")).toBeInTheDocument();
    expect(screen.getByText("validation.displayNameRequired")).toBeInTheDocument();
    expect(screen.queryByText(/Too small|expected string/)).not.toBeInTheDocument();
    expect(mocks.mutation.mutate).not.toHaveBeenCalled();
  });

  it.each(["login", "register"])("localizes %s server validation without exposing error text", (mode) => {
    if (mode === "login") renderLogin();
    else renderRegister();

    act(() => {
      mocks.mutationOptions[0]?.onError?.({
        status: 400,
        errorCode: "VALIDATION_ERROR",
        message: "Invalid request payload",
        details: { fieldErrors: { login_name: ["Too small: expected string to have >=1 characters"] } },
      });
    });

    expect(screen.getByText("validation.loginNameRequired")).toBeInTheDocument();
    expect(screen.queryByText(/Too small|Invalid request payload/)).not.toBeInTheDocument();
  });

  it("keeps typed invite retry behavior on a semantic button", async () => {
    const user = userEvent.setup();
    mocks.params = {};
    mocks.inviteValid = false;
    renderRegister();

    fireEvent.change(screen.getByLabelText("field.inviteCode"), {
      target: { value: "a1b2c3d4e5" },
    });
    await user.click(screen.getByRole("button", { name: "button.continue" }));

    expect(mocks.verifiedInviteCode).toBe("A1B2C3D4E5");
    const retry = screen.getByRole("button", { name: "button.retryInviteCode" });
    await user.click(retry);
    expect(screen.getByLabelText("field.inviteCode")).toBeInTheDocument();
  });

});
