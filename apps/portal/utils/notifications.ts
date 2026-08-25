import { portalToast } from "../overlays";

export function notifySuccess(message: string) {
  portalToast({ title: message, status: "success" });
}

export function notifyError(message: string) {
  portalToast({ title: message, status: "error" });
}

export function notifyWarning(message: string) {
  portalToast({ title: message, status: "warning" });
}
