import { SectionHeader } from "../../shared/SectionHeader";
import { Button, Paper, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { SaveIcon, LogOutIcon } from "@portal/components/icons";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { notifyError } from "../../../utils/notifications";

const USERNAME_PATTERN = /^[a-zA-Z0-9_一-鿿]+$/;
const LOGOUT_BUTTON_VARS = {
  "--button-bg": "var(--status-danger)",
  "--button-hover": "color-mix(in srgb, var(--status-danger) 88%, var(--surface-base))",
  "--button-color": "var(--status-on-fill)",
} as CSSProperties;

type ProfileAccountTabProps = {
  /* 四项都可能还没到（会话数据是异步的）。没到就不渲染那一行，而不是填一个
     占位符——「加入于 Invalid Date」比少一行更糟。 */
  username: string | null;
  role: string | null;
  joinedAt: string | null;
  profileUpdatedAt: string | null;
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
  username,
  role,
  joinedAt,
  profileUpdatedAt,
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
  const { t, i18n } = useTranslation("profile");
  const changePasswordLabel = t("button.changePassword");
  const changeUsernameLabel = t("button.changeUsername");
  const isPasswordInvalid =
    !currentPassword.trim()
    || newPassword.length < 8
    || newPassword !== confirmNewPassword;

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

  /* 只到日；这四行是「我这个号是什么」，不是审计时间线，精确到分秒没人要读。 */
  const formatDay = (value: string | null) =>
    value ? new Date(value).toLocaleDateString(i18n.language) : null;
  const facts = [
    { key: "username", label: t("account.field.username"), value: username },
    { key: "role", label: t("overview.role"), value: role },
    { key: "joined", label: t("overview.joined"), value: formatDay(joinedAt) },
    { key: "updated", label: t("overview.updated"), value: formatDay(profileUpdatedAt) },
  ].filter((fact): fact is { key: string; label: string; value: string } => Boolean(fact.value));

  return (
    <div className="profile-account">
      <div className="profile-account__cards">
          {/* 这一屏此前只有两张表单卡，而「我现在是谁、什么角色、什么时候加入的」
              这几件事全站只在名册弹窗里露过一半。它们不是可改项，所以是一张只读卡，
              和两张表单卡并排——三张一行，正好把这一屏铺满。 */}
          {facts.length > 0 ? (
            <Paper withBorder radius="md" p="var(--card-padding)">
              <SectionHeader title={t("account.section.facts")} headingLevel={2} />
              <dl className="profile-account__facts">
                {facts.map((fact) => (
                  <div className="profile-account__fact" key={fact.key}>
                    <dt className="profile-account__fact-label">{fact.label}</dt>
                    <dd className="profile-account__fact-value">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </Paper>
          ) : null}

          <Paper withBorder radius="md" p="var(--card-padding)" className="profile-account__card">
            <form onSubmit={(event) => { event.preventDefault(); handleChangePassword(); }}>
            <SectionHeader title={changePasswordLabel} headingLevel={2} />
            {/* 三个框此前只有 placeholder，一开始输入就没有任何提示说明当前
                填的是哪一个。改密码场景下这不是审美问题。 */}
            <Stack gap="var(--space-md)">
              <PasswordInput
                id="profile-current-password"
                name="profile-current-password"
                size="sm"
                label={t("account.field.currentPassword")}
                value={currentPassword}
                onChange={(event) => onCurrentPasswordChange(event.currentTarget.value)}
                autoComplete="current-password"
              />
              <PasswordInput
                id="profile-new-password"
                name="profile-new-password"
                size="sm"
                label={t("account.field.newPassword")}
                value={newPassword}
                onChange={(event) => onNewPasswordChange(event.currentTarget.value)}
                autoComplete="new-password"
              />
              <PasswordInput
                id="profile-confirm-new-password"
                name="profile-confirm-new-password"
                size="sm"
                label={t("account.field.confirmNewPassword")}
                value={confirmNewPassword}
                onChange={(event) => onConfirmNewPasswordChange(event.currentTarget.value)}
                autoComplete="new-password"
              />
              <Button
                type="submit"
                size="sm"
                loading={changePasswordPending}
                disabled={isPasswordInvalid}
                leftSection={<SaveIcon size={14} />}
              >
                {changePasswordLabel}
              </Button>
            </Stack>
            </form>
          </Paper>

          <Paper withBorder radius="md" p="var(--card-padding)" className="profile-account__card">
              <SectionHeader title={changeUsernameLabel} headingLevel={2} />
              <Stack gap="var(--space-md)">
              <PasswordInput
                id="profile-username-current-password"
                name="profile-username-current-password"
                size="sm"
                label={t("account.field.currentPassword")}
                value={currentPasswordForUsername}
                onChange={(event) => onCurrentPasswordForUsernameChange(event.currentTarget.value)}
                autoComplete="current-password"
              />
              <TextInput
                id="profile-new-username"
                name="profile-new-username"
                size="sm"
                label={t("account.field.newUsername")}
                value={newUsername}
                onChange={(event) => onNewUsernameChange(event.currentTarget.value)}
                error={usernameError}
              />
                <Button
                  size="sm"
                  onClick={handleChangeUsername}
                  loading={changeUsernamePending}
                  disabled={isUsernameInvalid}
                  leftSection={<SaveIcon size={14} />}
                >
                  {changeUsernameLabel}
                </Button>
              </Stack>
          </Paper>
      </div>

      {/* 登出原先是最后一张卡下面一个孤零零的红按钮，和上面两张「填完点保存」
          的卡长得一模一样，但它一点就走。分成独立一条，左边说清楚它是什么。 */}
      <div className="profile-account__exit">
        <div>
          <Text size="sm" fw={600}>{t("account.exit.title")}</Text>
          <Text size="xs" c="dimmed">{t("account.exit.description")}</Text>
        </div>
        <Button
          size="sm"
          variant="default"
          style={LOGOUT_BUTTON_VARS}
          onClick={onLogout}
          leftSection={<LogOutIcon size={14} />}
        >
          {t("action.logout")}
        </Button>
      </div>
    </div>
  );
}
