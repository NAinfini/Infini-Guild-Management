import type { OverlayService, ToastPayload } from "@infini-dev-kit/frontend/overlays";

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
