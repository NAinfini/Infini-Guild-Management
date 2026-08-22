import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileAccountTab } from "./ProfileAccountTab";
import { notifyError } from "../../../utils/notifications";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    /* 账号事实那张卡要按当前语言格式化日期，所以这个 mock 得带上 i18n。 */
    i18n: { language: "en" },
  }),
}));

vi.mock("../../../utils/notifications", () => ({
  notifyError: vi.fn(),
}));

const baseProps = {
  username: "tester",
  role: "member",
  joinedAt: "2024-01-02T00:00:00.000Z",
  profileUpdatedAt: "2024-03-04T00:00:00.000Z",
  currentPassword: "",
  newPassword: "",
  confirmNewPassword: "",
  currentPasswordForUsername: "",
  newUsername: "",
  onCurrentPasswordChange: vi.fn(),
  onNewPasswordChange: vi.fn(),
  onConfirmNewPasswordChange: vi.fn(),
  onCurrentPasswordForUsernameChange: vi.fn(),
  onNewUsernameChange: vi.fn(),
  onChangePassword: vi.fn(),
  onChangeUsername: vi.fn(),
  onLogout: vi.fn(),
  changePasswordPending: false,
  changeUsernamePending: false,
};

function renderAccount(overrides: Partial<typeof baseProps> = {}) {
  return render(
    <MantineProvider>
      <ProfileAccountTab {...baseProps} {...overrides} />
    </MantineProvider>,
  );
}

describe("ProfileAccountTab password validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only enables password submission for a complete matching password change", async () => {
    const user = userEvent.setup();
    const onChangePassword = vi.fn();
    const { rerender } = renderAccount({ onChangePassword });
    const passwordButton = () =>
      screen.getByRole("button", { name: "button.changePassword" });

    expect(passwordButton()).toBeDisabled();

    rerender(
      <MantineProvider>
        <ProfileAccountTab
          {...baseProps}
          currentPassword="current"
          newPassword="1234567"
          confirmNewPassword="1234567"
          onChangePassword={onChangePassword}
        />
      </MantineProvider>,
    );
    expect(passwordButton()).toBeDisabled();

    rerender(
      <MantineProvider>
        <ProfileAccountTab
          {...baseProps}
          currentPassword="current"
          newPassword="12345678"
          confirmNewPassword="different"
          onChangePassword={onChangePassword}
        />
      </MantineProvider>,
    );
    expect(passwordButton()).toBeDisabled();

    rerender(
      <MantineProvider>
        <ProfileAccountTab
          {...baseProps}
          currentPassword="current"
          newPassword="12345678"
          confirmNewPassword="12345678"
          onChangePassword={onChangePassword}
        />
      </MantineProvider>,
    );
    expect(passwordButton()).toBeEnabled();

    await user.click(passwordButton());
    expect(onChangePassword).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing validation copy for non-button form submission", () => {
    const { rerender } = renderAccount();
    const passwordForm = screen
      .getByRole("button", { name: "button.changePassword" })
      .closest("form");

    expect(passwordForm).not.toBeNull();
    fireEvent.submit(passwordForm!);
    expect(notifyError).toHaveBeenLastCalledWith(
      "account.validation.currentPasswordRequired",
    );

    rerender(
      <MantineProvider>
        <ProfileAccountTab
          {...baseProps}
          currentPassword="current"
          newPassword="1234567"
          confirmNewPassword="1234567"
        />
      </MantineProvider>,
    );
    fireEvent.submit(passwordForm!);
    expect(notifyError).toHaveBeenLastCalledWith(
      "account.validation.passwordMinLength",
    );

    rerender(
      <MantineProvider>
        <ProfileAccountTab
          {...baseProps}
          currentPassword="current"
          newPassword="12345678"
          confirmNewPassword="different"
        />
      </MantineProvider>,
    );
    fireEvent.submit(passwordForm!);
    expect(notifyError).toHaveBeenLastCalledWith(
      "account.validation.passwordMismatch",
    );
  });

  it("provides stable autofill fields, sequential headings, and a semantic danger logout", () => {
    renderAccount();

    expect(screen.getByLabelText("account.field.currentPassword", { selector: "#profile-current-password" }))
      .toHaveAttribute("name", "profile-current-password");
    expect(screen.getByLabelText("account.field.newPassword"))
      .toHaveAttribute("name", "profile-new-password");
    expect(screen.getByLabelText("account.field.confirmNewPassword"))
      .toHaveAttribute("name", "profile-confirm-new-password");
    expect(screen.getAllByLabelText("account.field.currentPassword")[1])
      .toHaveAttribute("name", "profile-username-current-password");
    expect(screen.getByLabelText("account.field.newUsername"))
      .toHaveAttribute("name", "profile-new-username");

    expect(screen.getByRole("heading", { level: 2, name: "button.changePassword" }))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "button.changeUsername" }))
      .toBeInTheDocument();

    const logout = screen.getByRole("button", { name: "action.logout" });
    expect(logout).toHaveStyle({
      "--button-bg": "var(--status-danger)",
      "--button-color": "var(--status-on-fill)",
    });
  });
});
