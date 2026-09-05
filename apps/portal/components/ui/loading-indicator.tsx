import { useTranslation } from "react-i18next";
import "./loading-indicator.css";

export function LoadingIndicator() {
  const { t } = useTranslation("common");
  return (
    <span className="loading-region" role="status" aria-live="polite" aria-busy="true">
      <span className="loading-indicator">
        <span className="loading-indicator__spinner" aria-hidden="true" />
        <span>{t("message.loading")}</span>
      </span>
    </span>
  );
}
