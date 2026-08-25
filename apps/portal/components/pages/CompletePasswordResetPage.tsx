import { completePasswordResetSchema } from "@guild/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@portal/components/ui/button";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { useForm } from "react-hook-form";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { completePasswordReset } from "../../services/AuthService";
import { transitionSession } from "../../session-transition";
import { AuthPageFrame } from "./AuthPageFrame";
import "./AuthPages.css";

export function CompletePasswordResetPage() {
  const { t } = useTranslation("auth");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { handleSubmit, register, formState: { errors } } = useForm({
    resolver: zodResolver(completePasswordResetSchema),
    defaultValues: { login_name: "", new_password: "", confirm_new_password: "" },
  });
  const mutation = useMutation({
    mutationFn: completePasswordReset,
    onSuccess: (session) => {
      transitionSession(queryClient, session);
      void navigate({ to: "/" });
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
              <Input id="reset-login-name" autoComplete="username" aria-invalid={Boolean(errors.login_name)} {...register("login_name")} />
              {errors.login_name?.message ? <p className="login-page__field-error">{errors.login_name.message}</p> : null}
            </div>
            <div className="login-page__field">
              <Label htmlFor="reset-password">{t("field.password")}</Label>
              <Input id="reset-password" type="password" autoComplete="new-password" aria-invalid={Boolean(errors.new_password)} {...register("new_password")} />
              {errors.new_password?.message ? <p className="login-page__field-error">{errors.new_password.message}</p> : null}
            </div>
            <div className="login-page__field">
              <Label htmlFor="reset-confirm-password">{t("field.confirmPassword")}</Label>
              <Input id="reset-confirm-password" type="password" autoComplete="new-password" aria-invalid={Boolean(errors.confirm_new_password)} {...register("confirm_new_password")} />
              {errors.confirm_new_password?.message ? <p className="login-page__field-error">{errors.confirm_new_password.message}</p> : null}
            </div>
            <Button type="submit" loading={mutation.isPending}>{t("reset.submit")}</Button>
          </div>
        </form>
      </div>
    </AuthPageFrame>
  );
}
