import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_SITE_OAUTH_SETTINGS } from "@guild/shared";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@portal/api/client";
import { queryKeys } from "@portal/api/query-keys";
import enProfile from "@portal/i18n/en/profile.json";
import zhProfile from "@portal/i18n/zh/profile.json";
import { createInstance } from "i18next";
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
const translationMocks = vi.hoisted(() => ({ t: (key: string) => key }));

vi.mock("../../../services/AuthService", () => ({
  ...authApi,
  isApiRequestError: (error: unknown) => error instanceof ApiRequestError,
}));
vi.mock("../../../utils/notifications", () => notificationMocks);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translationMocks.t, i18n: { language: "en" } }),
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

async function submitPasswordChange() {
  const user = userEvent.setup();
  const t = translationMocks.t;
  await screen.findByDisplayValue("member-login");
  await user.type(screen.getByLabelText(t("account.field.newPassword")), "New-password");
  await user.type(screen.getByLabelText(t("account.field.confirmNewPassword")), "New-password");
  await user.click(screen.getByRole("button", { name: t("button.changePassword") }));
  await user.type(await screen.findByLabelText(t("account.field.currentPassword")), "current-password");
  await user.click(screen.getByRole("button", { name: t("account.confirm.submit") }));
}

describe("ProfileAccountTab", () => {
  beforeEach(() => {
    translationMocks.t = (key: string) => key;
    useSiteConfigStore.setState({ oauth: { ...DEFAULT_SITE_OAUTH_SETTINGS } });
    authApi.getAccountSecurity.mockReset().mockResolvedValue(accountSecurity);
    authApi.changePassword.mockReset().mockResolvedValue({ ok: true });
    authApi.changeLoginName.mockReset().mockResolvedValue({ ok: true });
    authApi.resendEmailVerification.mockReset().mockResolvedValue({ ok: true });
    notificationMocks.notifyError.mockReset();
    notificationMocks.notifySuccess.mockReset();
  });

  it("announces loading before account security is available", () => {
    authApi.getAccountSecurity.mockImplementation(() => new Promise(() => undefined));
    renderAccount();

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
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

  it("accepts a formerly blocked password when length, composition, and confirmation match", async () => {
    const user = userEvent.setup();
    renderAccount();
    await screen.findByDisplayValue("member-login");
    const password = screen.getByLabelText("account.field.newPassword");
    const confirmation = screen.getByLabelText("account.field.confirmNewPassword");
    await user.type(password, "Password1!");
    await user.type(confirmation, "Password1!");
    expect(password).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByRole("button", { name: "button.changePassword" })).toBeEnabled();
  });

  it.each([
    ["en", "Could not verify your identity. Check your current password. If it is correct, sign in again and retry."],
    ["zh", "无法验证身份，请检查当前密码。若密码正确，请重新登录后再试。"],
  ])("localizes current-password rejections in %s", async (language, expected) => {
    const i18n = createInstance();
    await i18n.init({
      lng: language,
      resources: { en: { profile: enProfile }, zh: { profile: zhProfile } },
      defaultNS: "profile",
      keySeparator: false,
    });
    translationMocks.t = (key: string) => i18n.t(key);
    authApi.changePassword.mockRejectedValue(new ApiRequestError("Current password is incorrect", {
      status: 401,
      errorCode: "UNAUTHORIZED",
    }));
    renderAccount();
    await submitPasswordChange();

    await waitFor(() => expect(notificationMocks.notifyError).toHaveBeenCalledWith(expected));
    expect(notificationMocks.notifyError).not.toHaveBeenCalledWith("Current password is incorrect");
  });

  it.each([
    [400, "account.message.invalidInput"],
    [403, "common:errors.forbidden"],
    [429, "account.message.rateLimited"],
    [503, "common:errors.serviceUnavailable"],
    [500, "message.passwordChangeFailed"],
  ])("maps a credential error status %i without exposing server text", async (status, expectedKey) => {
    authApi.changePassword.mockRejectedValue(new ApiRequestError("Untranslated server detail", { status }));
    renderAccount();
    await submitPasswordChange();

    await waitFor(() => expect(notificationMocks.notifyError).toHaveBeenCalledWith(expectedKey));
    expect(notificationMocks.notifyError).not.toHaveBeenCalledWith("Untranslated server detail");
  });

  it("uses localized feedback for errors without an API status", async () => {
    authApi.changePassword.mockRejectedValue(new Error("Untranslated client detail"));
    renderAccount();
    await submitPasswordChange();

    await waitFor(() => expect(notificationMocks.notifyError).toHaveBeenCalledWith("message.passwordChangeFailed"));
  });

  it("explains a taken login name in localized feedback", async () => {
    authApi.changeLoginName.mockRejectedValue(new ApiRequestError("Login name already taken", {
      status: 409,
      errorCode: "CONFLICT",
    }));
    const user = userEvent.setup();
    renderAccount();
    const loginName = await screen.findByDisplayValue("member-login");
    await user.clear(loginName);
    await user.type(loginName, "MemberLogin2");
    await user.click(screen.getByRole("button", { name: "account.action.changeLoginName" }));
    await user.type(await screen.findByLabelText("account.field.currentPassword"), "current-password");
    await user.click(screen.getByRole("button", { name: "account.confirm.submit" }));

    await waitFor(() => expect(notificationMocks.notifyError).toHaveBeenCalledWith("account.message.loginNameTaken"));
  });

  it("explains why an email verification cannot be resent in localized feedback", async () => {
    authApi.getAccountSecurity.mockResolvedValue({ ...accountSecurity, email_available: true });
    authApi.resendEmailVerification.mockRejectedValue(new ApiRequestError("No email verification can be resent yet", {
      status: 409,
      errorCode: "CONFLICT",
    }));
    const user = userEvent.setup();
    renderAccount();
    await user.click(await screen.findByRole("button", { name: "account.action.resendEmail" }));
    await user.type(await screen.findByLabelText("account.field.currentPassword"), "current-password");
    await user.click(screen.getByRole("button", { name: "account.confirm.submit" }));

    await waitFor(() => expect(notificationMocks.notifyError).toHaveBeenCalledWith("account.message.emailResendUnavailable"));
  });
});
