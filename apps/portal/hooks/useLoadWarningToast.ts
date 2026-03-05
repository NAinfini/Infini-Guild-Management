import { notifications } from "@mantine/notifications";
import { useEffect, useRef } from "react";
import { portalToast } from "../overlays";

function showWarningToast(text: string) {
  const delivered = portalToast({ title: text, status: "warning" });
  if (!delivered) {
    notifications.show({
      color: "infini-warning",
      message: text,
      autoClose: 4500,
      withCloseButton: true,
    });
  }
}

export function useLoadWarningToast(shouldShow: boolean, text: string) {
  const alreadyShownRef = useRef(false);

  useEffect(() => {
    if (shouldShow) {
      if (!alreadyShownRef.current) {
        showWarningToast(text);
        alreadyShownRef.current = true;
      }
      return;
    }

    alreadyShownRef.current = false;
  }, [shouldShow, text]);
}

