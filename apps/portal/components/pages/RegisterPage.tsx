import { inviteCodeSchema, registerSchema } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeftIcon, EyeIcon, EyeOffIcon, KeyboardIcon } from "@portal/components/icons";
import { Alert, AlertDescription } from "@portal/components/ui/alert";
import { Button } from "@portal/components/ui/button";
import { Input } from "@portal/components/ui/input";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { queryKeys } from "../../api/query-keys";
import {
  isApiRequestError,
  register as requestRegister,
  verifyInvite,
} from "../../services/AuthService";
import { transitionSession } from "../../session-transition";
import { AuthPageFrame } from "./AuthPageFrame";
import { PasswordRequirements } from "../shared/PasswordRequirements";
import { newPasswordValidationKey } from "../../utils/password-validation";
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

function parseInviteCodeInput(value: string): string {
  const parsed = inviteCodeSchema.safeParse(value.trim().toUpperCase());
  return parsed.success ? parsed.data : "";
}

export function RegisterPage() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  // The page serves both `/register/$inviteCode` (invite links) and `/register`
  // (the login page's register button), so the parameter is optional here.
  const params = useParams({ strict: false }) as { inviteCode?: string };
  const [typedInviteCode, setTypedInviteCode] = useState("");
  const [inviteCodeDraft, setInviteCodeDraft] = useState("");
  const [inviteCodeError, setInviteCodeError] = useState<string | null>(null);
  const inviteCode = params.inviteCode ?? typedInviteCode;
  const queryClient = useQueryClient();
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
      login_name: "",
      display_name: "",
      password: "",
      confirmPassword: "",
    },
  });

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [apiFieldErrors, setApiFieldErrors] = useState<Partial<Record<keyof RegisterFormValues, string>>>({});
  const [isCapsLockOn, setIsCapsLockOn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const loginNameValue = watch("login_name");
  const displayNameValue = watch("display_name");
  const passwordValue = watch("password");
  const confirmPasswordValue = watch("confirmPassword");

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
          login_name: mapped.login_name ?? undefined,
          display_name: mapped.display_name ?? undefined,
          password: mapped.password ?? undefined,
          confirmPassword: mapped.confirmPassword ?? undefined,
        });
        if (!mapped.login_name && !mapped.display_name && !mapped.password && !mapped.confirmPassword) {
          setSubmitError(error.message);
        }
        return;
      }
      setSubmitError(error instanceof Error ? error.message : t("inviteInvalid"));
    },
  });

  const submitInviteCode = () => {
    const code = parseInviteCodeInput(inviteCodeDraft);
    if (!code) {
      setInviteCodeError(t("validation.inviteCodeRequired"));
      return;
    }
    setTypedInviteCode(code);
  };

  const onSubmit = (values: RegisterFormValues) => {
    setSubmitError(null);
    setApiFieldErrors({});
    registerMutation.mutate(values);
  };

  const loginNameError = errors.login_name?.message ?? apiFieldErrors.login_name;
  const displayNameError = errors.display_name?.message ?? apiFieldErrors.display_name;
  const passwordErrorKey = newPasswordValidationKey(passwordValue);
  const passwordError = errors.password && passwordErrorKey
    ? t(passwordErrorKey, LIMITS.content.password)
    : apiFieldErrors.password;
  const confirmPasswordError = errors.confirmPassword && confirmPasswordValue !== passwordValue
    ? t("validation.passwordMismatch")
    : apiFieldErrors.confirmPassword;

  return (
    <AuthPageFrame mode="register">
      {inviteCode.length === 0 ? (
        <div className="login-page__form-stack">
          <p className="login-page__form-description">{t("register.enterInviteCode.hint")}</p>
          <div className={`login-floating-field${inviteCodeDraft.length > 0 ? " login-floating-field--filled" : ""}`}>
            <div className="login-floating-root">
              <Input
                id="invite-code"
                value={inviteCodeDraft}
                className="login-floating-input"
                aria-invalid={Boolean(inviteCodeError)}
                aria-describedby={inviteCodeError ? "invite-code-error" : undefined}
                maxLength={10}
                autoCapitalize="characters"
                onChange={(event) => {
                  setInviteCodeDraft(event.currentTarget.value.toUpperCase());
                  setInviteCodeError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitInviteCode();
                  }
                }}
                autoFocus
              />
              <label className="login-floating-label" htmlFor="invite-code">{t("field.inviteCode")}</label>
            </div>
            {inviteCodeError ? <p id="invite-code-error" className="login-page__field-error">{inviteCodeError}</p> : null}
          </div>
          <Button className="login-page__submit" onClick={submitInviteCode}>{t("button.continue")}</Button>
          <div className="login-page__back-link">
            <Link to="/login" className="login-page__back-anchor">
              <ArrowLeftIcon size={14} aria-hidden="true" />
              {t("button.backToLogin")}
            </Link>
          </div>
        </div>
      ) : inviteQuery.isLoading ? (
        <div className="login-page__invite-loading" role="status" aria-label={t("common:message.loading")}>
          <span className="login-page__spinner" aria-hidden="true" />
        </div>
      ) : !inviteQuery.data?.valid ? (
        <div className="login-page__form-stack">
          <Alert variant="destructive">
            <AlertDescription>{t("inviteInvalid")}</AlertDescription>
          </Alert>
          <div className="login-page__back-link">
            {params.inviteCode ? (
              <Link to="/login" className="login-page__back-anchor">
                <ArrowLeftIcon size={14} aria-hidden="true" />
                {t("button.backToLogin")}
              </Link>
            ) : (
              <button
                type="button"
                className="login-page__back-anchor login-page__back-button"
                onClick={() => setTypedInviteCode("")}
              >
                <ArrowLeftIcon size={14} aria-hidden="true" />
                {t("button.retryInviteCode")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {submitError ? (
            <Alert variant="destructive" className="login-page__form-alert">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={handleSubmit(onSubmit)} className="login-page__form">
            <div className="login-page__form-stack">
              <div className={`login-floating-field${loginNameValue.length > 0 ? " login-floating-field--filled" : ""}`}>
                <div className="login-floating-root">
                  <Input
                    id="register-login-name"
                    value={loginNameValue}
                    onChange={(event) => setValue("login_name", event.currentTarget.value)}
                    className="login-floating-input"
                    aria-invalid={Boolean(loginNameError)}
                    aria-describedby={loginNameError ? "register-login-name-error" : undefined}
                    autoComplete="username"
                  />
                  <label className="login-floating-label" htmlFor="register-login-name">{t("field.loginName")}</label>
                </div>
                {loginNameError ? <p id="register-login-name-error" className="login-page__field-error">{loginNameError}</p> : null}
              </div>

              <div className={`login-floating-field${displayNameValue.length > 0 ? " login-floating-field--filled" : ""}`}>
                <div className="login-floating-root">
                  <Input
                    id="register-display-name"
                    value={displayNameValue}
                    onChange={(event) => setValue("display_name", event.currentTarget.value)}
                    className="login-floating-input"
                    aria-invalid={Boolean(displayNameError)}
                    aria-describedby={displayNameError ? "register-display-name-error" : undefined}
                    autoComplete="nickname"
                  />
                  <label className="login-floating-label" htmlFor="register-display-name">{t("field.displayName")}</label>
                </div>
                {displayNameError ? <p id="register-display-name-error" className="login-page__field-error">{displayNameError}</p> : null}
              </div>

              <div className="password-setup">
                <div className="password-setup__layout">
                  <div className="password-setup__fields">
                    <div
                      className={`login-floating-field${passwordValue.length > 0 ? " login-floating-field--filled" : ""}`}
                      onClickCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                      onKeyUpCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                      onKeyDownCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                    >
                      <div className="login-floating-root login-page__password-control">
                        <Input
                          id="register-password"
                          type={showPassword ? "text" : "password"}
                          value={passwordValue}
                          onChange={(event) => setValue("password", event.currentTarget.value)}
                          className="login-floating-input login-page__password-input"
                          aria-invalid={Boolean(passwordError)}
                          aria-describedby={`register-password-requirements${passwordError ? " register-password-error" : ""}`}
                          autoComplete="new-password"
                        />
                        <label className="login-floating-label" htmlFor="register-password">{t("field.password")}</label>
                        <div className="login-page__password-actions">
                          {isCapsLockOn ? <KeyboardIcon size={18} className="login-page__caps-icon" aria-hidden="true" /> : null}
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
                      {passwordError ? <p id="register-password-error" className="login-page__field-error">{passwordError}</p> : null}
                    </div>

                    <div
                      className={`login-floating-field${confirmPasswordValue.length > 0 ? " login-floating-field--filled" : ""}`}
                      onClickCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                      onKeyUpCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                      onKeyDownCapture={(event) => setIsCapsLockOn(event.getModifierState("CapsLock"))}
                    >
                      <div className="login-floating-root login-page__password-control">
                        <Input
                          id="register-confirm-password"
                          type={showConfirmPassword ? "text" : "password"}
                          value={confirmPasswordValue}
                          onChange={(event) => setValue("confirmPassword", event.currentTarget.value)}
                          className="login-floating-input login-page__password-input"
                          aria-invalid={Boolean(confirmPasswordError)}
                          aria-describedby={confirmPasswordError ? "register-confirm-password-error" : undefined}
                          autoComplete="new-password"
                        />
                        <label className="login-floating-label" htmlFor="register-confirm-password">{t("field.confirmPassword")}</label>
                        <div className="login-page__password-actions">
                          {isCapsLockOn ? <KeyboardIcon size={18} className="login-page__caps-icon" aria-hidden="true" /> : null}
                          <button
                            type="button"
                            className="login-page__eye-btn"
                            onClick={() => setShowConfirmPassword((visible) => !visible)}
                            aria-label={showConfirmPassword ? t("aria.hideConfirmPassword") : t("aria.showConfirmPassword")}
                            aria-pressed={showConfirmPassword}
                          >
                            {showConfirmPassword ? <EyeOffIcon size={18} aria-hidden="true" /> : <EyeIcon size={18} aria-hidden="true" />}
                          </button>
                        </div>
                      </div>
                      {confirmPasswordError ? <p id="register-confirm-password-error" className="login-page__field-error">{confirmPasswordError}</p> : null}
                    </div>
                  </div>
                  <PasswordRequirements id="register-password-requirements" password={passwordValue} confirmation={confirmPasswordValue} />
                </div>
              </div>

              {isCapsLockOn ? (
                <div className="login-page__caps-warning" role="status" aria-live="polite">
                  <KeyboardIcon size={18} className="login-page__caps-icon" aria-hidden="true" />
                  <span>{t("capsLockWarning")}</span>
                </div>
              ) : null}

              <Button className="login-page__submit" type="submit" loading={registerMutation.isPending}>
                {t("button.register")}
              </Button>

              <div className="login-page__back-link">
                <Link to="/login" className="login-page__back-anchor">
                  <ArrowLeftIcon size={14} aria-hidden="true" />
                  {t("button.backToLogin")}
                </Link>
              </div>
            </div>
          </form>
        </>
      )}
    </AuthPageFrame>
  );
}
