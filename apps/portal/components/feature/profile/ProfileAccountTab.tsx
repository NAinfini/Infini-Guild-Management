import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { MotionButton } from "@infini-dev-kit/frontend/components";
import { Badge, Button, Group, PasswordInput, Stack, Switch, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDeviceFloppy, IconUserMinus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

const DISCORD_CODE_PATTERN = /^[a-zA-Z0-9]+$/;

type ProfileAccountTabProps = {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
  currentPasswordForUsername: string;
  newUsername: string;
  discordCode: string;
  isDiscordLinking: boolean;
  discordId: string | null;
  discordReminderOptOut: boolean;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onConfirmNewPasswordChange: (value: string) => void;
  onCurrentPasswordForUsernameChange: (value: string) => void;
  onNewUsernameChange: (value: string) => void;
  onDiscordCodeChange: (value: string) => void;
  onToggleDiscordReminder: (checked: boolean) => void;
  onChangePassword: () => void;
  onChangeUsername: () => void;
  onVerifyDiscordLink: () => void;
  onUnlinkDiscord: () => void;
  onSaveDiscordPreference: () => void;
  onLogout: () => void;
  changePasswordLabel: string;
  changeUsernameLabel: string;
  changePasswordPending: boolean;
  changeUsernamePending: boolean;
  saveDiscordPreferencePending: boolean;
  isDirty: boolean;
};

export function ProfileAccountTab({
  currentPassword,
  newPassword,
  confirmNewPassword,
  currentPasswordForUsername,
  newUsername,
  discordCode,
  isDiscordLinking,
  discordId,
  discordReminderOptOut,
  onCurrentPasswordChange,
  onNewPasswordChange,
  onConfirmNewPasswordChange,
  onCurrentPasswordForUsernameChange,
  onNewUsernameChange,
  onDiscordCodeChange,
  onToggleDiscordReminder,
  onChangePassword,
  onChangeUsername,
  onVerifyDiscordLink,
  onUnlinkDiscord,
  onSaveDiscordPreference,
  onLogout,
  changePasswordLabel,
  changeUsernameLabel,
  changePasswordPending,
  changeUsernamePending,
  saveDiscordPreferencePending,
  isDirty,
}: ProfileAccountTabProps) {
  const { t } = useTranslation("profile");

  const handleChangePassword = () => {
    if (!currentPassword.trim()) {
      notifications.show({ color: "infini-danger", message: t("account.validation.currentPasswordRequired") });
      return;
    }
    if (newPassword.length < 8) {
      notifications.show({ color: "infini-danger", message: t("account.validation.passwordMinLength") });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      notifications.show({ color: "infini-danger", message: t("account.validation.passwordMismatch") });
      return;
    }
    onChangePassword();
  };

  const handleVerifyDiscordLink = () => {
    const trimmed = discordCode.trim();
    if (trimmed.length !== 6 || !DISCORD_CODE_PATTERN.test(trimmed)) {
      notifications.show({ color: "infini-danger", message: t("account.validation.discordCodeFormat") });
      return;
    }
    onVerifyDiscordLink();
  };

  return (
    <Stack gap={16}>
      <InfiniCard interactive={false}>
        <form onSubmit={(event) => { event.preventDefault(); handleChangePassword(); }}>
        <div style={{ padding: "1.2rem" }}>
          <Stack gap={8}>
            <Text fw={600}>{changePasswordLabel}</Text>
            <PasswordInput
              value={currentPassword}
              onChange={(event) => onCurrentPasswordChange(event.currentTarget.value)}
              placeholder={t("account.field.currentPassword")}
              autoComplete="current-password"
              aria-label={t("account.aria.currentPassword")}
            />
            <PasswordInput
              value={newPassword}
              onChange={(event) => onNewPasswordChange(event.currentTarget.value)}
              placeholder={t("account.field.newPassword")}
              autoComplete="new-password"
              aria-label={t("account.aria.newPassword")}
            />
            <PasswordInput
              value={confirmNewPassword}
              onChange={(event) => onConfirmNewPasswordChange(event.currentTarget.value)}
              placeholder={t("account.field.confirmNewPassword")}
              autoComplete="new-password"
              aria-label={t("account.aria.confirmNewPassword")}
            />
            <Button type="submit" loading={changePasswordPending} leftSection={<IconDeviceFloppy size={16} />}>{changePasswordLabel}</Button>
          </Stack>
        </div>
        </form>
      </InfiniCard>

      <InfiniCard interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Stack gap={8}>
            <Text fw={600}>{changeUsernameLabel}</Text>
            <PasswordInput
              value={currentPasswordForUsername}
              onChange={(event) => onCurrentPasswordForUsernameChange(event.currentTarget.value)}
              placeholder={t("account.field.currentPassword")}
              aria-label={t("account.aria.currentPasswordUsername")}
            />
            <TextInput
              value={newUsername}
              onChange={(event) => onNewUsernameChange(event.currentTarget.value)}
              placeholder={t("account.field.newUsername")}
              aria-label={t("account.aria.newUsername")}
            />
            <Button onClick={onChangeUsername} loading={changeUsernamePending} leftSection={<IconDeviceFloppy size={16} />}>{changeUsernameLabel}</Button>
          </Stack>
        </div>
      </InfiniCard>

      <InfiniCard interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Stack gap={8}>
            <Text fw={600}>{t("account.discord.title")}</Text>
            <Text c="dimmed" size="sm">
              {t("account.discord.hint")}
            </Text>
            <TextInput
              value={discordCode}
              onChange={(event) => onDiscordCodeChange(event.currentTarget.value)}
              placeholder={t("account.discord.codePlaceholder")}
              maxLength={6}
              aria-label={t("account.aria.discordCode")}
            />
            <Group gap={8} wrap="wrap">
              <MotionButton
                type="primary"
                onClick={handleVerifyDiscordLink}
                loading={isDiscordLinking}
                disabled={discordCode.trim().length !== 6}
              >
                {t("account.discord.link")}
              </MotionButton>
              <Button color="infini-danger" onClick={onUnlinkDiscord} disabled={!discordId} leftSection={<IconUserMinus size={16} />}>
                {t("account.discord.unlink")}
              </Button>
            </Group>
            <Text>
              {t("account.discord.linked")}<strong>{discordId ?? "-"}</strong>
            </Text>
            {discordId ? (
              <Group gap={8} wrap="wrap">
                <Text>{t("account.discord.reminders")}</Text>
                <Switch
                  checked={!discordReminderOptOut}
                  onChange={(event) => onToggleDiscordReminder(event.currentTarget.checked)}
                  aria-label={t("account.aria.discordReminders")}
                />
                <Badge color={isDirty ? "infini-warning" : "infini-success"}>
                  {isDirty ? t("status.unsavedChanges") : t("status.saved")}
                </Badge>
                <Button size="xs" onClick={onSaveDiscordPreference} loading={saveDiscordPreferencePending} leftSection={<IconDeviceFloppy size={16} />}>
                  {t("account.discord.savePreference")}
                </Button>
              </Group>
            ) : null}
          </Stack>
        </div>
      </InfiniCard>

      <Button color="infini-danger" onClick={onLogout}>
        {t("action.logout")}
      </Button>
    </Stack>
  );
}
