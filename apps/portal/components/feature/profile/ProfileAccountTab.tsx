import { PortalCard } from "../../shared/PortalCard";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { Button, Grid, Group, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { SaveIcon, LogOutIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import { notifyError } from "../../../utils/notifications";

const USERNAME_PATTERN = /^[a-zA-Z0-9_一-鿿]+$/;

type ProfileAccountTabProps = {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
  currentPasswordForUsername: string;
  newUsername: string;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onConfirmNewPasswordChange: (value: string) => void;
  onCurrentPasswordForUsernameChange: (value: string) => void;
  onNewUsernameChange: (value: string) => void;
  onChangePassword: () => void;
  onChangeUsername: () => void;
  onLogout: () => void;
  changePasswordLabel: string;
  changeUsernameLabel: string;
  changePasswordPending: boolean;
  changeUsernamePending: boolean;
};

export function ProfileAccountTab({
  currentPassword,
  newPassword,
  confirmNewPassword,
  currentPasswordForUsername,
  newUsername,
  onCurrentPasswordChange,
  onNewPasswordChange,
  onConfirmNewPasswordChange,
  onCurrentPasswordForUsernameChange,
  onNewUsernameChange,
  onChangePassword,
  onChangeUsername,
  onLogout,
  changePasswordLabel,
  changeUsernameLabel,
  changePasswordPending,
  changeUsernamePending,
}: ProfileAccountTabProps) {
  const { t } = useTranslation("profile");

  const handleChangePassword = () => {
    if (!currentPassword.trim()) {
      notifyError(t("account.validation.currentPasswordRequired"));
      return;
    }
    if (newPassword.length < 8) {
      notifyError(t("account.validation.passwordMinLength"));
      return;
    }
    if (newPassword !== confirmNewPassword) {
      notifyError(t("account.validation.passwordMismatch"));
      return;
    }
    onChangePassword();
  };

  const usernameError = (() => {
    const trimmed = newUsername.trim();
    if (!trimmed) return undefined;
    if (trimmed.length < 1) return t("account.validation.usernameMinLength");
    if (trimmed.length > 50) return t("account.validation.usernameMaxLength");
    if (!USERNAME_PATTERN.test(trimmed)) return t("account.validation.usernamePattern");
    return undefined;
  })();
  const isUsernameInvalid = !newUsername.trim() || Boolean(usernameError);

  const handleChangeUsername = () => {
    if (isUsernameInvalid) return;
    onChangeUsername();
  };

  return (
    <Stack gap={16}>
      <Grid gutter={16}>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <PortalCard interactive={false} style={{ height: "100%" }}>
            <form onSubmit={(event) => { event.preventDefault(); handleChangePassword(); }}>
            <Stack gap={10} p="1.2rem">
              <Text fw={600} size="sm">{changePasswordLabel}</Text>
              <PasswordInput
                size="sm"
                value={currentPassword}
                onChange={(event) => onCurrentPasswordChange(event.currentTarget.value)}
                placeholder={t("account.field.currentPassword")}
                autoComplete="current-password"
                aria-label={t("account.aria.currentPassword")}
              />
              <PasswordInput
                size="sm"
                value={newPassword}
                onChange={(event) => onNewPasswordChange(event.currentTarget.value)}
                placeholder={t("account.field.newPassword")}
                autoComplete="new-password"
                aria-label={t("account.aria.newPassword")}
              />
              <PasswordInput
                size="sm"
                value={confirmNewPassword}
                onChange={(event) => onConfirmNewPasswordChange(event.currentTarget.value)}
                placeholder={t("account.field.confirmNewPassword")}
                autoComplete="new-password"
                aria-label={t("account.aria.confirmNewPassword")}
              />
              <Button type="submit" size="sm" loading={changePasswordPending} leftSection={<SaveIcon size={14} />}>{changePasswordLabel}</Button>
            </Stack>
            </form>
          </PortalCard>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6 }}>
          <PortalCard interactive={false} style={{ height: "100%" }}>
            <Stack gap={10} p="1.2rem">
              <Text fw={600} size="sm">{changeUsernameLabel}</Text>
              <PasswordInput
                size="sm"
                value={currentPasswordForUsername}
                onChange={(event) => onCurrentPasswordForUsernameChange(event.currentTarget.value)}
                placeholder={t("account.field.currentPassword")}
                aria-label={t("account.aria.currentPasswordUsername")}
              />
              <TextInput
                size="sm"
                value={newUsername}
                onChange={(event) => onNewUsernameChange(event.currentTarget.value)}
                placeholder={t("account.field.newUsername")}
                aria-label={t("account.aria.newUsername")}
                error={usernameError}
              />
              <Button size="sm" onClick={handleChangeUsername} loading={changeUsernamePending} disabled={isUsernameInvalid} leftSection={<SaveIcon size={14} />}>{changeUsernameLabel}</Button>
            </Stack>
          </PortalCard>
        </Grid.Col>
      </Grid>

      <Group>
        <DepthButton type="danger" size="sm" onClick={onLogout} before={<LogOutIcon size={14} />}>
          {t("action.logout")}
        </DepthButton>
      </Group>
    </Stack>
  );
}
