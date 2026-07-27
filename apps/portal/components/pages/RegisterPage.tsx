import { registerSchema } from "@guild/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { BubbleBackground, GlassEffect, GradientText, LampHeading, MagneticElement } from "@portal/components/effects";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { ArrowLeftIcon, EyeIcon, EyeOffIcon, KeyboardIcon } from "@portal/components/icons";
import { Alert, Anchor, Loader, Stack, Text, TextInput } from "@mantine/core";
import { useDebouncedValue, useDisclosure } from "@mantine/hooks";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { queryKeys } from "../../api/query-keys";
import {
  checkUsername,
  isApiRequestError,
  register as requestRegister,
  verifyInvite,
} from "../../services/AuthService";
import { useAuthStore } from "../../stores/auth";
import { useSiteConfigStore } from "../../stores/site-config";
import "./AuthPages.css";

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
  // The page serves both `/register/$inviteCode` (invite links) and `/register`
  // (the login page's register button), so the param may be absent — `strict:
  // false` is how TanStack Router reads a param that only one route defines.
  const params = useParams({ strict: false }) as { inviteCode?: string };
  const [typedInviteCode, setTypedInviteCode] = useState("");
  const [inviteCodeDraft, setInviteCodeDraft] = useState("");
  const [inviteCodeError, setInviteCodeError] = useState<string | null>(null);
  const inviteCode = params.inviteCode ?? typedInviteCode;
  const setSession = useAuthStore((state) => state.setSession);
  const siteName = useSiteConfigStore((s) => s.siteName);
  const siteLogoUrl = useSiteConfigStore((s) => s.siteLogoUrl);

  const inviteQuery = useQuery({
    queryKey: queryKeys.auth.verifyInvite(inviteCode),
    queryFn: () => verifyInvite(inviteCode),
    enabled: inviteCode.length > 0,
    retry: false,
    staleTime: 60_000,
  });

  const {
    handleSubmit,
    watch,
    setValue,
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
  const [showPassword, showPasswordHandlers] = useDisclosure(false);
  const [showConfirmPassword, showConfirmPasswordHandlers] = useDisclosure(false);

  const usernameValue = watch("username");
  const passwordValue = watch("password");
  const confirmPasswordValue = watch("confirmPassword");
  const [debouncedUsername] = useDebouncedValue((usernameValue ?? "").trim(), 320);

  const usernameAvailabilityQuery = useQuery({
    queryKey: queryKeys.auth.usernameAvailability(debouncedUsername),
    enabled: debouncedUsername.length >= 3,
    queryFn: () => checkUsername(debouncedUsername),
  });

  const registerMutation = useMutation({
    mutationFn: (values: RegisterFormValues) => requestRegister(inviteCode, values),
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

  const submitInviteCode = () => {
    const trimmed = inviteCodeDraft.trim();
    if (!trimmed) {
      setInviteCodeError(t("validation.inviteCodeRequired"));
      return;
    }
    setTypedInviteCode(trimmed);
  };

  const usernameError = errors.username?.message ?? apiFieldErrors.username;
  const passwordError = errors.password?.message ?? apiFieldErrors.password;
  const confirmPasswordError = errors.confirmPassword?.message ?? apiFieldErrors.confirmPassword;

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
            {t("register.brand.subtitle")}
          </Text>
        </div>

        <GlassEffect className="login-page__card">
          {inviteCode.length === 0 ? (
            <Stack gap={20}>
              <Text c="dimmed" size="sm">
                {t("register.enterCode.hint")}
              </Text>
              <div className={`login-floating-field${inviteCodeDraft.length > 0 ? " login-floating-field--filled" : ""}`}>
                <TextInput
                  label={t("field.inviteCode")}
                  value={inviteCodeDraft}
                  error={inviteCodeError}
                  classNames={{ root: "login-floating-root", input: "login-floating-input", label: "login-floating-label" }}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    setInviteCodeDraft(event.currentTarget.value);
                    setInviteCodeError(null);
                  }}
                  onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitInviteCode();
                    }
                  }}
                  autoFocus
                />
              </div>
              <DepthButton onClick={submitInviteCode}>{t("button.continue")}</DepthButton>
              <div className="login-page__back-link">
                <Anchor
                  underline="hover"
                  onClick={() => void navigate({ to: "/login" })}
                  className="login-page__back-anchor"
                >
                  <ArrowLeftIcon size={14} />
                  {t("button.backToLogin")}
                </Anchor>
              </div>
            </Stack>
          ) : inviteQuery.isLoading ? (
            <Stack align="center" py="xl">
              <Loader color="var(--color-primary)" />
            </Stack>
          ) : !inviteQuery.data?.valid ? (
            <Stack align="center" gap="md">
              <Alert color="red" title={t("inviteInvalid")} w="100%" />
              <div className="login-page__back-link">
                <Anchor
                  underline="hover"
                  onClick={() => {
                    // A code typed here can just be retyped; one that came from
                    // an invite link is part of the URL, so leave the page.
                    if (params.inviteCode) {
                      void navigate({ to: "/login" });
                      return;
                    }
                    setTypedInviteCode("");
                  }}
                  className="login-page__back-anchor"
                >
                  <ArrowLeftIcon size={14} />
                  {params.inviteCode ? t("button.backToLogin") : t("button.retryInviteCode")}
                </Anchor>
              </div>
            </Stack>
          ) : (
            <>
              {submitError ? <Alert color="red" title={submitError} /> : null}
              {isCapsLockOn ? <Alert color="orange" title={t("capsLockWarning")} /> : null}

              <form onSubmit={handleSubmit(onSubmit)}>
                <Stack gap={20}>
                  <div className={`login-floating-field${usernameValue.length > 0 ? " login-floating-field--filled" : ""}`}>
                    <TextInput
                      value={usernameValue}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => setValue("username", event.currentTarget.value)}
                      error={usernameError}
                      classNames={{ root: "login-floating-root", input: "login-floating-input", label: "login-floating-label" }}
                      label={t("field.username")}
                      autoComplete="username"
                    />
                  </div>

                  {!usernameError && debouncedUsername.length >= 1 ? (
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
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => setValue("password", event.currentTarget.value)}
                      error={passwordError}
                      classNames={{ root: "login-floating-root", input: "login-floating-input", label: "login-floating-label" }}
                      autoComplete="new-password"
                    />
                    <div className="login-page__password-actions">
                      {isCapsLockOn ? (
                        <KeyboardIcon size={18} className="login-page__caps-icon" />
                      ) : null}
                      <button
                        type="button"
                        className="login-page__eye-btn"
                        onClick={showPasswordHandlers.toggle}
                        tabIndex={-1}
                        aria-label={showPassword ? t("aria.hidePassword") : t("aria.showPassword")}
                      >
                        {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
                      </button>
                    </div>
                  </div>

                  <div
                    className={`login-floating-field${confirmPasswordValue.length > 0 ? " login-floating-field--filled" : ""}`}
                    onClickCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                    onKeyUpCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                    onKeyDownCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                  >
                    <TextInput
                      label={t("field.confirmPassword")}
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPasswordValue}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => setValue("confirmPassword", event.currentTarget.value)}
                      error={confirmPasswordError}
                      classNames={{ root: "login-floating-root", input: "login-floating-input", label: "login-floating-label" }}
                      autoComplete="new-password"
                    />
                    <div className="login-page__password-actions">
                      {isCapsLockOn ? (
                        <KeyboardIcon size={18} className="login-page__caps-icon" />
                      ) : null}
                      <button
                        type="button"
                        className="login-page__eye-btn"
                        onClick={showConfirmPasswordHandlers.toggle}
                        tabIndex={-1}
                        aria-label={showConfirmPassword ? t("aria.hidePassword") : t("aria.showPassword")}
                      >
                        {showConfirmPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
                      </button>
                    </div>
                  </div>

                  <DepthButton htmlType="submit" disabled={registerMutation.isPending}>
                    {t("button.register")}
                  </DepthButton>

                  <MagneticElement strength={0.3} className="login-page__back-link">
                    <Anchor
                      underline="hover"
                      onClick={() => void navigate({ to: "/login" })}
                      className="login-page__back-anchor"
                    >
                      <ArrowLeftIcon size={14} />
                      {t("button.backToLogin")}
                    </Anchor>
                  </MagneticElement>
                </Stack>
              </form>
            </>
          )}
        </GlassEffect>
      </div>
    </div>
  );
}
