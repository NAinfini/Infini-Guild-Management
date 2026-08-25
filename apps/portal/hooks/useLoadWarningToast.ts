import { useEffect, useRef } from "react";
import { portalToast } from "../overlays";

function showWarningToast(text: string) {
  portalToast({ title: text, status: "warning", autoClose: 4500 });
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

