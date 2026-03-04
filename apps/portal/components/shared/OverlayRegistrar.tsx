import { useBridge } from "@infini-dev-kit/frontend/provider";
import { notifications } from "@mantine/notifications";
import { useEffect } from "react";
import { setPortalOverlayService } from "../../overlays";

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

export function OverlayRegistrar() {
  const bridge = useBridge();

  useEffect(() => {
    setPortalOverlayService(bridge.overlays);

    const unregister = bridge.overlays.register({
      toast: (payload) => {
        notifications.show({
          title: payload.title,
          message: payload.description,
          color: mapToastColor(payload.status),
          withBorder: true,
          autoClose: payload.status === "error" ? false : 4000,
        });
      },
      confirm: async (payload) => {
        const detail = payload.description ? `\n\n${payload.description}` : "";
        return window.confirm(`${payload.title}${detail}`);
      },
    });

    return () => {
      unregister();
      setPortalOverlayService(null);
    };
  }, [bridge]);

  return null;
}
