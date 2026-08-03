import { registerSchema } from "@guild/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeftIcon, EyeIcon, EyeOffIcon, KeyboardIcon } from "@portal/components/icons";
import { Alert, Anchor, Button, Loader, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
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
import { useSiteConfigStore } from "../../stores/site-config";
import { transitionSession } from "../../session-transition";
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

/* 后端 checkUsername（AuthService.ts:199）会给出「不可用」的具体原因，此前 UI 一律
 * 显示 usernameUnavailable（「用户名已被占用」）—— 对格式非法和系统保留前缀两种情况
 * 都是假话。这里按 reason 分发到对应文案。
 * reason 缺省表示真的被占用；出现未知 reason 时落到 Generic 而不是「已被占用」，
 * 否则后端新增一种原因就会无声地把假话说回去。 */
const USERNAME_UNAVAILABLE_KEY: Record<string, string> = {
  invalid_format: "usernameInvalidFormat",
  reserved_prefix: "usernameReserved",
};

function usernameUnavailableKey(reason: string | undefined): string {
  if (reason === undefined) return "usernameUnavailable";
  return USERNAME_UNAVAILABLE_KEY[reason] ?? "usernameUnavailableGeneric";
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
  const queryClient = useQueryClient();
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
      transitionSession(queryClient, session);
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
      setSubmitError(t(usernameUnavailableKey(usernameAvailabilityQuery.data.reason)));
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
      <div className="login-page__content">
        <header className="login-page__heading">
          <div className="login-page__brand">
            {siteLogoUrl ? (
              <img src={siteLogoUrl} alt="" aria-hidden className="login-page__brand-logo" />
            ) : null}
            <Title order={1} className="login-page__brand-text">{siteName}</Title>
          </div>
          <Text c="dimmed" size="sm" ta="center" className="login-page__subtitle">
            {t("register.brand.subtitle")}
          </Text>
        </header>

        <Paper withBorder shadow="sm" radius="md" className="login-page__card">
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
              <Button onClick={submitInviteCode}>{t("button.continue")}</Button>
              <div className="login-page__back-link">
                <Anchor
                  component={Link}
                  to="/login"
                  underline="hover"
                  className="login-page__back-anchor"
                >
                  <ArrowLeftIcon size={14} />
                  {t("button.backToLogin")}
                </Anchor>
              </div>
            </Stack>
          ) : inviteQuery.isLoading ? (
            <Stack align="center" py="xl">
              <Loader color="var(--brand-fill)" />
            </Stack>
          ) : !inviteQuery.data?.valid ? (
            <Stack align="center" gap="md">
              <Alert color="red" title={t("inviteInvalid")} w="100%" />
              <div className="login-page__back-link">
                {params.inviteCode ? (
                  <Anchor
                    component={Link}
                    to="/login"
                    underline="hover"
                    className="login-page__back-anchor"
                  >
                    <ArrowLeftIcon size={14} />
                    {t("button.backToLogin")}
                  </Anchor>
                ) : (
                  <button
                    type="button"
                    className="login-page__back-anchor login-page__back-button"
                    onClick={() => setTypedInviteCode("")}
                  >
                    <ArrowLeftIcon size={14} />
                    {t("button.retryInviteCode")}
                  </button>
                )}
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
                        {usernameAvailabilityQuery.data.available
                          ? t("usernameAvailable")
                          : t(usernameUnavailableKey(usernameAvailabilityQuery.data.reason))}
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
                      classNames={{ root: "login-floating-root", input: "login-floating-input login-page__password-input", label: "login-floating-label" }}
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
                        aria-label={showPassword ? t("aria.hidePassword") : t("aria.showPassword")}
                        aria-pressed={showPassword}
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
                      classNames={{ root: "login-floating-root", input: "login-floating-input login-page__password-input", label: "login-floating-label" }}
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
                        aria-label={showConfirmPassword ? t("aria.hideConfirmPassword") : t("aria.showConfirmPassword")}
                        aria-pressed={showConfirmPassword}
                      >
                        {showConfirmPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
                      </button>
                    </div>
                  </div>

                  <Button type="submit" loading={registerMutation.isPending}>
                    {t("button.register")}
                  </Button>

                  <div className="login-page__back-link">
                    <Anchor
                      component={Link}
                      to="/login"
                      underline="hover"
                      className="login-page__back-anchor"
                    >
                      <ArrowLeftIcon size={14} />
                      {t("button.backToLogin")}
                    </Anchor>
                  </div>
                </Stack>
              </form>
            </>
          )}
        </Paper>
      </div>
    </div>
  );
}
