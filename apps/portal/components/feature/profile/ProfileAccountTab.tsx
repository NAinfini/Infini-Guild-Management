import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { MotionButton } from "@infini-dev-kit/frontend/components";
import { Button, Group, PasswordInput, Stack, Switch, Text, TextInput } from "@mantine/core";
import { useTranslation } from "react-i18next";

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
}: ProfileAccountTabProps) {
  const { t } = useTranslation("profile");
  return (
    <Stack gap={16}>
      <InfiniCard interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Stack gap={8}>
            <Text fw={600}>{changePasswordLabel}</Text>
            <PasswordInput
              value={currentPassword}
              onChange={(event) => onCurrentPasswordChange(event.currentTarget.value)}
              placeholder={t("account.field.currentPassword")}
              aria-label="Current password"
            />
            <PasswordInput
              value={newPassword}
              onChange={(event) => onNewPasswordChange(event.currentTarget.value)}
              placeholder={t("account.field.newPassword")}
              aria-label="New password"
            />
            <PasswordInput
              value={confirmNewPassword}
              onChange={(event) => onConfirmNewPasswordChange(event.currentTarget.value)}
              placeholder={t("account.field.confirmNewPassword")}
              aria-label="Confirm new password"
            />
            <Button onClick={onChangePassword}>{changePasswordLabel}</Button>
          </Stack>
        </div>
      </InfiniCard>

      <InfiniCard interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Stack gap={8}>
            <Text fw={600}>{changeUsernameLabel}</Text>
            <PasswordInput
              value={currentPasswordForUsername}
              onChange={(event) => onCurrentPasswordForUsernameChange(event.currentTarget.value)}
              placeholder={t("account.field.currentPassword")}
              aria-label="Current password for username change"
            />
            <TextInput
              value={newUsername}
              onChange={(event) => onNewUsernameChange(event.currentTarget.value)}
              placeholder={t("account.field.newUsername")}
              aria-label="New username"
            />
            <Button onClick={onChangeUsername}>{changeUsernameLabel}</Button>
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
              aria-label="Discord verification code"
            />
            <Group gap={8} wrap="wrap">
              <MotionButton
                type="primary"
                onClick={onVerifyDiscordLink}
                loading={isDiscordLinking}
                disabled={discordCode.trim().length !== 6}
              >
                {t("account.discord.link")}
              </MotionButton>
              <Button color="infini-danger" onClick={onUnlinkDiscord} disabled={!discordId}>
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
                  aria-label="Discord reminders toggle"
                />
                <Button size="xs" onClick={onSaveDiscordPreference}>
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

