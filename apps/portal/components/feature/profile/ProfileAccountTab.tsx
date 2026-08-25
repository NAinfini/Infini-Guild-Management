import { identityNameSchema } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { useMutation } from "@tanstack/react-query";
import { LogOutIcon, SaveIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { PasswordInput } from "@portal/components/ui/password-input";
import { Skeleton } from "@portal/components/ui/skeleton";
import { useProfileAccountSecurity } from "@portal/hooks/useProfileAccountSecurity";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  changeLoginName,
  changePassword,
  removeEmail,
  requestEmailVerification,
  resendEmailVerification,
  startOAuth,
  unlinkOAuth,
  type OAuthProvider,
} from "../../../services/AuthService";
import { useSiteConfigStore } from "../../../stores/site-config";
import { notifyError, notifySuccess } from "../../../utils/notifications";
import { SectionHeader } from "../../shared/SectionHeader";

const OAUTH_PROVIDERS: readonly OAuthProvider[] = ["google", "discord", "kook", "wechat"];

type ProfileAccountTabProps = {
  onLogout: (reason?: "expired") => void;
};

type SensitiveAction =
  | { kind: "login-name" }
  | { kind: "password" }
  | { kind: "link-oauth"; provider: OAuthProvider }
  | { kind: "unlink-oauth"; provider: OAuthProvider }
  | { kind: "request-email" }
  | { kind: "resend-email" }
  | { kind: "remove-email" };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function validIdentityName(value: string): boolean {
  return identityNameSchema.safeParse(value).success;
}

export function ProfileAccountTab({ onLogout }: ProfileAccountTabProps) {
  const { t } = useTranslation(["profile", "common"]);
  const oauthEnabled = useSiteConfigStore((state) => state.oauth);
  const { securityQuery, invalidateSecurity } = useProfileAccountSecurity();
  const [currentPassword, setCurrentPassword] = useState("");
  const [loginName, setLoginName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [email, setEmail] = useState("");
  const [pendingAction, setPendingAction] = useState<SensitiveAction | null>(null);

  useEffect(() => {
    if (!securityQuery.data) return;
    setLoginName(securityQuery.data.login_name);
  }, [securityQuery.data]);

  const credentialChanged = (reason?: "expired") => {
    setCurrentPassword("");
    setPendingAction(null);
    onLogout(reason);
  };
  const finishSensitiveAction = () => {
    setCurrentPassword("");
    setPendingAction(null);
  };
  const changePasswordMutation = useMutation({
    mutationFn: () => changePassword({ currentPassword, newPassword, confirmNewPassword }),
    onSuccess: () => {
      notifySuccess(t("message.passwordChanged"));
      credentialChanged("expired");
    },
    onError: (error) => notifyError(errorMessage(error, t("message.passwordChangeFailed"))),
  });
  const changeLoginNameMutation = useMutation({
    mutationFn: () => changeLoginName({ currentPassword, login_name: loginName.trim() }),
    onSuccess: () => {
      notifySuccess(t("account.message.loginNameChanged"));
      credentialChanged();
    },
    onError: (error) => notifyError(errorMessage(error, t("account.message.loginNameChangeFailed"))),
  });
  const linkOAuthMutation = useMutation({
    mutationFn: (provider: OAuthProvider) => startOAuth(provider, currentPassword),
    onSuccess: ({ authorization_url }) => window.location.assign(authorization_url),
    onError: (error) => notifyError(errorMessage(error, t("account.message.oauthFailed"))),
  });
  const unlinkOAuthMutation = useMutation({
    mutationFn: (provider: OAuthProvider) => unlinkOAuth(provider, currentPassword),
    onSuccess: () => {
      finishSensitiveAction();
      void invalidateSecurity();
      notifySuccess(t("account.message.oauthUnlinked"));
    },
    onError: (error) => notifyError(errorMessage(error, t("account.message.oauthFailed"))),
  });
  const requestEmailMutation = useMutation({
    mutationFn: () => requestEmailVerification({ current_password: currentPassword, email }),
    onSuccess: () => {
      finishSensitiveAction();
      notifySuccess(t("account.message.emailSent"));
    },
    onError: (error) => notifyError(errorMessage(error, t("account.message.emailFailed"))),
  });
  const resendEmailMutation = useMutation({
    mutationFn: () => resendEmailVerification({ current_password: currentPassword }),
    onSuccess: () => {
      finishSensitiveAction();
      notifySuccess(t("account.message.emailSent"));
    },
    onError: (error) => notifyError(errorMessage(error, t("account.message.emailFailed"))),
  });
  const removeEmailMutation = useMutation({
    mutationFn: () => removeEmail(currentPassword),
    onSuccess: () => {
      finishSensitiveAction();
      void invalidateSecurity();
      notifySuccess(t("account.message.emailRemoved"));
    },
    onError: (error) => notifyError(errorMessage(error, t("account.message.emailFailed"))),
  });

  const canChangePassword = newPassword.length >= LIMITS.content.password.min
    && newPassword === confirmNewPassword;
  const linkedProviders = new Set(securityQuery.data?.oauth_providers ?? []);
  const loginNameChanged = loginName.trim() !== (securityQuery.data?.login_name ?? "");
  const confirmationPending = changePasswordMutation.isPending
    || changeLoginNameMutation.isPending
    || linkOAuthMutation.isPending
    || unlinkOAuthMutation.isPending
    || requestEmailMutation.isPending
    || resendEmailMutation.isPending
    || removeEmailMutation.isPending;

  const requestConfirmation = (action: SensitiveAction) => {
    setCurrentPassword("");
    setPendingAction(action);
  };

  const confirmSensitiveAction = () => {
    if (!pendingAction || currentPassword.trim().length === 0) return;
    switch (pendingAction.kind) {
      case "login-name": changeLoginNameMutation.mutate(); break;
      case "password": changePasswordMutation.mutate(); break;
      case "link-oauth": linkOAuthMutation.mutate(pendingAction.provider); break;
      case "unlink-oauth": unlinkOAuthMutation.mutate(pendingAction.provider); break;
      case "request-email": requestEmailMutation.mutate(); break;
      case "resend-email": resendEmailMutation.mutate(); break;
      case "remove-email": removeEmailMutation.mutate(); break;
    }
  };

  if (securityQuery.isLoading) {
    return (
      <div className="profile-account__loading" aria-label={t("common:message.loading")} aria-busy="true">
        <Skeleton className="profile-account__loading-card profile-account__loading-card--large" />
        <Skeleton className="profile-account__loading-card" />
      </div>
    );
  }
  if (securityQuery.isError || !securityQuery.data) {
    return (
      <Card className="profile-account__error gap-0 py-0">
        <div>
          <strong>{t("common:loadError")}</strong>
          <Button loading={securityQuery.isFetching} onClick={() => void securityQuery.refetch()}>
            {t("common:action.retry")}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="profile-account">
      <div className="profile-account__layout">
        <div className="profile-account__stack">
          <Card className="profile-account__card gap-0 py-0">
            <SectionHeader title={t("account.section.login")} headingLevel={2} />
            <div className="profile-account__card-body">
              <div className="profile-field">
                <Label htmlFor="profile-login-name">{t("account.field.loginName")}</Label>
                <Input
                id="profile-login-name"
                value={loginName}
                onChange={(event) => setLoginName(event.currentTarget.value)}
                autoComplete="username"
                />
              </div>
              <p className="profile-account__hint">{t("account.hint.loginName")}</p>
              <p className="profile-account__hint">{t("account.hint.profileDisplayName")}</p>
              <div className="profile-account__action-row">
                <Button
                  variant="secondary"
                  loading={changeLoginNameMutation.isPending}
                  disabled={!loginNameChanged || !validIdentityName(loginName.trim())}
                  onClick={() => requestConfirmation({ kind: "login-name" })}
                >
                  {t("account.action.changeLoginName")}
                </Button>
              </div>
            </div>
          </Card>

          <Card className="profile-account__card gap-0 py-0">
            <SectionHeader title={t("account.section.passwordSecurity")} headingLevel={2} />
            <div className="profile-account__card-body">
              <div className="profile-account__password-fields">
                <div className="profile-field">
                  <Label htmlFor="profile-new-password">{t("account.field.newPassword")}</Label>
                  <PasswordInput
                    id="profile-new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.currentTarget.value)}
                    autoComplete="new-password"
                    showPasswordLabel={t("auth:aria.showPassword")}
                    hidePasswordLabel={t("auth:aria.hidePassword")}
                  />
                </div>
                <div className="profile-field">
                  <Label htmlFor="profile-confirm-password">{t("account.field.confirmNewPassword")}</Label>
                  <PasswordInput
                    id="profile-confirm-password"
                    value={confirmNewPassword}
                    onChange={(event) => setConfirmNewPassword(event.currentTarget.value)}
                    autoComplete="new-password"
                    showPasswordLabel={t("auth:aria.showPassword")}
                    hidePasswordLabel={t("auth:aria.hidePassword")}
                  />
                </div>
              </div>
              <div className="profile-account__action-row">
                <Button
                  loading={changePasswordMutation.isPending}
                  disabled={!canChangePassword}
                  onClick={() => requestConfirmation({ kind: "password" })}
                >
                  <SaveIcon size={14} />
                  {t("button.changePassword")}
                </Button>
              </div>

              {securityQuery.data.email_available ? (
                <div className="profile-account__email">
                  <strong>{t("account.section.email")}</strong>
                  {securityQuery.data.email ? <span>{securityQuery.data.email}</span> : null}
                  <div className="profile-field">
                    <Label htmlFor="profile-account-email">{t("account.field.email")}</Label>
                    <Input
                      id="profile-account-email"
                      value={email}
                      onChange={(event) => setEmail(event.currentTarget.value)}
                      type="email"
                      autoComplete="email"
                    />
                  </div>
                  <div className="profile-account__action-row">
                    <Button
                      loading={requestEmailMutation.isPending}
                      disabled={!email.trim()}
                      onClick={() => requestConfirmation({ kind: "request-email" })}
                    >
                      {t("account.action.sendEmail")}
                    </Button>
                    <Button
                      variant="outline"
                      loading={resendEmailMutation.isPending}
                      onClick={() => requestConfirmation({ kind: "resend-email" })}
                    >
                      {t("account.action.resendEmail")}
                    </Button>
                    {securityQuery.data.email ? (
                      <Button
                        variant="destructive"
                        loading={removeEmailMutation.isPending}
                        onClick={() => requestConfirmation({ kind: "remove-email" })}
                      >
                        {t("account.action.removeEmail")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </Card>
        </div>

        <div className="profile-account__stack">
          <Card className="profile-account__card gap-0 py-0">
            <SectionHeader title={t("account.section.oauth")} headingLevel={2} />
            <div className="profile-account__provider-list">
              {OAUTH_PROVIDERS.map((provider) => {
                const linked = linkedProviders.has(provider);
                const enabled = oauthEnabled[provider];
                const status = linked ? "linked" : enabled ? "available" : "disabled";
                const pending = (linkOAuthMutation.isPending && linkOAuthMutation.variables === provider)
                  || (unlinkOAuthMutation.isPending && unlinkOAuthMutation.variables === provider);
                return (
                  <div className="profile-account__provider" data-status={status} key={provider}>
                    <div>
                      <strong className="profile-account__provider-name">{t(`account.oauth.${provider}`)}</strong>
                      <span className="profile-account__provider-status">{t(`account.oauth.status.${status}`)}</span>
                    </div>
                    <Button
                      size="xs"
                      variant={linked ? "outline" : "secondary"}
                      loading={pending}
                      disabled={!linked && !enabled}
                      onClick={() => requestConfirmation({
                        kind: linked ? "unlink-oauth" : "link-oauth",
                        provider,
                      })}
                    >
                      {linked
                        ? t("account.action.unlinkOAuth", { provider: t(`account.oauth.${provider}`) })
                        : enabled
                          ? t("account.action.linkOAuth", { provider: t(`account.oauth.${provider}`) })
                          : t("account.action.notEnabled")}
                    </Button>
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="profile-account__exit">
            <div>
              <strong>{t("account.exit.title")}</strong>
              <span className="profile-account__exit-description">{t("account.exit.description")}</span>
            </div>
            <Button size="sm" variant="destructive" onClick={() => onLogout()}>
              <LogOutIcon size={14} />
              {t("action.logout")}
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open && !confirmationPending) finishSensitiveAction();
        }}
      >
        <DialogContent
          showCloseButton={!confirmationPending}
          closeLabel={t("common:action.close")}
        >
          <DialogHeader>
            <DialogTitle>{t("account.confirm.title")}</DialogTitle>
            <DialogDescription>{t("account.confirm.description")}</DialogDescription>
          </DialogHeader>
          <form
            className="profile-account__confirm-form"
            onSubmit={(event) => {
              event.preventDefault();
              confirmSensitiveAction();
            }}
          >
            <div className="profile-field">
              <Label htmlFor="profile-current-password">{t("account.field.currentPassword")}</Label>
              <PasswordInput
                id="profile-current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.currentTarget.value)}
                autoComplete="current-password"
                autoFocus
                required
                showPasswordLabel={t("auth:aria.showPassword")}
                hidePasswordLabel={t("auth:aria.hidePassword")}
              />
            </div>
            <DialogFooter className="profile-account__confirm-actions">
              <Button type="button" variant="outline" disabled={confirmationPending} onClick={finishSensitiveAction}>
                {t("common:action.cancel")}
              </Button>
              <Button type="submit" loading={confirmationPending} disabled={!currentPassword.trim()}>
                {t("account.confirm.submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
