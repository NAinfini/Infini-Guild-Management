import { notifications } from "@mantine/notifications";
import i18n from "i18next";
import { useCallback } from "react";
import { isApiRequestError } from "../api/client";
import { portalToast } from "../overlays";

function showErrorToast(text: string) {
  const delivered = portalToast({ title: text, status: "error" });
  if (!delivered) {
    notifications.show({
      color: "red",
      message: text,
      autoClose: 6000,
      withCloseButton: true,
    });
  }
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
      showErrorToast(
        i18n.t("common:errors.conflict", { defaultValue: "Conflict detected. Please refresh and try again." }),
      );
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

