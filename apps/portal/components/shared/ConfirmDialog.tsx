import { Button, Group, Modal } from "@mantine/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./ConfirmDialog.css";

export type ConfirmDialogIntent = "neutral" | "warning" | "danger";

export type ConfirmDialogOptions = {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  intent?: ConfirmDialogIntent;
};

type ConfirmDialogRequest = {
  options: ConfirmDialogOptions;
  resolve: (accepted: boolean) => void;
  inlineTarget: HTMLElement | null;
  returnFocus: HTMLElement | null;
};

export type ConfirmDialogRequestFn = (
  options: ConfirmDialogOptions,
) => Promise<boolean>;

const missingProvider: ConfirmDialogRequestFn = () => {
  throw new Error("useConfirmDialog must be used within ConfirmDialogProvider");
};

const ConfirmDialogContext = createContext<ConfirmDialogRequestFn>(missingProvider);

const OVERLAY_CONTENT_SELECTOR =
  ".mantine-Modal-content, .mantine-Drawer-content";

function findOpenOverlayContent(): HTMLElement | null {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement) {
    const focusedOverlay = focused.closest<HTMLElement>(OVERLAY_CONTENT_SELECTOR);
    if (focusedOverlay) return focusedOverlay;
  }

  const openOverlays = Array.from(
    document.querySelectorAll<HTMLElement>(OVERLAY_CONTENT_SELECTOR),
  ).filter((overlay) => overlay.isConnected && getComputedStyle(overlay).display !== "none");
  return openOverlays.at(-1) ?? null;
}

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

type ConfirmDialogProps = {
  request: ConfirmDialogRequest;
  onAccept: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  request,
  onAccept,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const actionSurfaceRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const { options, inlineTarget } = request;
  const intent = options.intent ?? "neutral";
  const confirmColor =
    intent === "danger" ? "red" : intent === "warning" ? "yellow" : "portal-accent";

  const body = (
    <div ref={actionSurfaceRef} className="confirm-dialog__body">
      {options.description ? (
        <div className="confirm-dialog__description">{options.description}</div>
      ) : null}
      <Group className="confirm-dialog__actions" justify="flex-end" wrap="wrap">
        <Button
          ref={cancelButtonRef}
          variant="default"
          onClick={onCancel}
          autoFocus
          data-autofocus
          data-mantine-stop-propagation="true"
        >
          {options.cancelLabel}
        </Button>
        <Button
          color={confirmColor}
          onClick={onAccept}
          data-mantine-stop-propagation="true"
        >
          {options.confirmLabel}
        </Button>
      </Group>
    </div>
  );

  useEffect(() => {
    const focusCancel = () => {
      cancelButtonRef.current?.focus({ preventScroll: true });
    };
    const keepFocusInConfirmation = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && actionSurfaceRef.current?.contains(target)) return;
      focusCancel();
    };

    const focusTimeout = window.setTimeout(focusCancel);
    document.addEventListener("focusin", keepFocusInConfirmation);
    return () => {
      window.clearTimeout(focusTimeout);
      document.removeEventListener("focusin", keepFocusInConfirmation);
    };
  }, [request]);

  useEffect(() => {
    if (!inlineTarget) return;
    inlineTarget.dataset.confirmDialogOpen = "true";
    return () => {
      delete inlineTarget.dataset.confirmDialogOpen;
    };
  }, [inlineTarget]);

  if (inlineTarget) {
    return createPortal(
      <div
        className="confirm-dialog__inline-overlay"
        onKeyDownCapture={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <section
          className="confirm-dialog__inline-surface"
          role="alertdialog"
          aria-labelledby={titleId}
        >
          <h2 id={titleId} className="confirm-dialog__title">
            {options.title}
          </h2>
          {body}
        </section>
      </div>,
      inlineTarget,
    );
  }

  return (
    <Modal
      opened
      onClose={onCancel}
      title={options.title}
      centered
      closeOnClickOutside={false}
      withCloseButton={false}
    >
      {body}
    </Modal>
  );
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmDialogRequest | null>(null);
  const requestRef = useRef<ConfirmDialogRequest | null>(null);

  const settle = useCallback((accepted: boolean) => {
    const current = requestRef.current;
    if (!current) return;
    requestRef.current = null;
    setRequest(null);
    current.resolve(accepted);
    queueMicrotask(() => {
      if (current.returnFocus?.isConnected) current.returnFocus.focus();
    });
  }, []);

  const confirm = useCallback<ConfirmDialogRequestFn>((options) => {
    if (requestRef.current) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
      const focused =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const nextRequest: ConfirmDialogRequest = {
        options,
        resolve,
        inlineTarget: findOpenOverlayContent(),
        returnFocus: findReturnFocusTarget(focused),
      };
      requestRef.current = nextRequest;
      setRequest(nextRequest);
    });
  }, []);

  useEffect(() => {
    return () => {
      requestRef.current?.resolve(false);
      requestRef.current = null;
    };
  }, []);

  useEffect(() => {
    const target = request?.inlineTarget;
    if (!target) return;

    const cancelIfDetached = () => {
      if (!target.isConnected) settle(false);
    };
    const observer = new MutationObserver(cancelIfDetached);
    observer.observe(document.body, { childList: true, subtree: true });
    cancelIfDetached();
    return () => observer.disconnect();
  }, [request, settle]);

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      {request ? (
        <ConfirmDialog
          request={request}
          onAccept={() => settle(true)}
          onCancel={() => settle(false)}
        />
      ) : null}
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog(): ConfirmDialogRequestFn {
  return useContext(ConfirmDialogContext);
}
