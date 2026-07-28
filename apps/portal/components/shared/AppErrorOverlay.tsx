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
      const messageText = i18n.t("common:errors.conflict");
      const extra = [
        detail?.errorCode ? `${i18n.t("common:errors.codeLabel")}: ${detail.errorCode}` : null,
        detail?.requestId ? `${i18n.t("common:errors.requestLabel")}: ${detail.requestId}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      notifications.show({
        title: i18n.t("common:errors.conflictTitle"),
        message: extra ? `${messageText}\n${extra}` : messageText,
        color: "yellow",
        autoClose: 5000,
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
        autoClose: 5000,
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

