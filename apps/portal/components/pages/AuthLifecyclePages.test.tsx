import { DEFAULT_SITE_OAUTH_SETTINGS } from "@guild/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompletePasswordResetPage } from "./CompletePasswordResetPage";
import { VerifyEmailPage } from "./VerifyEmailPage";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  invalidateQueries: vi.fn(),
  mutate: vi.fn(),
  mutationError: null as Error | null,
  verificationToken: "",
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: mocks.mutate, isPending: false, error: mocks.mutationError }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: {
    to: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => <a href={to} {...props}>{children}</a>,
  useNavigate: () => mocks.navigate,
  useSearch: () => ({}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../stores/site-config", () => ({
  useSiteConfigStore: (selector: (state: {
    siteName: string;
    siteDescription: string;
    siteLogoUrl: null;
    oauth: typeof DEFAULT_SITE_OAUTH_SETTINGS;
  }) => unknown) => selector({
    siteName: "Infini",
    siteDescription: "A guild home.",
    siteLogoUrl: null,
    oauth: DEFAULT_SITE_OAUTH_SETTINGS,
  }),
}));

vi.mock("../../services/AuthService", () => ({
  completePasswordReset: vi.fn(),
  isApiRequestError: (error: unknown) => Boolean(error && typeof error === "object" && "status" in error),
  verifyEmail: vi.fn(),
}));

vi.mock("../../session-transition", () => ({
  authenticateSession: vi.fn(),
}));

vi.mock("../../utils/auth-navigation", () => ({
  clearEmailVerificationToken: vi.fn(),
  readEmailVerificationToken: () => mocks.verificationToken,
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

vi.mock("../shared/VisualThemeArtwork", () => ({
  VisualThemeScene: ({ className }: { className?: string }) => (
    <div data-testid="visual-theme-scene" className={className} aria-hidden="true" />
  ),
}));

function renderPage(page: React.ReactNode) {
  render(page);
}

describe("auth lifecycle page frames", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.invalidateQueries.mockReset();
    mocks.mutate.mockReset();
    mocks.mutationError = null;
    mocks.verificationToken = "";
  });

  it("places password reset inside the branded auth frame without a visitor CTA", () => {
    renderPage(<CompletePasswordResetPage />);

    expect(screen.getByRole("heading", { name: "reset.title" })).toBeInTheDocument();
    expect(screen.getByLabelText("field.loginName")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "reset.submit" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: "button.visitorAccess" })).not.toBeInTheDocument();
    expect(screen.getByTestId("public-site-header")).toHaveAttribute("data-show-navigation", "false");
  });

  it("associates password reset validation errors with their fields", async () => {
    const user = userEvent.setup();
    renderPage(<CompletePasswordResetPage />);

    await user.type(screen.getByLabelText("field.confirmPassword"), "Different!");
    await user.click(screen.getByRole("button", { name: "reset.submit" }));

    await waitFor(() => {
      expect(screen.getByLabelText("field.loginName")).toHaveAttribute(
        "aria-describedby",
        "reset-login-name-error",
      );
      expect(screen.getByLabelText("field.password")).toHaveAttribute(
        "aria-describedby",
        "reset-password-requirements reset-password-error",
      );
      expect(screen.getByLabelText("field.confirmPassword")).toHaveAttribute(
        "aria-describedby",
        "reset-confirm-password-error",
      );
      expect(screen.getByText("validation.loginNameRequired")).toBeInTheDocument();
      expect(screen.queryByText(/Too small|expected string/)).not.toBeInTheDocument();
    });
  });

  it("localizes password reset server validation instead of its raw message", () => {
    mocks.mutationError = Object.assign(new Error("Invalid reset request payload"), {
      status: 400,
      errorCode: "VALIDATION_ERROR",
      details: { fieldErrors: { login_name: ["Too small: expected string to have >=1 characters"] } },
    });
    renderPage(<CompletePasswordResetPage />);

    expect(screen.getByText("validation.loginNameRequired")).toBeInTheDocument();
    expect(screen.queryByText(/Too small|Invalid reset request payload/)).not.toBeInTheDocument();
  });

  it("explains a missing verification token and prevents an invalid submission", () => {
    renderPage(<VerifyEmailPage />);

    expect(screen.getByRole("heading", { name: "verify.title" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("account.verifyEmail.missingToken");
    expect(screen.getByRole("button", { name: "account.verifyEmail.confirm" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "button.visitorAccess" })).not.toBeInTheDocument();
    expect(screen.getByTestId("public-site-header")).toHaveAttribute("data-show-navigation", "false");
  });

  it("localizes email verification failures instead of showing raw server messages", () => {
    mocks.verificationToken = "verification-token";
    mocks.mutationError = new Error("Internal English verification failure");
    renderPage(<VerifyEmailPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("auth:requestFailed");
    expect(screen.queryByText("Internal English verification failure")).not.toBeInTheDocument();
  });

  it("enables email verification when the navigation token exists", () => {
    mocks.verificationToken = "verification-token";
    renderPage(<VerifyEmailPage />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "account.verifyEmail.confirm" })).toBeEnabled();
  });
});
