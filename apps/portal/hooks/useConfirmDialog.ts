import { modals } from "@mantine/modals";
import type { ReactNode } from "react";

type ConfirmDialogIntent = "neutral" | "warning" | "danger";

type ConfirmDialogOptions = {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  intent?: ConfirmDialogIntent;
};

type ConfirmDialogRequestFn = (
  options: ConfirmDialogOptions,
) => Promise<boolean>;

function findReturnFocusTarget(focused: HTMLElement | null): HTMLElement | null {
  const menu = focused?.closest<HTMLElement>('[role="menu"]');
  const labelledBy = menu?.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.trim().split(/\s+/)) {
      const trigger = document.getElementById(id);
      if (trigger instanceof HTMLElement) return trigger;
    }
  }
  return focused;
}

const requestConfirmation: ConfirmDialogRequestFn = (options) =>
  new Promise<boolean>((resolve) => {
    const focused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returnFocus = findReturnFocusTarget(focused);
    const intent = options.intent ?? "neutral";
    let settled = false;

    const settle = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      resolve(accepted);
      queueMicrotask(() => {
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      });
    };

    modals.openConfirmModal({
      title: options.title,
      children: options.description,
      labels: {
        confirm: options.confirmLabel,
        cancel: options.cancelLabel,
      },
      centered: true,
      closeOnClickOutside: false,
      returnFocus: false,
      withCloseButton: false,
      cancelProps: {
        variant: "default",
        "data-autofocus": true,
      },
      confirmProps: {
        color: intent === "danger"
          ? "red"
          : intent === "warning"
            ? "yellow"
            : "portal-brand",
      },
      onCancel: () => settle(false),
      onConfirm: () => settle(true),
      onClose: () => settle(false),
    });
  });

export function useConfirmDialog(): ConfirmDialogRequestFn {
  return requestConfirmation;
}
