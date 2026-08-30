import i18n from "i18next";
import { useCallback } from "react";
import { isApiRequestError } from "../api/client";
import { portalToast } from "../overlays";

function showErrorToast(text: string) {
  portalToast({ title: text, status: "error", autoClose: 6000 });
}

export function presentAppError(error: unknown, fallbackMessage = i18n.t("common:errors.generic", { defaultValue: "Something went wrong" })): void {
  if (isApiRequestError(error)) {
    if (error.status === 0) {
      return;
    }
    if (error.status === 401) {
      showErrorToast(
        i18n.t("common:errors.sessionExpired", { defaultValue: "Session expired. Please log in again." }),
      );
      return;
    }
    if (error.status === 403) {
      showErrorToast(
        i18n.t("common:errors.forbidden", { defaultValue: "Access denied." }),
      );
      return;
    }
    if (error.status === 409) {
      const message = [
        i18n.t("common:errors.conflict", { defaultValue: "Conflict detected. Please refresh and try again." }),
        error.errorCode ? `${i18n.t("common:errors.codeLabel")}: ${error.errorCode}` : null,
        error.requestId ? `${i18n.t("common:errors.requestLabel")}: ${error.requestId}` : null,
      ].filter(Boolean).join("\n");
      portalToast({
        title: i18n.t("common:errors.conflictTitle"),
        message,
        status: "warning",
        autoClose: 6000,
      });
      return;
    }
    if (error.errorCode === "VALIDATION_ERROR") {
      showErrorToast(fallbackMessage);
      return;
    }
    showErrorToast(fallbackMessage);
    return;
  }

  if (error instanceof Error) {
    showErrorToast(error.name === "ZodError" ? fallbackMessage : error.message || fallbackMessage);
    return;
  }

  showErrorToast(fallbackMessage);
}

export function useAppError() {
  const showError = useCallback((error: unknown, fallbackMessage = i18n.t("common:errors.generic", { defaultValue: "Something went wrong" })) => {
    presentAppError(error, fallbackMessage);
  }, []);

  return { showError };
}

