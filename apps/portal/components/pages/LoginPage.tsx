import type { MemberProfile, User } from "@guild/shared";
import { loginSchema } from "@guild/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  Alert,
  Anchor,
  Button,
  Checkbox,
  Group,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  BubbleBackground,
  GlassEffect,
  GradientText,
  LampHeading,

} from "@portal/components/effects";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { IconArrowLeft, IconEye, IconEyeOff, IconKeyboard } from "@tabler/icons-react";
import { useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { apiRequest, isApiRequestError } from "../../api/client";
import { useAuthStore } from "../../stores/auth";
import { useSiteConfigStore } from "../../stores/site-config";
import "./AuthPages.css";

type AuthSessionResponse = { user: User; profile: MemberProfile };

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

export function LoginPage() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const search = useSearch({ from: "/login" });
  const setSession = useAuthStore((state) => state.setSession);
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
  const [inviteCodeInput, setInviteCodeInput] = useState<string | null>(null);
  const [inviteCodeError, setInviteCodeError] = useState<string | null>(null);

  const usernameValue = watch("username");
  const passwordValue = watch("password");

  const loginMutation = useMutation({
    mutationFn: (values: LoginFormValues) =>
      apiRequest<AuthSessionResponse>("/api/auth/login", {
        method: "POST",
        bodyJson: values,
      }),
    onSuccess: (response) => {
      setSession(response.user, response.profile);
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
      const messageText = error instanceof Error ? error.message : t("invalidCredentials");
      setSubmitError(messageText);
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
      <div className="login-page__bg" />
      <BubbleBackground
        count={24}
        minSize={4}
        maxSize={40}
        speed={0.6}
        className="login-page__bubbles"
      />

      <div className="login-page__content">
        <div className="login-page__heading">
          <LampHeading coneWidth={320} coneHeight={140} animated>
            <div className="login-page__brand">
              {siteLogoUrl ? (
                <img src={siteLogoUrl} alt="" aria-hidden className="login-page__brand-logo" />
              ) : null}
              <GradientText animated duration={4} className="login-page__brand-text">
                {siteName}
              </GradientText>
            </div>
          </LampHeading>
          <Text c="dimmed" size="sm" ta="center" className="login-page__subtitle">
            {t("login.subtitle")}
          </Text>
        </div>

        <GlassEffect className="login-page__card" blur={16} opacity={0.1} borderOpacity={0.15}>
          {search.reason === "expired" ? <Alert color="yellow" title={t("sessionExpired")} /> : null}
          {search.reason === "required" ? <Alert color="blue" title={t("loginRequired")} /> : null}
          {submitError ? <Alert color="red" title={submitError} /> : null}

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
                <TextInput
                  label={t("field.password")}
                  type={showPassword ? "text" : "password"}
                  value={passwordValue}
                  onChange={(event) => {
                    setValue("password", event.currentTarget.value);
                  }}
                  error={passwordError}
                  classNames={{ root: "login-floating-root", input: "login-floating-input", label: "login-floating-label" }}
                  autoComplete="current-password"
                />
                <div className="login-page__password-actions">
                  {isCapsLockOn ? (
                    <IconKeyboard size={18} className="login-page__caps-icon" />
                  ) : null}
                  <button
                    type="button"
                    className="login-page__eye-btn"
                    onClick={showPasswordHandlers.toggle}
                    tabIndex={-1}
                    aria-label={showPassword ? t("aria.hidePassword") : t("aria.showPassword")}
                  >
                    {showPassword ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                  </button>
                </div>
              </div>

              <Checkbox {...register("stay_logged_in")} label={t("field.stayLoggedIn")} />

              <DepthButton htmlType="submit" disabled={loginMutation.isPending}>
                {t("button.login")}
              </DepthButton>

              <div className="login-page__back-link">
                <Anchor
                  underline="hover"
                  onClick={() => void navigate({ to: "/" })}
                  className="login-page__back-anchor"
                >
                  <IconArrowLeft size={14} />
                  {t("button.backToPortal")}
                </Anchor>
              </div>

              <div style={{ textAlign: "center" }}>
                {inviteCodeInput === null ? (
                  <Text size="sm" c="dimmed">
                    {t("button.haveInviteCode")}{" "}
                    <Anchor underline="hover" onClick={() => setInviteCodeInput("")}>
                      {t("button.registerHere")}
                    </Anchor>
                  </Text>
                ) : (
                  <Group gap={6} justify="center">
                    <TextInput
                      size="xs"
                      placeholder={t("field.inviteCode")}
                      value={inviteCodeInput}
                      error={inviteCodeError}
                      onChange={(event) => {
                        setInviteCodeInput(event.currentTarget.value);
                        setInviteCodeError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          if (inviteCodeInput.trim()) {
                            void navigate({ to: "/register/$inviteCode", params: { inviteCode: inviteCodeInput.trim() } });
                          } else {
                            setInviteCodeError(t("validation.inviteCodeRequired"));
                          }
                        }
                      }}
                      style={{ width: 160 }}
                      autoFocus
                    />
                    <Button
                      size="xs"
                      variant="default"
                      onClick={() => {
                        if (inviteCodeInput.trim()) {
                          void navigate({ to: "/register/$inviteCode", params: { inviteCode: inviteCodeInput.trim() } });
                        } else {
                          setInviteCodeError(t("validation.inviteCodeRequired"));
                        }
                      }}
                    >
                      {t("button.go")}
                    </Button>
                  </Group>
                )}
              </div>
            </Stack>
          </form>
        </GlassEffect>
      </div>
    </div>
  );
}
