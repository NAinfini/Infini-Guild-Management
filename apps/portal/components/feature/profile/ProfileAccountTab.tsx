import { SectionHeader } from "../../shared/SectionHeader";
import { Button, Grid, Group, Paper, PasswordInput, Stack, TextInput } from "@mantine/core";
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
  changePasswordPending,
  changeUsernamePending,
}: ProfileAccountTabProps) {
  const { t } = useTranslation("profile");
  const changePasswordLabel = t("button.changePassword");
  const changeUsernameLabel = t("button.changeUsername");

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
          <Paper withBorder radius="md" p="var(--card-padding)">
            <div>
            <form onSubmit={(event) => { event.preventDefault(); handleChangePassword(); }}>
            <SectionHeader title={changePasswordLabel} />
            {/* 三个框此前只有 placeholder，一开始输入就没有任何提示说明当前
                填的是哪一个。改密码场景下这不是审美问题。 */}
            <Stack gap={12}>
              <PasswordInput
                size="sm"
                label={t("account.field.currentPassword")}
                value={currentPassword}
                onChange={(event) => onCurrentPasswordChange(event.currentTarget.value)}
                autoComplete="current-password"
              />
              <PasswordInput
                size="sm"
                label={t("account.field.newPassword")}
                value={newPassword}
                onChange={(event) => onNewPasswordChange(event.currentTarget.value)}
                autoComplete="new-password"
              />
              <PasswordInput
                size="sm"
                label={t("account.field.confirmNewPassword")}
                value={confirmNewPassword}
                onChange={(event) => onConfirmNewPasswordChange(event.currentTarget.value)}
                autoComplete="new-password"
              />
              <Button type="submit" size="sm" loading={changePasswordPending} leftSection={<SaveIcon size={14} />}>{changePasswordLabel}</Button>
            </Stack>
            </form>
            </div>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6 }}>
          <Paper withBorder radius="md" p="var(--card-padding)">
            <div>
              <SectionHeader title={changeUsernameLabel} />
              <Stack gap={12}>
              <PasswordInput
                size="sm"
                label={t("account.field.currentPassword")}
                value={currentPasswordForUsername}
                onChange={(event) => onCurrentPasswordForUsernameChange(event.currentTarget.value)}
                autoComplete="current-password"
              />
              <TextInput
                size="sm"
                label={t("account.field.newUsername")}
                value={newUsername}
                onChange={(event) => onNewUsernameChange(event.currentTarget.value)}
                error={usernameError}
              />
                <Button size="sm" onClick={handleChangeUsername} loading={changeUsernamePending} disabled={isUsernameInvalid} leftSection={<SaveIcon size={14} />}>{changeUsernameLabel}</Button>
              </Stack>
            </div>
          </Paper>
        </Grid.Col>
      </Grid>

      <Group>
        <Button color="orange" size="sm" onClick={onLogout} leftSection={<LogOutIcon size={14} />}>
          {t("action.logout")}
        </Button>
      </Group>
    </Stack>
  );
}
