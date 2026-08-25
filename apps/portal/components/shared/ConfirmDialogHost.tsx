import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

import {
  getActiveConfirmDialog,
  settleConfirmation,
  subscribeToConfirmDialog,
} from "@portal/hooks/confirmDialogService";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@portal/components/ui/alert-dialog";
import { Button } from "@portal/components/ui/button";

const confirmButtonClassNames = {
  neutral: undefined,
  warning:
    "bg-[var(--status-warning)] text-[var(--status-on-fill)] hover:bg-[var(--status-warning)] hover:opacity-90",
  danger:
    "bg-[var(--status-danger)] text-[var(--status-on-fill)] hover:bg-[var(--status-danger)] hover:opacity-90",
} as const;

export function ConfirmDialogHost() {
  const request = useSyncExternalStore(
    subscribeToConfirmDialog,
    getActiveConfirmDialog,
    getActiveConfirmDialog,
  );
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (request) cancelButtonRef.current?.focus({ preventScroll: true });
  }, [request?.id]);

  if (!request) return null;

  return (
    <AlertDialog
      open
      onOpenChange={(open, details) => {
        if (!open) details.cancel();
      }}
    >
      <AlertDialogContent
        initialFocus={cancelButtonRef}
        finalFocus={false}
        data-intent={request.intent}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{request.title}</AlertDialogTitle>
          {request.description !== undefined ? (
            <AlertDialogDescription>{request.description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            ref={cancelButtonRef}
            type="button"
            variant="outline"
            onClick={() => settleConfirmation(false)}
          >
            {request.cancelLabel}
          </Button>
          <AlertDialogAction
            type="button"
            className={confirmButtonClassNames[request.intent]}
            onClick={() => settleConfirmation(true)}
          >
            {request.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
