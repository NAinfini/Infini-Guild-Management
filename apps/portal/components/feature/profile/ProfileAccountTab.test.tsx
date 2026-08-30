import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_SITE_OAUTH_SETTINGS } from "@guild/shared";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@portal/api/client";
import { queryKeys } from "@portal/api/query-keys";
import { ProfileAccountTab } from "./ProfileAccountTab";
import { useSiteConfigStore } from "../../../stores/site-config";

const accountSecurity = {
  login_name: "member-login",
  display_name: "Member",
  oauth_providers: [],
  email: null,
  email_available: false,
};

const authApi = vi.hoisted(() => ({
  getAccountSecurity: vi.fn(),
  changePassword: vi.fn(),
  changeLoginName: vi.fn(),
  startOAuth: vi.fn(),
  unlinkOAuth: vi.fn(),
  requestEmailVerification: vi.fn(),
  resendEmailVerification: vi.fn(),
  removeEmail: vi.fn(),
}));
const notificationMocks = vi.hoisted(() => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock("../../../services/AuthService", () => ({
  ...authApi,
  isApiRequestError: (error: unknown) => error instanceof ApiRequestError,
}));
vi.mock("../../../utils/notifications", () => notificationMocks);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

function renderAccountWithClient(onLogout = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ProfileAccountTab
        onLogout={onLogout}
      />
    </QueryClientProvider>,
  );
  return { onLogout, queryClient };
}

function renderAccount(onLogout = vi.fn()) {
  renderAccountWithClient(onLogout);
  return onLogout;
}

describe("ProfileAccountTab", () => {
  beforeEach(() => {
    useSiteConfigStore.setState({ oauth: { ...DEFAULT_SITE_OAUTH_SETTINGS } });
    authApi.getAccountSecurity.mockReset().mockResolvedValue(accountSecurity);
    authApi.changePassword.mockReset().mockResolvedValue({ ok: true });
    notificationMocks.notifyError.mockReset();
    notificationMocks.notifySuccess.mockReset();
  });

  it("shows a loading skeleton before account security is available", () => {
    authApi.getAccountSecurity.mockImplementation(() => new Promise(() => undefined));
    renderAccount();

    expect(screen.getByLabelText("common:message.loading")).toBeInTheDocument();
    expect(screen.queryByText("account.section.oauth")).not.toBeInTheDocument();
  });

  it("shows a retryable error instead of empty security capabilities", async () => {
    authApi.getAccountSecurity
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(accountSecurity);
    const user = userEvent.setup();
    renderAccount();

    expect(await screen.findByText("common:loadError")).toBeInTheDocument();
    expect(screen.queryByText("account.section.oauth")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(await screen.findByDisplayValue("member-login")).toBeInTheDocument();
  });

  it("keeps cached account security visible after a failed refresh", async () => {
    authApi.getAccountSecurity
      .mockResolvedValueOnce(accountSecurity)
      .mockRejectedValueOnce(new Error("refresh unavailable"));
    const { queryClient } = renderAccountWithClient();

    expect(await screen.findByDisplayValue("member-login")).toBeInTheDocument();
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.security() });
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("common:loadError");
    expect(screen.getByDisplayValue("member-login")).toBeInTheDocument();
  });

  it("limits this page to credential changes", async () => {
    renderAccount();

    expect(await screen.findByDisplayValue("member-login")).toBeInTheDocument();
    expect(screen.queryByText("account.section.securityGate")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("account.field.currentPassword")).not.toBeInTheDocument();
    expect(screen.getByText("account.section.login")).toBeInTheDocument();
    expect(screen.getByText("account.section.passwordSecurity")).toBeInTheDocument();
    expect(screen.getByText("account.hint.profileDisplayName")).toBeInTheDocument();
    expect(screen.queryByLabelText("field.displayName")).not.toBeInTheDocument();
    expect(screen.getByText("account.section.oauth")).toBeInTheDocument();
  });

  it("always lists all sign-in providers and disables providers that are not enabled", async () => {
    renderAccount();

    await screen.findByDisplayValue("member-login");
    for (const provider of ["google", "discord", "kook", "wechat"]) {
      expect(screen.getByText(`account.oauth.${provider}`)).toBeInTheDocument();
    }
    const disabledProviders = screen.getAllByRole("button", { name: "account.action.notEnabled" });
    expect(disabledProviders).toHaveLength(4);
    disabledProviders.forEach((button) => expect(button).toBeDisabled());
  });

  it("keeps providers actionable and asks for the password only after an action is chosen", async () => {
    useSiteConfigStore.setState({
      oauth: { ...DEFAULT_SITE_OAUTH_SETTINGS, google: true },
    });
    authApi.getAccountSecurity.mockResolvedValue({
      ...accountSecurity,
      oauth_providers: ["discord"],
    });
    const user = userEvent.setup();
    renderAccount();

    await screen.findByDisplayValue("member-login");
    const connectGoogle = screen.getByRole("button", { name: "account.action.linkOAuth" });
    const disconnectDiscord = screen.getByRole("button", { name: "account.action.unlinkOAuth" });
    expect(connectGoogle).toBeEnabled();
    expect(disconnectDiscord).toBeEnabled();
    expect(screen.getByText("account.oauth.status.available")).toBeInTheDocument();
    expect(screen.getByText("account.oauth.status.linked")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "account.action.notEnabled" })).toHaveLength(2);

    expect(screen.queryByLabelText("account.field.currentPassword")).not.toBeInTheDocument();
    await user.click(connectGoogle);
    expect(await screen.findByRole("dialog", { name: "account.confirm.title" })).toBeInTheDocument();
    expect(await screen.findByLabelText(/account\.field\.currentPassword/)).toBeVisible();
  });

  it("keeps sign-out available from account security", async () => {
    const user = userEvent.setup();
    const onLogout = renderAccount();

    await user.click(await screen.findByRole("button", { name: "action.logout" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("explains the required sign-in after a successful password change", async () => {
    const user = userEvent.setup();
    const onLogout = renderAccount();

    await screen.findByDisplayValue("member-login");
    await user.type(screen.getByLabelText("account.field.newPassword"), "New-password");
    await user.type(screen.getByLabelText("account.field.confirmNewPassword"), "New-password");
    await user.click(screen.getByRole("button", { name: "button.changePassword" }));
    await user.type(await screen.findByLabelText(/account\.field\.currentPassword/), "current-password");
    await user.click(screen.getByRole("button", { name: "account.confirm.submit" }));

    await waitFor(() => expect(onLogout).toHaveBeenCalledWith("expired"));
  });

  it("relies on the global network feedback for a failed credential change", async () => {
    authApi.changePassword.mockRejectedValue(new ApiRequestError("Network unavailable", { status: 0 }));
    const user = userEvent.setup();
    renderAccount();

    await screen.findByDisplayValue("member-login");
    await user.type(screen.getByLabelText("account.field.newPassword"), "New-password");
    await user.type(screen.getByLabelText("account.field.confirmNewPassword"), "New-password");
    await user.click(screen.getByRole("button", { name: "button.changePassword" }));
    await user.type(await screen.findByLabelText(/account\.field\.currentPassword/), "current-password");
    await user.click(screen.getByRole("button", { name: "account.confirm.submit" }));

    await waitFor(() => expect(authApi.changePassword).toHaveBeenCalledOnce());
    expect(notificationMocks.notifyError).not.toHaveBeenCalled();
  });

  it.each(["short12", "a".repeat(129)])("explains the password length rule instead of silently disabling submission (%#)", async (password) => {
    const user = userEvent.setup();
    renderAccount();
    await screen.findByDisplayValue("member-login");
    const nextPassword = screen.getByLabelText("account.field.newPassword");
    await user.type(nextPassword, password);
    await user.type(screen.getByLabelText("account.field.confirmNewPassword"), password);

    expect(nextPassword).toHaveAccessibleDescription(/auth:validation.password.length/);
    expect(nextPassword).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "button.changePassword" })).toBeDisabled();
    expect(authApi.changePassword).not.toHaveBeenCalled();
  });

  it("explains mismatched confirmation and clears the error when passwords match", async () => {
    const user = userEvent.setup();
    renderAccount();
    await screen.findByDisplayValue("member-login");
    await user.type(screen.getByLabelText("account.field.newPassword"), "New-password");
    const confirmation = screen.getByLabelText("account.field.confirmNewPassword");
    await user.type(confirmation, "different-password");

    expect(confirmation).toHaveAccessibleDescription("auth:validation.passwordMismatch");
    expect(confirmation).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "button.changePassword" })).toBeDisabled();

    await user.clear(confirmation);
    await user.type(confirmation, "New-password");
    expect(confirmation).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText("auth:validation.passwordMismatch")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "button.changePassword" })).toBeEnabled();
  });

  it("rejects a common password with an explanation and accepts a non-common eight-character password", async () => {
    const user = userEvent.setup();
    renderAccount();
    await screen.findByDisplayValue("member-login");
    const password = screen.getByLabelText("account.field.newPassword");
    const confirmation = screen.getByLabelText("account.field.confirmNewPassword");
    await user.type(password, "Password1!");
    await user.type(confirmation, "Password1!");
    expect(password).toHaveAccessibleDescription(/auth:validation.password.uncommon/);
    expect(screen.getByRole("button", { name: "button.changePassword" })).toBeDisabled();
    await user.clear(password);
    await user.type(password, "Violet7!");
    await user.clear(confirmation);
    await user.type(confirmation, "Violet7!");
    expect(screen.getByRole("button", { name: "button.changePassword" })).toBeEnabled();
  });

  it("keeps a current-password rejection specific to the account action", async () => {
    authApi.changePassword.mockRejectedValue(new ApiRequestError("Current password is incorrect", { status: 401 }));
    const user = userEvent.setup();
    renderAccount();

    await screen.findByDisplayValue("member-login");
    await user.type(screen.getByLabelText("account.field.newPassword"), "New-password");
    await user.type(screen.getByLabelText("account.field.confirmNewPassword"), "New-password");
    await user.click(screen.getByRole("button", { name: "button.changePassword" }));
    await user.type(await screen.findByLabelText(/account\.field\.currentPassword/), "current-password");
    await user.click(screen.getByRole("button", { name: "account.confirm.submit" }));

    await waitFor(() => expect(notificationMocks.notifyError).toHaveBeenCalledWith("Current password is incorrect"));
  });
});
