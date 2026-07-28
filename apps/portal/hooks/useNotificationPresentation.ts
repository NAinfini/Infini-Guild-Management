import { notifications } from "@mantine/notifications";
import type { PushMessage } from "@guild/shared";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNotificationStore } from "../stores/notifications";

type UseNotificationPresentationOptions = {
  enabled?: boolean;
  showToast?: boolean;
};

type PushSignalPayload = {
  key: string;
  titleKey: string;
  message: string;
  color: "blue" | "yellow";
};

const SIGNAL_DEDUPE_MS = 10_000;

function resolveHintMessage(hint: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const key = `notification.hint.${hint}`;
  const translated = t(key, { defaultValue: "" });
  if (translated && translated !== key) return translated;
  return hint.replace(/_/g, " ");
}

function resolveSignalPayload(message: PushMessage, t: (key: string, options?: Record<string, unknown>) => string): PushSignalPayload | null {
  if (message.type === "announcement_published") {
    return {
      key: `announcement:${message.announcement_id}`,
      titleKey: "notification.type.announcement",
      message: message.title,
      color: "blue",
    };
  }

  if (message.type === "entity_changed") {
    const hint = message.hint;

    if (message.entity_type === "announcement" && hint === "announcement_created") {
      return {
        key: `announcement:${message.entity_id}:${hint}`,
        titleKey: "notification.type.announcement",
        message: resolveHintMessage(hint, t),
        color: "blue",
      };
    }

    if (message.entity_type === "event" && hint === "event_created") {
      return {
        key: `event:${message.entity_id}:${hint}`,
        titleKey: "notification.type.eventReminder",
        message: resolveHintMessage(hint, t),
        color: "yellow",
      };
    }

    if (message.entity_type === "wiki" && hint === "article_created") {
      return {
        key: `wiki:${message.entity_id}:${hint}`,
        titleKey: "notification.type.wiki",
        message: resolveHintMessage(hint, t),
        color: "blue",
      };
    }

    if (message.entity_type === "member_profile" && hint === "member_joined") {
      return {
        key: `member:${message.entity_id}:${hint}`,
        titleKey: "notification.type.memberOnline",
        message: resolveHintMessage(hint, t),
        color: "yellow",
      };
    }
  }

  return null;
}

export function useNotificationPresentation(options: UseNotificationPresentationOptions = {}) {
  const enabled = options.enabled ?? true;
  const showToast = options.showToast ?? true;
  const { t } = useTranslation("common");
  const signalSequence = useNotificationStore((state) => state.signalSequence);
  const lastSignalMessage = useNotificationStore((state) => state.lastSignalMessage);
  const suppressed = useNotificationStore((state) => state.suppressed);
  const lastSignalRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!enabled || suppressed || !lastSignalMessage || signalSequence <= 0) {
      return;
    }

    const payload = resolveSignalPayload(lastSignalMessage, t);
    if (!payload) {
      return;
    }

    const now = Date.now();
    const lastSignalAt = lastSignalRef.current.get(payload.key) ?? 0;
    if (now - lastSignalAt < SIGNAL_DEDUPE_MS) {
      return;
    }
    lastSignalRef.current.set(payload.key, now);

    if (showToast) {
      notifications.show({
        color: payload.color,
        title: t(payload.titleKey),
        message: payload.message,
      });
    }
  }, [enabled, lastSignalMessage, showToast, signalSequence, suppressed, t]);
}


