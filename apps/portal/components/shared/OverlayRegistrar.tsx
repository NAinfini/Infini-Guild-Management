import { notifications } from "@mantine/notifications";
import { useEffect } from "react";
import { setPortalOverlayService, type OverlayService, type ToastPayload } from "../../overlays";

function mapToastColor(status: "info" | "success" | "warning" | "error"): string {
  if (status === "success") {
    return "green";
  }
  if (status === "warning") {
    return "yellow";
  }
  if (status === "error") {
    return "red";
  }
  return "blue";
}

const overlayService: OverlayService = {
  toast(payload: ToastPayload) {
    notifications.show({
      title: payload.title,
      message: payload.message,
      color: mapToastColor(payload.status ?? "info"),
      withBorder: true,
      autoClose: payload.autoClose ?? 5000,
    });
    return { delivered: true };
  },
};

export function OverlayRegistrar() {
  useEffect(() => {
    setPortalOverlayService(overlayService);
    return () => {
      setPortalOverlayService(null);
    };
  }, []);

  return null;
}
