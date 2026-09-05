import { completePasswordResetSchema } from "@guild/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@portal/components/ui/button";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { useForm } from "react-hook-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import { completePasswordReset, isApiRequestError } from "../../services/AuthService";
import { authenticateSession } from "../../session-transition";
import { isSafeReturnTo } from "../../utils/auth-navigation";
import { AuthPageFrame } from "./AuthPageFrame";
import { PasswordRequirements } from "../shared/PasswordRequirements";
import { authValidationFieldErrors } from "../../utils/auth-validation";
import "./AuthPages.css";

export function CompletePasswordResetPage() {
  const { t } = useTranslation("auth");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { returnTo?: string };
  const { handleSubmit, register, watch, formState: { errors } } = useForm({
    resolver: zodResolver(completePasswordResetSchema),
    defaultValues: { login_name: "", new_password: "", confirm_new_password: "" },
  });
  const loginNameValue = watch("login_name");
  const passwordValue = watch("new_password");
  const confirmationValue = watch("confirm_new_password");
  const mutation = useMutation({
    mutationFn: (values: z.input<typeof completePasswordResetSchema>) => authenticateSession(queryClient, () => completePasswordReset(values)),
    onSuccess: (result) => {
      if (!result?.isCurrent()) return;
      void navigate({ to: isSafeReturnTo(search.returnTo) ? search.returnTo : "/" });
    },
  });

  const values = {
    login_name: loginNameValue, new_password: passwordValue, confirm_new_password: confirmationValue,
  };
  const validationMessages = authValidationFieldErrors("reset", values, t);
  const validationError = isApiRequestError(mutation.error) && mutation.error.status === 400
    ? mutation.error
    : null;
  const apiFieldErrors = validationError
    ? authValidationFieldErrors("reset", values, t, validationError.details)
    : {};
  const loginNameError = errors.login_name ? validationMessages.login_name : apiFieldErrors.login_name;
  const passwordError = errors.new_password ? validationMessages.new_password : apiFieldErrors.new_password;
  const confirmPasswordError = errors.confirm_new_password ? validationMessages.confirm_new_password : apiFieldErrors.confirm_new_password;
  const submitError = mutation.error && Object.keys(apiFieldErrors).length === 0
    ? t(validationError ? "validation.formInvalid" : "requestFailed")
    : null;

  return (
    <AuthPageFrame mode="reset">
      <div className="login-page__form-stack">
        {submitError ? <p className="login-page__form-error" role="alert">{submitError}</p> : null}
        <form onSubmit={handleSubmit((value) => mutation.mutate(value))}>
          <div className="login-page__form-stack">
            <div className="login-page__field">
              <Label htmlFor="reset-login-name">{t("field.loginName")}</Label>
              <Input id="reset-login-name" autoComplete="username" aria-invalid={Boolean(loginNameError)} aria-describedby={loginNameError ? "reset-login-name-error" : undefined} {...register("login_name")} />
              {loginNameError ? <p id="reset-login-name-error" className="login-page__field-error">{loginNameError}</p> : null}
            </div>
            <div className="password-setup">
              <div className="password-setup__layout">
                <div className="password-setup__fields">
                  <div className="login-page__field">
                    <Label htmlFor="reset-password">{t("field.password")}</Label>
                    <Input id="reset-password" type="password" autoComplete="new-password" aria-invalid={Boolean(passwordError)} aria-describedby={`reset-password-requirements${passwordError ? " reset-password-error" : ""}`} {...register("new_password")} />
                    {passwordError ? <p id="reset-password-error" className="login-page__field-error">{passwordError}</p> : null}
                  </div>
                  <div className="login-page__field">
                    <Label htmlFor="reset-confirm-password">{t("field.confirmPassword")}</Label>
                    <Input id="reset-confirm-password" type="password" autoComplete="new-password" aria-invalid={Boolean(confirmPasswordError)} aria-describedby={confirmPasswordError ? "reset-confirm-password-error" : undefined} {...register("confirm_new_password")} />
                    {confirmPasswordError ? <p id="reset-confirm-password-error" className="login-page__field-error">{confirmPasswordError}</p> : null}
                  </div>
                </div>
                <PasswordRequirements id="reset-password-requirements" password={passwordValue} confirmation={confirmationValue} />
              </div>
            </div>
            <Button className="login-page__submit" type="submit" loading={mutation.isPending}>{t("reset.submit")}</Button>
          </div>
        </form>
      </div>
    </AuthPageFrame>
  );
}
