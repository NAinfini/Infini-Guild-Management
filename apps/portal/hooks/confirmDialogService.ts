import type { ReactNode } from "react";

export type ConfirmDialogIntent = "neutral" | "warning" | "danger";

export type ConfirmDialogOptions = {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  intent?: ConfirmDialogIntent;
};

export type ConfirmDialogRequestFn = (
  options: ConfirmDialogOptions,
) => Promise<boolean>;

export type ActiveConfirmDialog = Readonly<
  ConfirmDialogOptions & {
    id: number;
    intent: ConfirmDialogIntent;
  }
>;

type QueuedConfirmDialog = ActiveConfirmDialog & {
  resolve: (accepted: boolean) => void;
  returnFocus: HTMLElement | null;
};

const listeners = new Set<() => void>();
const pending: QueuedConfirmDialog[] = [];
let active: QueuedConfirmDialog | null = null;
let nextRequestId = 1;

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

function notify(): void {
  for (const listener of listeners) listener();
}

function restoreFocus(target: HTMLElement | null): void {
  queueMicrotask(() => {
    if (target?.isConnected) target.focus({ preventScroll: true });
  });
}

export function requestConfirmation(options: ConfirmDialogOptions): Promise<boolean> {
  const focused =
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const request = {
    ...options,
    id: nextRequestId++,
    intent: options.intent ?? "neutral",
    returnFocus: findReturnFocusTarget(focused),
  };

  return new Promise<boolean>((resolve) => {
    pending.push({ ...request, resolve });
    if (!active) active = pending.shift() ?? null;
    notify();
  });
}

export function settleConfirmation(accepted: boolean): void {
  if (!active) return;

  const settled = active;
  active = pending.shift() ?? null;
  settled.resolve(accepted);
  notify();

  if (!active) restoreFocus(settled.returnFocus);
}

export function getActiveConfirmDialog(): ActiveConfirmDialog | null {
  return active;
}

export function subscribeToConfirmDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
