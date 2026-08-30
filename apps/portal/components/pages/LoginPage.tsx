import { loginSchema } from "@guild/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  EyeIcon,
  EyeOffIcon,
  InfoCircleIcon,
  KeyboardIcon,
} from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { Checkbox } from "@portal/components/ui/checkbox";
import { Input } from "@portal/components/ui/input";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  isApiRequestError,
  login as requestLogin,
  startOAuth,
  type OAuthProvider,
} from "../../services/AuthService";
import { useSiteConfigStore } from "../../stores/site-config";
import { transitionSession } from "../../session-transition";
import { isSafeReturnTo } from "../../utils/auth-navigation";
import { AuthPageFrame } from "./AuthPageFrame";
import "./AuthPages.css";

const LOGIN_FORM_SCHEMA = loginSchema.extend({
  stay_logged_in: z.boolean().default(false),
});

type LoginFormValues = z.infer<typeof LOGIN_FORM_SCHEMA>;
type FieldErrorMap = Record<string, string>;

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = firstString(item);
      if (text) {
        return text;
      }
    }
  }
  return null;
}

function parseValidationFieldErrors(details: unknown): FieldErrorMap {
  if (!details || typeof details !== "object") {
    return {};
  }

  const detailRecord = details as Record<string, unknown>;
  const fieldErrorsValue = detailRecord.fieldErrors;
  if (!fieldErrorsValue || typeof fieldErrorsValue !== "object") {
    return {};
  }

  const fieldErrors = fieldErrorsValue as Record<string, unknown>;
  const mapped: FieldErrorMap = {};
  for (const [field, value] of Object.entries(fieldErrors)) {
    const messageText = firstString(value);
    if (messageText) {
      mapped[field] = messageText;
    }
  }
  return mapped;
}

type LoginNoticeTone = "info" | "warning" | "error";

function LoginNotice({ tone, children }: { tone: LoginNoticeTone; children: ReactNode }) {
  const Icon = tone === "info" ? InfoCircleIcon : AlertTriangleIcon;
  return (
    <div
      className={`login-page__notice login-page__notice--${tone}`}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
    >
      <Icon size={16} className="login-page__notice-icon" />
      <span>{children}</span>
    </div>
  );
}

export function LoginPage() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const search = useSearch({ from: "/login" });
  const queryClient = useQueryClient();
  const {
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<z.input<typeof LOGIN_FORM_SCHEMA>, any, LoginFormValues>({
    resolver: zodResolver(LOGIN_FORM_SCHEMA),
    defaultValues: {
      login_name: "",
      password: "",
      stay_logged_in: false,
    },
  });

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [apiFieldErrors, setApiFieldErrors] = useState<Partial<Record<keyof LoginFormValues, string>>>({});
  const [isCapsLockOn, setIsCapsLockOn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const loginNameValue = watch("login_name");
  const passwordValue = watch("password");
  const stayLoggedIn = watch("stay_logged_in");
  const oauth = useSiteConfigStore((state) => state.oauth);
  const availableOAuthProviders = (Object.entries(oauth) as Array<[OAuthProvider, boolean]>)
    .filter(([, enabled]) => enabled)
    .map(([provider]) => provider);

  const loginMutation = useMutation({
    mutationFn: requestLogin,
    onSuccess: (response) => {
      transitionSession(queryClient, response);
      const fallback = "/";
      const target = isSafeReturnTo(search.returnTo) ? search.returnTo : fallback;
      if (response.session_scope === "password_change") {
        void navigate({
          to: "/complete-password-reset",
          search: target === fallback ? {} : { returnTo: target },
        });
        return;
      }
      void navigate({ to: target });
    },
    onError: (error) => {
      if (isApiRequestError(error) && error.status === 400) {
        const mapped = parseValidationFieldErrors(error.details);
        setApiFieldErrors({
          login_name: mapped.login_name ?? undefined,
          password: mapped.password ?? undefined,
        });
        if (!mapped.login_name && !mapped.password) {
          setSubmitError(error.message);
        }
        return;
      }
      if (isApiRequestError(error) && error.status === 401) {
        setSubmitError(t("invalidCredentials"));
        return;
      }
      if (isApiRequestError(error) && error.status === 429) {
        setSubmitError(t("tooManyAttempts"));
        return;
      }
      setSubmitError(error instanceof Error ? error.message : t("invalidCredentials"));
    },
  });

  const oauthMutation = useMutation({
    mutationFn: (provider: OAuthProvider) => startOAuth(provider),
    onSuccess: ({ authorization_url }) => window.location.assign(authorization_url),
    onError: (error) => setSubmitError(error instanceof Error ? error.message : t("invalidCredentials")),
  });

  const onSubmit = (values: LoginFormValues) => {
    setSubmitError(null);
    setApiFieldErrors({});
    loginMutation.mutate(values);
  };

  const loginNameError = errors.login_name ? t("validation.loginNameRequired") : apiFieldErrors.login_name;
  const passwordError = errors.password ? t("validation.passwordRequired") : apiFieldErrors.password;

  return (
    <AuthPageFrame mode="login">
      {search.reason === "expired" ? (
        <LoginNotice tone="warning">{t("sessionExpired")}</LoginNotice>
      ) : null}
      {search.reason === "required" ? (
        <LoginNotice tone="info">{t("loginRequired")}</LoginNotice>
      ) : null}
      {search.oauth === "failed" ? (
        <LoginNotice tone="error">{t("oauth.failed")}</LoginNotice>
      ) : null}
      {submitError ? <LoginNotice tone="error">{submitError}</LoginNotice> : null}

      <form onSubmit={handleSubmit(onSubmit)} className="login-page__form">
        <div className="login-page__form-stack">
          <div className={`login-floating-field${loginNameValue.length > 0 ? " login-floating-field--filled" : ""}`}>
            <div className="login-floating-root">
              <Input
                id="login-name"
                value={loginNameValue}
                onChange={(event) => setValue("login_name", event.currentTarget.value)}
                className="login-floating-input"
                aria-invalid={Boolean(loginNameError)}
                aria-describedby={loginNameError ? "login-name-error" : undefined}
                autoComplete="username"
              />
              <label className="login-floating-label" htmlFor="login-name">{t("field.loginName")}</label>
            </div>
            {loginNameError ? <p id="login-name-error" className="login-page__field-error">{loginNameError}</p> : null}
          </div>

          <div
            className={`login-floating-field${passwordValue.length > 0 ? " login-floating-field--filled" : ""}`}
            onClickCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
            onKeyUpCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
            onKeyDownCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
          >
            <div className="login-floating-root login-page__password-control">
              <Input
                id="login-password"
                type={showPassword ? "text" : "password"}
                value={passwordValue}
                onChange={(event) => setValue("password", event.currentTarget.value)}
                className="login-floating-input login-page__password-input"
                aria-invalid={Boolean(passwordError)}
                aria-describedby={passwordError ? "login-password-error" : undefined}
                autoComplete="current-password"
              />
              <label className="login-floating-label" htmlFor="login-password">{t("field.password")}</label>
              <div className="login-page__password-actions">
                <button
                  type="button"
                  className="login-page__eye-btn"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? t("aria.hidePassword") : t("aria.showPassword")}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOffIcon size={18} aria-hidden="true" /> : <EyeIcon size={18} aria-hidden="true" />}
                </button>
              </div>
            </div>
            {passwordError ? <p id="login-password-error" className="login-page__field-error">{passwordError}</p> : null}
            {isCapsLockOn ? (
              <div className="login-page__caps-warning" role="status" aria-live="polite">
                <KeyboardIcon size={18} className="login-page__caps-icon" aria-hidden="true" />
                <span>{t("capsLockWarning")}</span>
              </div>
            ) : null}
          </div>

          <label className="login-page__checkbox-field" htmlFor="stay-logged-in">
            <Checkbox
              id="stay-logged-in"
              checked={stayLoggedIn}
              onCheckedChange={(checked) => setValue("stay_logged_in", checked, { shouldDirty: true })}
            />
            <span>{t("field.stayLoggedIn")}</span>
          </label>

          <Button className="login-page__submit" type="submit" loading={loginMutation.isPending}>
            {t("button.login")}
          </Button>

          {availableOAuthProviders.length > 0 ? (
            <div className="login-page__oauth">
              <p>{t("oauth.continueWith")}</p>
              {availableOAuthProviders.map((provider) => (
                <Button
                  key={provider}
                  className="login-page__submit"
                  variant="outline"
                  loading={oauthMutation.isPending && oauthMutation.variables === provider}
                  onClick={() => oauthMutation.mutate(provider)}
                >
                  {t(`oauth.provider.${provider}`)}
                </Button>
              ))}
            </div>
          ) : null}

          <div className="login-page__back-link">
            <Link to="/" className="login-page__back-anchor">
              <ArrowLeftIcon size={14} aria-hidden="true" />
              {t("button.backToPortal")}
            </Link>
          </div>

          <p className="login-page__register-link">
            {t("button.haveInviteCode")} {" "}
            <Link to="/register">{t("button.registerHere")}</Link>
          </p>
        </div>
      </form>
    </AuthPageFrame>
  );
}
