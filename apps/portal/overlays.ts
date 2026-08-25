import { toast } from "@portal/components/ui/toast";

/** Toast status levels supported by the overlay service. */
type ToastStatus = "info" | "success" | "warning" | "error";

/** Payload accepted by the overlay toast API. */
export interface ToastPayload {
  id?: string;
  title: string;
  message?: string;
  status?: ToastStatus;
  autoClose?: number | boolean;
}

export function portalToast(payload: ToastPayload): boolean {
  toast.add({
    id: payload.id,
    title: payload.title,
    description: payload.message,
    type: payload.status ?? "info",
    timeout: payload.autoClose === false
      ? 0
      : typeof payload.autoClose === "number"
        ? payload.autoClose
        : undefined,
    priority: payload.status === "error" ? "high" : "low",
  });
  return true;
}
