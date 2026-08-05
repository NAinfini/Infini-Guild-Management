import { loginSchema } from "@guild/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  Anchor,
  Button,
  Checkbox,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { AlertTriangleIcon, ArrowLeftIcon, EyeIcon, EyeOffIcon, InfoCircleIcon, KeyboardIcon } from "@portal/components/icons";
import { useState, type ReactNode } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { isApiRequestError, login as requestLogin } from "../../services/AuthService";
import { useSiteConfigStore } from "../../stores/site-config";
import { transitionSession } from "../../session-transition";
import "./AuthPages.css";

const LOGIN_FORM_SCHEMA = loginSchema.extend({
  stay_logged_in: z.boolean().default(false),
});

type LoginFormValues = z.infer<typeof LOGIN_FORM_SCHEMA>;

type FieldErrorMap = Record<string, string>;

function isSafeReturnTo(value: string | undefined): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");
}

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
    <div className={`login-page__notice login-page__notice--${tone}`} role="status">
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
  const siteName = useSiteConfigStore((s) => s.siteName);
  const siteLogoUrl = useSiteConfigStore((s) => s.siteLogoUrl);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<z.input<typeof LOGIN_FORM_SCHEMA>, any, LoginFormValues>({
    resolver: zodResolver(LOGIN_FORM_SCHEMA),
    defaultValues: {
      username: "",
      password: "",
      stay_logged_in: false,
    },
  });

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [apiFieldErrors, setApiFieldErrors] = useState<Partial<Record<keyof LoginFormValues, string>>>({});
  const [isCapsLockOn, setIsCapsLockOn] = useState(false);
  const [showPassword, showPasswordHandlers] = useDisclosure(false);

  const usernameValue = watch("username");
  const passwordValue = watch("password");

  const loginMutation = useMutation({
    mutationFn: requestLogin,
    onSuccess: (response) => {
      transitionSession(queryClient, response);
      const fallback = "/";
      const target = isSafeReturnTo(search.returnTo) ? search.returnTo : fallback;
      void navigate({ to: target });
    },
    onError: (error) => {
      if (isApiRequestError(error) && error.status === 400) {
        const mapped = parseValidationFieldErrors(error.details);
        setApiFieldErrors({
          username: mapped.username ?? undefined,
          password: mapped.password ?? undefined,
        });
        if (!mapped.username && !mapped.password) {
          setSubmitError(error.message);
        }
        return;
      }
      if (isApiRequestError(error) && error.status === 401) {
        setSubmitError(t("invalidCredentials"));
        return;
      }
      setSubmitError(error instanceof Error ? error.message : t("invalidCredentials"));
    },
  });

  const onSubmit = (values: LoginFormValues) => {
    setSubmitError(null);
    setApiFieldErrors({});
    loginMutation.mutate(values);
  };

  const usernameError = errors.username ? t("validation.usernameRequired") : apiFieldErrors.username;
  const passwordError = errors.password ? t("validation.passwordRequired") : apiFieldErrors.password;

  return (
    <div className="login-page">
      <div className="login-page__content">
        <header className="login-page__heading">
          <div className="login-page__brand">
            {siteLogoUrl ? (
              <img src={siteLogoUrl} alt="" aria-hidden className="login-page__brand-logo" />
            ) : null}
            <Title order={1} className="login-page__brand-text">{siteName}</Title>
          </div>
          <Text c="dimmed" size="sm" ta="center" className="login-page__subtitle">
            {t("login.subtitle")}
          </Text>
        </header>

        <Paper withBorder shadow="sm" radius="md" className="login-page__card">
          {search.reason === "expired" ? (
            <LoginNotice tone="warning">{t("sessionExpired")}</LoginNotice>
          ) : null}
          {search.reason === "required" ? (
            <LoginNotice tone="info">{t("loginRequired")}</LoginNotice>
          ) : null}
          {submitError ? <LoginNotice tone="error">{submitError}</LoginNotice> : null}

          <form onSubmit={handleSubmit(onSubmit)}>
            <Stack gap={20}>
              <div className={`login-floating-field${usernameValue.length > 0 ? " login-floating-field--filled" : ""}`}>
                <TextInput
                  value={usernameValue}
                  onChange={(event) => setValue("username", event.currentTarget.value)}
                  error={usernameError}
                  classNames={{ root: "login-floating-root", input: "login-floating-input", label: "login-floating-label" }}
                  label={t("field.username")}
                  autoComplete="username"
                />
              </div>

              <div
                className={`login-floating-field${passwordValue.length > 0 ? " login-floating-field--filled" : ""}`}
                onClickCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                onKeyUpCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                onKeyDownCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
              >
                <div className="login-page__password-control">
                  <TextInput
                    label={t("field.password")}
                    type={showPassword ? "text" : "password"}
                    value={passwordValue}
                    onChange={(event) => {
                      setValue("password", event.currentTarget.value);
                    }}
                    error={passwordError}
                    classNames={{ root: "login-floating-root", input: "login-floating-input login-page__password-input", label: "login-floating-label" }}
                    autoComplete="current-password"
                  />
                  <div className="login-page__password-actions">
                    <button
                      type="button"
                      className="login-page__eye-btn"
                      onClick={showPasswordHandlers.toggle}
                      aria-label={showPassword ? t("aria.hidePassword") : t("aria.showPassword")}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
                    </button>
                  </div>
                </div>
                {isCapsLockOn ? (
                  <div className="login-page__caps-warning" role="status" aria-live="polite">
                    <KeyboardIcon
                      size={18}
                      className="login-page__caps-icon"
                      aria-hidden="true"
                    />
                    <span>{t("capsLockWarning")}</span>
                  </div>
                ) : null}
              </div>

              <Checkbox {...register("stay_logged_in")} label={t("field.stayLoggedIn")} />

              <Button type="submit" loading={loginMutation.isPending}>
                {t("button.login")}
              </Button>

              <div className="login-page__back-link">
                <Anchor
                  component={Link}
                  to="/"
                  underline="hover"
                  className="login-page__back-anchor"
                >
                  <ArrowLeftIcon size={14} />
                  {t("button.backToPortal")}
                </Anchor>
              </div>

              <div style={{ textAlign: "center" }}>
                <Text size="sm" c="dimmed">
                  {t("button.haveInviteCode")}{" "}
                  <Anchor component={Link} to="/register" underline="hover">
                    {t("button.registerHere")}
                  </Anchor>
                </Text>
              </div>
            </Stack>
          </form>
        </Paper>
      </div>
    </div>
  );
}
