import { notifications } from "@mantine/notifications";
import i18n from "i18next";
import { useEffect } from "react";

type ConflictDetail = {
  message?: string;
  requestId?: string;
  errorCode?: string;
};

type NetworkDetail = {
  message?: string;
};

const NETWORK_NOTIFICATION_ID = "app-network-issue";

export function AppErrorOverlay() {
  useEffect(() => {
    const onConflict = (event: Event) => {
      const detail = (event as CustomEvent<ConflictDetail>).detail;
      const messageText = detail?.message ?? "Conflict detected. Please refresh and retry.";
      const extra = [
        detail?.errorCode ? `Code: ${detail.errorCode}` : null,
        detail?.requestId ? `Request: ${detail.requestId}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      notifications.show({
        title: "Conflict Detected",
        message: extra ? `${messageText}\n${extra}` : messageText,
        color: "yellow",
        autoClose: false,
        withCloseButton: true,
      });
    };

    const onNetwork = (event: Event) => {
      const detail = (event as CustomEvent<NetworkDetail>).detail;
      notifications.show({
        id: NETWORK_NOTIFICATION_ID,
        title: i18n.t("common:errors.connectionTitle", { defaultValue: "Connection Issue" }),
        message: detail?.message ?? i18n.t("common:errors.connectionIssue", {
          defaultValue: "Unable to reach server. Check your network and retry.",
        }),
        color: "red",
        autoClose: false,
        withCloseButton: true,
      });
    };

    window.addEventListener("guild-api-conflict", onConflict as EventListener);
    window.addEventListener("guild-api-network", onNetwork as EventListener);
    return () => {
      window.removeEventListener("guild-api-conflict", onConflict as EventListener);
      window.removeEventListener("guild-api-network", onNetwork as EventListener);
    };
  }, []);

  return null;
}
