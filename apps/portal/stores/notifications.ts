import type { PushMessage } from "@guild/shared";
import i18n from "i18next";
import { create } from "zustand";
import { isIsoDate, toIsoOrNow } from "../utils/iso-dates";

export type NotificationFeature = "announcements" | "members";

type FeatureState = {
  lastSeenAt: string;
  latestUpdatedAt: string | null;
  hasNew: boolean;
};

type FeatureMap = Record<NotificationFeature, FeatureState>;

type PushNotificationEntryType = "announcement_published" | "member_online" | "event_changed" | "wiki_changed" | "member_joined";

type PushNotificationEntry = {
  id: string;
  type: PushNotificationEntryType;
  title: string;
  message: string;
  occurredAt: string;
  readAt: string | null;
};

const FEATURE_STORAGE_KEY = "portal:last_seen";
const PUSH_STORAGE_KEY = "portal:push-notification-center";
const MAX_PUSH_ENTRIES = 80;
const FEATURES: NotificationFeature[] = ["announcements", "members"];
const ENTRY_TYPES: PushNotificationEntryType[] = ["announcement_published", "member_online", "event_changed", "wiki_changed", "member_joined"];

function emptyFeatureState(lastSeenAt?: string): FeatureState {
  return {
    lastSeenAt: toIsoOrNow(lastSeenAt),
    latestUpdatedAt: null,
    hasNew: false,
  };
}

function parseFeatureState(raw: string | null): FeatureMap {
  if (!raw) {
    return {
      announcements: emptyFeatureState(),
      members: emptyFeatureState(),
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Record<NotificationFeature, { lastSeenAt?: string }>>;
    return {
      announcements: emptyFeatureState(parsed.announcements?.lastSeenAt),
      members: emptyFeatureState(parsed.members?.lastSeenAt),
    };
  } catch {
    return {
      announcements: emptyFeatureState(),
      members: emptyFeatureState(),
    };
  }
}

function readFeatureState(): FeatureMap {
  if (typeof window === "undefined") {
    return {
      announcements: emptyFeatureState(),
      members: emptyFeatureState(),
    };
  }

  return parseFeatureState(window.localStorage.getItem(FEATURE_STORAGE_KEY));
}

function persistFeatureState(state: FeatureMap): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      FEATURE_STORAGE_KEY,
      JSON.stringify({
        announcements: { lastSeenAt: state.announcements.lastSeenAt },
        members: { lastSeenAt: state.members.lastSeenAt },
      }),
    );
  } catch {
    // Keep in-memory state if storage is unavailable.
  }
}

function isPushEntryType(value: unknown): value is PushNotificationEntryType {
  return typeof value === "string" && ENTRY_TYPES.includes(value as PushNotificationEntryType);
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeUnknownIso(value: unknown): string {
  if (typeof value === "string" && isIsoDate(value)) {
    return value;
  }
  return nowIso();
}

function sanitizePushEntries(raw: unknown): PushNotificationEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: PushNotificationEntry[] = [];
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const value = candidate as Partial<PushNotificationEntry>;
    if (
      typeof value.id !== "string" ||
      !isPushEntryType(value.type) ||
      typeof value.title !== "string" ||
      typeof value.message !== "string"
    ) {
      continue;
    }

    entries.push({
      id: value.id,
      type: value.type,
      title: value.title,
      message: value.message,
      occurredAt: sanitizeUnknownIso(value.occurredAt),
      readAt: typeof value.readAt === "string" && isIsoDate(value.readAt) ? value.readAt : null,
    });

    if (entries.length >= MAX_PUSH_ENTRIES) {
      break;
    }
  }

  return entries;
}

function readPushHistory(): PushNotificationEntry[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(PUSH_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    return sanitizePushEntries(JSON.parse(raw));
  } catch {
    return [];
  }
}

function persistPushHistory(entries: PushNotificationEntry[]): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(PUSH_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Keep in-memory state if storage is unavailable.
  }
}

function isNewerThanLastSeen(lastSeenAt: string, latestUpdatedAt: string | null): boolean {
  if (!latestUpdatedAt || !isIsoDate(lastSeenAt)) {
    return false;
  }
  return Date.parse(latestUpdatedAt) > Date.parse(lastSeenAt);
}

function createEntryFromPush(message: PushMessage): PushNotificationEntry | null {
  if (message.type === "announcement_published") {
    return {
      id: `announcement:${message.announcement_id}`,
      type: "announcement_published",
      title: i18n.t("common:notification.title.announcement_published", { defaultValue: "Announcement Published" }),
      message: message.title,
      occurredAt: sanitizeUnknownIso(message.published_at),
      readAt: null,
    };
  }

  if (message.type === "entity_changed") {
    const occurredAt = sanitizeUnknownIso(message.updated_at);
    if (message.entity_type === "wiki" && message.hint === "article_created") {
      return {
        id: `wiki:${message.entity_id}:${message.hint}`,
        type: "wiki_changed",
        title: i18n.t("common:notification.title.article_created", { defaultValue: "New Wiki Article" }),
        message: i18n.t("common:notification.hint.article_created"),
        occurredAt,
        readAt: null,
      };
    }
    if (message.entity_type === "member_profile" && message.hint === "member_joined") {
      const name = message.display_name;
      return {
        id: `member:${message.entity_id}:${message.hint}`,
        type: "member_joined",
        title: i18n.t("common:notification.hint.member_joined"),
        message: name
          ? i18n.t("common:notification.member_joined_message", { name, defaultValue: "{{name}} joined the guild" })
          : i18n.t("common:notification.hint.member_joined"),
        occurredAt,
        readAt: null,
      };
    }
  }

  return null;
}

type NotificationStore = {
  features: FeatureMap;
  pushHistory: PushNotificationEntry[];
  wsConnected: boolean;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  signalSequence: number;
  lastSignalMessage: PushMessage | null;
  suppressed: boolean;
  setFeatureLatest: (feature: NotificationFeature, latestUpdatedAt: string | null) => void;
  setFeatureLatestBatch: (latest: Partial<Record<NotificationFeature, string | null>>) => void;
  markFeatureAsRead: (feature: NotificationFeature) => void;
  markAllFeaturesAsRead: () => void;
  appendPushMessage: (message: PushMessage) => void;
  markPushAsRead: (entryId: string) => void;
  markAllPushAsRead: () => void;
  clearPushHistory: () => void;
  setWsConnected: (connected: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setLastSyncedAt: (value: string | null) => void;
  setSuppressed: (suppressed: boolean) => void;
  resetNotifications: () => void;
};

const initialFeatureState = readFeatureState();
const initialPushHistory = readPushHistory();

export const useNotificationStore = create<NotificationStore>((set) => ({
  features: initialFeatureState,
  pushHistory: initialPushHistory,
  wsConnected: false,
  isSyncing: false,
  lastSyncedAt: null,
  signalSequence: 0,
  lastSignalMessage: null,
  suppressed: false,
  setFeatureLatest: (feature, latestUpdatedAt) =>
    set((state) => {
      const nextFeatures: FeatureMap = {
        ...state.features,
        [feature]: {
          ...state.features[feature],
          latestUpdatedAt,
          hasNew: isNewerThanLastSeen(state.features[feature].lastSeenAt, latestUpdatedAt),
        },
      };
      persistFeatureState(nextFeatures);
      return { features: nextFeatures };
    }),
  setFeatureLatestBatch: (latest) =>
    set((state) => {
      const nextFeatures: FeatureMap = {
        announcements: { ...state.features.announcements },
        members: { ...state.features.members },
      };
      for (const feature of FEATURES) {
        if (!(feature in latest)) {
          continue;
        }
        const latestUpdatedAt = latest[feature] ?? null;
        nextFeatures[feature] = {
          ...nextFeatures[feature],
          latestUpdatedAt,
          hasNew: isNewerThanLastSeen(nextFeatures[feature].lastSeenAt, latestUpdatedAt),
        };
      }
      persistFeatureState(nextFeatures);
      return { features: nextFeatures };
    }),
  markFeatureAsRead: (feature) =>
    set((state) => {
      const nextSeenAt = state.features[feature].latestUpdatedAt ?? nowIso();
      const nextFeatures: FeatureMap = {
        ...state.features,
        [feature]: {
          ...state.features[feature],
          lastSeenAt: nextSeenAt,
          hasNew: false,
        },
      };
      persistFeatureState(nextFeatures);
      return { features: nextFeatures };
    }),
  markAllFeaturesAsRead: () =>
    set((state) => {
      const nextFeatures: FeatureMap = {
        announcements: { ...state.features.announcements },
        members: { ...state.features.members },
      };
      for (const feature of FEATURES) {
        nextFeatures[feature].lastSeenAt = nextFeatures[feature].latestUpdatedAt ?? nowIso();
        nextFeatures[feature].hasNew = false;
      }
      persistFeatureState(nextFeatures);
      return { features: nextFeatures };
    }),
  appendPushMessage: (message) =>
    set((state) => {
      if (state.suppressed) return state;
      const nextEntry = createEntryFromPush(message);
      const nextSignalSequence = state.signalSequence + 1;
      if (!nextEntry) {
        return {
          signalSequence: nextSignalSequence,
          lastSignalMessage: message,
        };
      }

      const existingIndex = state.pushHistory.findIndex((entry) => entry.id === nextEntry.id);
      const nextHistory =
        existingIndex >= 0
          ? (() => {
              const updated = [...state.pushHistory];
              const existing = updated[existingIndex];
              if (!existing) {
                return [nextEntry, ...state.pushHistory].slice(0, MAX_PUSH_ENTRIES);
              }
              updated[existingIndex] = {
                ...existing,
                ...nextEntry,
                readAt: null,
              };
              updated.sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
              return updated.slice(0, MAX_PUSH_ENTRIES);
            })()
          : [nextEntry, ...state.pushHistory].slice(0, MAX_PUSH_ENTRIES);

      persistPushHistory(nextHistory);
      return {
        pushHistory: nextHistory,
        signalSequence: nextSignalSequence,
        lastSignalMessage: message,
      };
    }),
  markPushAsRead: (entryId) =>
    set((state) => {
      const nextReadAt = nowIso();
      const nextHistory = state.pushHistory.map((entry) =>
        entry.id === entryId && entry.readAt === null
          ? {
              ...entry,
              readAt: nextReadAt,
            }
          : entry,
      );
      persistPushHistory(nextHistory);
      return { pushHistory: nextHistory };
    }),
  markAllPushAsRead: () =>
    set((state) => {
      const nextReadAt = nowIso();
      const nextHistory = state.pushHistory.map((entry) =>
        entry.readAt === null
          ? {
              ...entry,
              readAt: nextReadAt,
            }
          : entry,
      );
      persistPushHistory(nextHistory);
      return { pushHistory: nextHistory };
    }),
  clearPushHistory: () => {
    persistPushHistory([]);
    set({ pushHistory: [] });
  },
  setWsConnected: (connected) => set({ wsConnected: connected }),
  setSyncing: (syncing) => set({ isSyncing: syncing }),
  setLastSyncedAt: (value) => set({ lastSyncedAt: value }),
  setSuppressed: (suppressed) => set({ suppressed }),
  resetNotifications: () => {
    const nextFeatures = {
      announcements: emptyFeatureState(),
      members: emptyFeatureState(),
    };
    persistFeatureState(nextFeatures);
    persistPushHistory([]);
    set({
      features: nextFeatures,
      pushHistory: [],
      wsConnected: false,
      isSyncing: false,
      lastSyncedAt: null,
      signalSequence: 0,
      lastSignalMessage: null,
      suppressed: false,
    });
  },
}));
