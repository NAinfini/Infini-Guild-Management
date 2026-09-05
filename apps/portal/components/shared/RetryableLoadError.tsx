import { Alert, AlertAction, AlertTitle } from "@portal/components/ui/alert";
import { Button } from "@portal/components/ui/button";
import { useTranslation } from "react-i18next";

type RetryableLoadErrorProps = {
  onRetry: () => void;
  pending?: boolean;
  className?: string;
};

export function RetryableLoadError({ onRetry, pending = false, className }: RetryableLoadErrorProps) {
  const { t } = useTranslation("common");

  return (
    <Alert variant="destructive" className={className}>
      <AlertTitle>{t("loadError")}</AlertTitle>
      <AlertAction>
        <Button type="button" size="sm" variant="outline" loading={pending} onClick={onRetry}>
          {t("action.retry")}
        </Button>
      </AlertAction>
    </Alert>
  );
}
