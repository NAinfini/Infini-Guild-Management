import type { MemberProfile, User } from "@guild/shared";
import { loginSchema } from "@guild/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  Alert,
  Anchor,
  Checkbox,
  Stack,
  Text,
} from "@mantine/core";
import {
  BubbleBackground,
  GlassEffect,
  GradientText,
  InfiniButton,
  LampHeading,
  MagneticElement,
} from "@infini-dev-kit/frontend/components";
import { InfiniFloatingLabelInput } from "@infini-dev-kit/frontend/components/infini";
import { IconArrowLeft, IconEye, IconEyeOff, IconKeyboard } from "@tabler/icons-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { apiRequest, isApiRequestError } from "../../api/client";
import { useAuthStore } from "../../stores/auth";
import { FireOutlined } from "../../utils/icons";
import "./AuthPages.css";

type AuthSessionResponse = { user: User; profile: MemberProfile };

const LOGIN_FORM_SCHEMA = loginSchema.extend({
  stay_logged_in: z.boolean().default(false),
});

type LoginFormValues = z.infer<typeof LOGIN_FORM_SCHEMA>;

type FieldErrorMap = Record<string, string>;

function isSafeReturnTo(value: string | undefined): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
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

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
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
  const [showPassword, setShowPassword] = useState(false);

  const usernameValue = watch("username");
  const passwordValue = watch("password");

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitError(null);
    setApiFieldErrors({});
    try {
      const response = await apiRequest<AuthSessionResponse>("/api/auth/login", {
        method: "POST",
        bodyJson: values,
      });
      setSession(response.user, response.profile);

      const fallback = "/";
      const target = isSafeReturnTo(search.returnTo) ? search.returnTo : fallback;
      void navigate({ to: target });
    } catch (error) {
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
    }
  };

  const usernameError = errors.username?.message ?? apiFieldErrors.username;
  const passwordError = errors.password?.message ?? apiFieldErrors.password;

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
              <span className="login-page__brand-icon" aria-hidden>
                <FireOutlined />
              </span>
              <GradientText animated duration={4} className="login-page__brand-text">
                Infini Guild
              </GradientText>
            </div>
          </LampHeading>
          <Text c="dimmed" size="sm" ta="center" className="login-page__subtitle">
            Portal Access
          </Text>
        </div>

        <GlassEffect className="login-page__card" blur={16} opacity={0.1} borderOpacity={0.15}>
          {search.reason === "expired" ? <Alert color="yellow" title={t("sessionExpired")} /> : null}
          {search.reason === "required" ? <Alert color="blue" title={t("loginRequired")} /> : null}
          {submitError ? <Alert color="red" title={submitError} /> : null}

          <form onSubmit={handleSubmit(onSubmit)}>
            <Stack gap={16}>
              <InfiniFloatingLabelInput
                label={t("field.username")}
                value={usernameValue}
                onChange={(val) => setValue("username", val)}
                error={usernameError}
                focusGlow
              />

              <div
                style={{ position: "relative" }}
                onClickCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                onKeyUpCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                onKeyDownCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
              >
                <InfiniFloatingLabelInput
                  label={t("field.password")}
                  type={showPassword ? "text" : "password"}
                  value={passwordValue}
                  onChange={(val) => {
                    setValue("password", val);
                  }}
                  error={passwordError}
                  focusGlow
                />
                <div className="login-page__password-actions">
                  {isCapsLockOn ? (
                    <IconKeyboard size={18} className="login-page__caps-icon" />
                  ) : null}
                  <button
                    type="button"
                    className="login-page__eye-btn"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                  >
                    {showPassword ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                  </button>
                </div>
              </div>

              <Checkbox {...register("stay_logged_in")} label={t("field.stayLoggedIn")} />

              <InfiniButton htmlType="submit" loading={isSubmitting}>
                {t("button.login")}
              </InfiniButton>

              <MagneticElement strength={8} className="login-page__back-link">
                <Anchor
                  underline="hover"
                  onClick={() => void navigate({ to: "/" })}
                  className="login-page__back-anchor"
                >
                  <IconArrowLeft size={14} />
                  {t("button.backToPortal")}
                </Anchor>
              </MagneticElement>
            </Stack>
          </form>
        </GlassEffect>
      </div>
    </div>
  );
}
