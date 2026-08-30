import i18n from "i18next";
import { useEffect } from "react";
import { portalToast } from "../../overlays";

type NetworkDetail = {
  message?: string;
};

const NETWORK_NOTIFICATION_ID = "app-network-issue";

export function AppErrorOverlay() {
  useEffect(() => {
    const onNetwork = (event: Event) => {
      const detail = (event as CustomEvent<NetworkDetail>).detail;
      portalToast({
        id: NETWORK_NOTIFICATION_ID,
        title: i18n.t("common:errors.connectionTitle", { defaultValue: "Connection Issue" }),
        message: detail?.message ?? i18n.t("common:errors.connectionIssue", {
          defaultValue: "Unable to reach server. Check your network and retry.",
        }),
        status: "error",
        autoClose: 5000,
      });
    };

    window.addEventListener("guild-api-network", onNetwork as EventListener);
    return () => {
      window.removeEventListener("guild-api-network", onNetwork as EventListener);
    };
  }, []);

  return null;
}

