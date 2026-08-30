import { completePasswordResetSchema } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@portal/components/ui/button";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { useForm } from "react-hook-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { completePasswordReset } from "../../services/AuthService";
import { transitionSession } from "../../session-transition";
import { isSafeReturnTo } from "../../utils/auth-navigation";
import { AuthPageFrame } from "./AuthPageFrame";
import { PasswordRequirements } from "../shared/PasswordRequirements";
import { newPasswordValidationKey } from "../../utils/password-validation";
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
  const passwordValue = watch("new_password");
  const confirmationValue = watch("confirm_new_password");
  const passwordErrorKey = newPasswordValidationKey(passwordValue);
  const passwordsMismatch = confirmationValue !== passwordValue;
  const mutation = useMutation({
    mutationFn: completePasswordReset,
    onSuccess: (session) => {
      transitionSession(queryClient, session);
      void navigate({ to: isSafeReturnTo(search.returnTo) ? search.returnTo : "/" });
    },
  });

  return (
    <AuthPageFrame mode="reset">
      <div className="login-page__form-stack">
        {mutation.error instanceof Error ? <p className="login-page__form-error" role="alert">{mutation.error.message}</p> : null}
        <form onSubmit={handleSubmit((value) => mutation.mutate(value))}>
          <div className="login-page__form-stack">
            <div className="login-page__field">
              <Label htmlFor="reset-login-name">{t("field.loginName")}</Label>
              <Input id="reset-login-name" autoComplete="username" aria-invalid={Boolean(errors.login_name)} aria-describedby={errors.login_name ? "reset-login-name-error" : undefined} {...register("login_name")} />
              {errors.login_name?.message ? <p id="reset-login-name-error" className="login-page__field-error">{errors.login_name.message}</p> : null}
            </div>
            <div className="password-setup">
              <div className="password-setup__layout">
                <div className="password-setup__fields">
                  <div className="login-page__field">
                    <Label htmlFor="reset-password">{t("field.password")}</Label>
                    <Input id="reset-password" type="password" autoComplete="new-password" aria-invalid={Boolean(errors.new_password)} aria-describedby={`reset-password-requirements${errors.new_password ? " reset-password-error" : ""}`} {...register("new_password")} />
                    {errors.new_password && passwordErrorKey ? <p id="reset-password-error" className="login-page__field-error">{t(passwordErrorKey, LIMITS.content.password)}</p> : null}
                  </div>
                  <div className="login-page__field">
                    <Label htmlFor="reset-confirm-password">{t("field.confirmPassword")}</Label>
                    <Input id="reset-confirm-password" type="password" autoComplete="new-password" aria-invalid={Boolean(errors.confirm_new_password)} aria-describedby={errors.confirm_new_password ? "reset-confirm-password-error" : undefined} {...register("confirm_new_password")} />
                    {errors.confirm_new_password && passwordsMismatch ? <p id="reset-confirm-password-error" className="login-page__field-error">{t("validation.passwordMismatch")}</p> : null}
                  </div>
                </div>
                <PasswordRequirements id="reset-password-requirements" password={passwordValue} confirmation={confirmationValue} />
              </div>
            </div>
            <Button type="submit" loading={mutation.isPending}>{t("reset.submit")}</Button>
          </div>
        </form>
      </div>
    </AuthPageFrame>
  );
}
