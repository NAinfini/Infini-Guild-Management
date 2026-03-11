import type { MemberProfile, User } from "@guild/shared";
import { registerSchema } from "@guild/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  Alert,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { GlassEffect, InfiniButton } from "@infini-dev-kit/frontend/components";
import { useDebouncedValue } from "@mantine/hooks";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { apiRequest, isApiRequestError } from "../../api/client";
import { queryKeys } from "../../api/query-keys";
import { useAuthStore } from "../../stores/auth";
import { FireOutlined } from "../../utils/icons";
import { AuthHero } from "../auth/AuthHero";
import "./AuthPages.css";

type AuthSessionResponse = { user: User; profile: MemberProfile };
type RegisterFormValues = z.infer<typeof registerSchema>;
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

export function RegisterPage() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const { inviteCode } = useParams({ from: "/register/$inviteCode" });
  const setSession = useAuthStore((state) => state.setSession);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: "",
      password: "",
      confirmPassword: "",
    },
  });

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [apiFieldErrors, setApiFieldErrors] = useState<Partial<Record<keyof RegisterFormValues, string>>>({});
  const [isCapsLockOn, setIsCapsLockOn] = useState(false);

  const rawUsername = watch("username");
  const [debouncedUsername] = useDebouncedValue((rawUsername ?? "").trim(), 320);

  const usernameAvailabilityQuery = useQuery({
    queryKey: queryKeys.auth.usernameAvailability(debouncedUsername),
    enabled: debouncedUsername.length >= 3,
    queryFn: () =>
      apiRequest<{ available: boolean; reason?: string }>(
        `/api/auth/check-username?username=${encodeURIComponent(debouncedUsername)}`,
      ),
  });

  const registerMutation = useMutation({
    mutationFn: async (values: RegisterFormValues) => {
      await apiRequest<{ user: User }>(`/api/auth/register/${inviteCode}`, {
        method: "POST",
        bodyJson: values,
      });
      return apiRequest<AuthSessionResponse>("/api/auth/me");
    },
    onSuccess: (session) => {
      setSession(session.user, session.profile);
      void navigate({ to: "/" });
    },
    onError: (error) => {
      if (isApiRequestError(error) && error.status === 400) {
        const mapped = parseValidationFieldErrors(error.details);
        setApiFieldErrors({
          username: mapped.username ?? undefined,
          password: mapped.password ?? undefined,
          confirmPassword: mapped.confirmPassword ?? undefined,
        });
        if (!mapped.username && !mapped.password && !mapped.confirmPassword) {
          setSubmitError(error.message);
        }
        return;
      }
      setSubmitError(error instanceof Error ? error.message : t("inviteInvalid"));
    },
  });

  const onSubmit = (values: RegisterFormValues) => {
    setSubmitError(null);
    setApiFieldErrors({});
    if (
      usernameAvailabilityQuery.data &&
      !usernameAvailabilityQuery.data.available &&
      values.username.trim() === debouncedUsername
    ) {
      setSubmitError(t("usernameUnavailable"));
      return;
    }
    registerMutation.mutate(values);
  };

  const usernameError = errors.username?.message ?? apiFieldErrors.username;
  const passwordError = errors.password?.message ?? apiFieldErrors.password;
  const confirmPasswordError = errors.confirmPassword?.message ?? apiFieldErrors.confirmPassword;

  return (
    <div className="auth-page-shell">
      <AuthHero
        eyebrow={t("register.hero.eyebrow")}
        title={t("register.hero.title")}
        subtitle={t("register.hero.subtitle")}
      />
      <div className="auth-form-column">
        <GlassEffect className="auth-card" blur={14} opacity={0.12}>
          <div className="auth-brand">
            <span className="auth-brand-icon" aria-hidden>
              <FireOutlined />
            </span>
            <div className="auth-brand-copy">
              <Text fw={700}>{t("brand.name")}</Text>
              <Text c="dimmed" size="sm">
                {t("register.brand.subtitle")}
              </Text>
            </div>
          </div>
          <Title order={1} className="auth-form-title">
            {t("title.register")}
          </Title>

          {submitError ? <Alert color="infini-danger" title={submitError} /> : null}
          {isCapsLockOn ? <Alert color="infini-warning" title={t("capsLockWarning")} /> : null}

          <form onSubmit={handleSubmit(onSubmit)}>
            <Stack gap={12}>
              <TextInput
                {...register("username")}
                autoComplete="username"
                label={t("field.username")}
                error={usernameError}
              />

              {!usernameError && debouncedUsername.length >= 3 ? (
                usernameAvailabilityQuery.isFetching ? (
                  <Text c="dimmed" size="sm">
                    {t("checkingUsername")}
                  </Text>
                ) : usernameAvailabilityQuery.data ? (
                  <Text c={usernameAvailabilityQuery.data.available ? "teal" : "red"} size="sm">
                    {usernameAvailabilityQuery.data.available ? t("usernameAvailable") : t("usernameUnavailable")}
                  </Text>
                ) : null
              ) : null}

              <PasswordInput
                {...register("password")}
                autoComplete="new-password"
                label={t("field.password")}
                error={passwordError}
                onKeyUp={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                onBlur={() => setIsCapsLockOn(false)}
              />

              <PasswordInput
                {...register("confirmPassword")}
                autoComplete="new-password"
                label={t("field.confirmPassword")}
                error={confirmPasswordError}
                onKeyUp={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                onBlur={() => setIsCapsLockOn(false)}
              />

              <InfiniButton htmlType="submit" loading={registerMutation.isPending}>
                {t("button.register")}
              </InfiniButton>

              <div className="auth-social">
                <Text c="dimmed" className="auth-social-label">
                  {t("register.social.title")}
                </Text>
                <Group grow gap={0}>
                  <InfiniButton className="auth-social-btn auth-social-btn--discord" disabled>
                    {t("register.social.discord")}
                  </InfiniButton>
                  <InfiniButton className="auth-social-btn auth-social-btn--wechat" disabled>
                    {t("register.social.wechat")}
                  </InfiniButton>
                </Group>
              </div>
            </Stack>
          </form>
        </GlassEffect>
      </div>
    </div>
  );
}

