import { notifications } from "@mantine/notifications";
import i18n from "i18next";
import { useCallback } from "react";
import { ZodError } from "zod";
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

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join(".") : null;
      return field ? `${field}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

function formatValidationDetails(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  const fieldErrors = d.fieldErrors as Record<string, string[]> | undefined;
  if (fieldErrors && typeof fieldErrors === "object") {
    const parts: string[] = [];
    for (const [field, messages] of Object.entries(fieldErrors)) {
      if (Array.isArray(messages) && messages.length > 0) {
        parts.push(`${field}: ${messages.join(", ")}`);
      }
    }
    if (parts.length > 0) return parts.join("; ");
  }
  const formErrors = d.formErrors as string[] | undefined;
  if (Array.isArray(formErrors) && formErrors.length > 0) {
    return formErrors.join("; ");
  }
  return null;
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
    const detailsMessage = formatValidationDetails(error.details);
    showErrorToast(detailsMessage || error.message || fallbackMessage);
    return;
  }

  if (error instanceof ZodError) {
    showErrorToast(formatZodError(error) || fallbackMessage);
    return;
  }

  if (error instanceof Error) {
    showErrorToast(error.message || fallbackMessage);
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

