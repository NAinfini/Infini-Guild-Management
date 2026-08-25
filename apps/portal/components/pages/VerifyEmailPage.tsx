import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@portal/components/ui/alert";
import { Button } from "@portal/components/ui/button";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../../api/query-keys";
import { verifyEmail } from "../../services/AuthService";
import { clearEmailVerificationToken, readEmailVerificationToken } from "../../utils/auth-navigation";
import { AuthPageFrame } from "./AuthPageFrame";

export function VerifyEmailPage() {
  const { t } = useTranslation("profile");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [token] = useState(readEmailVerificationToken);
  const mutation = useMutation({
    mutationFn: () => verifyEmail(token),
    onSuccess: () => {
      clearEmailVerificationToken();
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.security() });
      void navigate({ to: "/profile", search: { tab: "account" } });
    },
  });

  return (
    <AuthPageFrame mode="verify">
      <div className="login-page__form-stack">
        <p className="login-page__form-description">{t("account.verifyEmail.description")}</p>
        {!token ? (
          <Alert role="alert">
            <AlertDescription>{t("account.verifyEmail.missingToken")}</AlertDescription>
          </Alert>
        ) : null}
        {mutation.error instanceof Error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{mutation.error.message}</AlertDescription>
          </Alert>
        ) : null}
        <Button disabled={!token} loading={mutation.isPending} onClick={() => mutation.mutate()}>
          {t("account.verifyEmail.confirm")}
        </Button>
      </div>
    </AuthPageFrame>
  );
}
