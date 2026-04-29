/** Toast status levels supported by the overlay service. */
export type ToastStatus = "info" | "success" | "warning" | "error";

/** Payload accepted by the overlay toast API. */
export interface ToastPayload {
  title: string;
  message?: string;
  status?: ToastStatus;
  autoClose?: number | boolean;
}

/** Minimal overlay service contract (replaces @infini-dev-kit/frontend/overlays). */
export interface OverlayService {
  toast(payload: ToastPayload): { delivered: boolean };
}

let portalOverlayService: OverlayService | null = null;

export function setPortalOverlayService(service: OverlayService | null) {
  portalOverlayService = service;
}

export function portalToast(payload: ToastPayload): boolean {
  if (!portalOverlayService) {
    return false;
  }
  return portalOverlayService.toast(payload).delivered;
}
