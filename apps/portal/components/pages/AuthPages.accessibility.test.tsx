// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  params: { inviteCode: "INVITE-CODE" } as { inviteCode?: string },
  search: {} as { reason?: string; returnTo?: string },
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
    selector: (state: { siteName: string; siteLogoUrl: null }) => unknown,
  ) => selector({ siteName: "Infini", siteLogoUrl: null }),
}));

vi.mock("../../services/AuthService", () => ({
  checkUsername: vi.fn(),
  isApiRequestError: () => false,
  login: vi.fn(),
  register: vi.fn(),
  verifyInvite: vi.fn(),
}));

function renderLogin() {
  render(
    <MantineProvider>
      <LoginPage />
    </MantineProvider>,
  );
}

function renderRegister() {
  render(
    <MantineProvider>
      <RegisterPage />
    </MantineProvider>,
  );
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

    expect(loginSource).not.toMatch(/<Anchor\b[^>]*\bonClick=/);
    expect(registerSource).not.toMatch(/<Anchor\b[^>]*\bonClick=/);
    expect(styles).toMatch(
      /\.login-page__eye-btn\s*\{[^}]*width:\s*var\(--control-hit-area\)[^}]*height:\s*var\(--control-hit-area\)/s,
    );
  });
});
