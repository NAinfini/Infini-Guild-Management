import type { PushMessage } from "@guild/shared";
import i18n from "i18next";
import { create } from "zustand";
import { isIsoDate, toIsoOrNow } from "../utils/datetime";
import { userScopedStorageKey } from "../session-storage";

export type NotificationFeature = "announcements" | "members";

type FeatureState = {
  lastSeenAt: string;
  latestUpdatedAt: string | null;
  hasNew: boolean;
};

type FeatureMap = Record<NotificationFeature, FeatureState>;

type PushNotificationEntryType =
  | "announcement_published"
  | "announcement_created"
  | "event_created"
  | "wiki_created"
  | "member_joined";

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
const ENTRY_TYPES: PushNotificationEntryType[] = [
  "announcement_published",
  "announcement_created",
  "event_created",
  "wiki_created",
  "member_joined",
];

export function notificationStorageKeys(userId: string | null) {
  return {
    features: userScopedStorageKey(FEATURE_STORAGE_KEY, userId),
    push: userScopedStorageKey(PUSH_STORAGE_KEY, userId),
  };
}

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Keep in-memory state if storage is unavailable.
  }
}

function removeStorage(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage is optional.
  }
}

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

function readFeatureState(userId: string | null): FeatureMap {
  const keys = notificationStorageKeys(userId);
  return parseFeatureState(readStorage(keys.features));
}

function persistFeatureState(userId: string | null, state: FeatureMap): void {
  const keys = notificationStorageKeys(userId);
  const stored = parseFeatureState(readStorage(keys.features));
  const latestSeen = (left: string, right: string) => Date.parse(left) >= Date.parse(right) ? left : right;
  writeStorage(
    keys.features,
    JSON.stringify({
      announcements: { lastSeenAt: latestSeen(stored.announcements.lastSeenAt, state.announcements.lastSeenAt) },
      members: { lastSeenAt: latestSeen(stored.members.lastSeenAt, state.members.lastSeenAt) },
    }),
  );
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

function mergePushHistories(...histories: PushNotificationEntry[][]): PushNotificationEntry[] {
  const byId = new Map<string, PushNotificationEntry>();
  for (const history of histories) {
    for (const entry of history) {
      const existing = byId.get(entry.id);
      if (!existing || Date.parse(entry.occurredAt) > Date.parse(existing.occurredAt)) {
        byId.set(entry.id, entry);
        continue;
      }
      if (entry.occurredAt === existing.occurredAt && entry.readAt && !existing.readAt) {
        byId.set(entry.id, { ...existing, readAt: entry.readAt });
      }
    }
  }
  return [...byId.values()]
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, MAX_PUSH_ENTRIES);
}

function readPushHistory(userId: string | null): PushNotificationEntry[] {
  const keys = notificationStorageKeys(userId);
  const raw = readStorage(keys.push);
  if (!raw) return [];
  try {
    return sanitizePushEntries(JSON.parse(raw));
  } catch {
    return [];
  }
}

function persistPushHistory(userId: string | null, entries: PushNotificationEntry[]): void {
  const keys = notificationStorageKeys(userId);
  writeStorage(keys.push, JSON.stringify(entries));
}

function isNewerThanLastSeen(lastSeenAt: string, latestUpdatedAt: string | null): boolean {
  if (!latestUpdatedAt || !isIsoDate(lastSeenAt)) {
    return false;
  }
  return Date.parse(latestUpdatedAt) > Date.parse(lastSeenAt);
}

function resolveHintText(hint: string): string {
  const key = `common:notification.hint.${hint}`;
  const translated = i18n.t(key, { defaultValue: "" });
  if (translated && translated !== key) return translated;
  return hint.replace(/_/g, " ");
}

function translateNotificationText(
  key: string,
  fallback: string,
  values: Record<string, string> = {},
): string {
  const translated = i18n.t(key, { ...values, defaultValue: fallback });
  return typeof translated === "string" && translated.length > 0 ? translated : fallback;
}

function createEntryFromPush(message: PushMessage): PushNotificationEntry | null {
  if (message.type === "announcement_published") {
    return {
      id: `announcement:${message.announcement_id}`,
      type: "announcement_published",
      title: translateNotificationText("common:notification.title.announcement_published", "Announcement Published"),
      message: message.title,
      occurredAt: sanitizeUnknownIso(message.published_at),
      readAt: null,
    };
  }

  if (message.type !== "entity_changed") return null;

  const occurredAt = sanitizeUnknownIso(message.updated_at);
  const hint = message.hint;

  if (message.entity_type === "announcement" && hint === "announcement_created") {
    return {
      id: `announcement:${message.entity_id}:${hint}`,
      type: "announcement_created",
      title: translateNotificationText("common:notification.title.announcement_created", "Announcement Created"),
      message: resolveHintText(hint),
      occurredAt,
      readAt: null,
    };
  }

  if (message.entity_type === "event" && hint === "event_created") {
    return {
      id: `event:${message.entity_id}:${hint}`,
      type: "event_created",
      title: translateNotificationText("common:notification.title.event_created", "Event Created"),
      message: message.display_name
        ? translateNotificationText("common:notification.event_created_message", message.display_name, { name: message.display_name })
        : resolveHintText(hint),
      occurredAt,
      readAt: null,
    };
  }

  if (message.entity_type === "wiki" && hint === "article_created") {
    return {
      id: `wiki:${message.entity_id}:${hint}`,
      type: "wiki_created",
      title: translateNotificationText("common:notification.title.article_created", "Article Created"),
      message: resolveHintText(hint),
      occurredAt,
      readAt: null,
    };
  }

  if (message.entity_type === "member_profile" && hint === "member_joined") {
    const name = message.display_name;
    return {
      id: `member:${message.entity_id}:${hint}`,
      type: "member_joined",
      title: translateNotificationText("common:notification.hint.member_joined", "Member Joined"),
      message: name
        ? translateNotificationText("common:notification.member_joined_message", `${name} joined the guild`, { name })
        : translateNotificationText("common:notification.hint.member_joined", "Member joined"),
      occurredAt,
      readAt: null,
    };
  }

  return null;
}

type NotificationStore = {
  identityUserId: string | null;
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
  setIdentity: (userId: string | null) => void;
  resetNotifications: () => void;
};

const initialFeatureState = readFeatureState(null);
const initialPushHistory = readPushHistory(null);

export const useNotificationStore = create<NotificationStore>((set) => ({
  identityUserId: null,
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
      persistFeatureState(state.identityUserId, nextFeatures);
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
      persistFeatureState(state.identityUserId, nextFeatures);
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
      persistFeatureState(state.identityUserId, nextFeatures);
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
      persistFeatureState(state.identityUserId, nextFeatures);
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

      const currentHistory = mergePushHistories(state.pushHistory, readPushHistory(state.identityUserId));
      const existingIndex = currentHistory.findIndex((entry) => entry.id === nextEntry.id);
      const nextHistory =
        existingIndex >= 0
          ? (() => {
              const updated = [...currentHistory];
              const existing = updated[existingIndex];
              if (!existing) {
                return [nextEntry, ...currentHistory].slice(0, MAX_PUSH_ENTRIES);
              }
              updated[existingIndex] = {
                ...existing,
                ...nextEntry,
                readAt: null,
              };
              updated.sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
              return updated.slice(0, MAX_PUSH_ENTRIES);
            })()
          : [nextEntry, ...currentHistory].slice(0, MAX_PUSH_ENTRIES);

      persistPushHistory(state.identityUserId, nextHistory);
      return {
        pushHistory: nextHistory,
        signalSequence: nextSignalSequence,
        lastSignalMessage: message,
      };
    }),
  markPushAsRead: (entryId) =>
    set((state) => {
      const nextReadAt = nowIso();
      const currentHistory = mergePushHistories(state.pushHistory, readPushHistory(state.identityUserId));
      const nextHistory = currentHistory.map((entry) =>
        entry.id === entryId && entry.readAt === null
          ? {
              ...entry,
              readAt: nextReadAt,
            }
          : entry,
      );
      persistPushHistory(state.identityUserId, nextHistory);
      return { pushHistory: nextHistory };
    }),
  markAllPushAsRead: () =>
    set((state) => {
      const nextReadAt = nowIso();
      const currentHistory = mergePushHistories(state.pushHistory, readPushHistory(state.identityUserId));
      const nextHistory = currentHistory.map((entry) =>
        entry.readAt === null
          ? {
              ...entry,
              readAt: nextReadAt,
            }
          : entry,
      );
      persistPushHistory(state.identityUserId, nextHistory);
      return { pushHistory: nextHistory };
    }),
  clearPushHistory: () => {
    set((state) => {
      persistPushHistory(state.identityUserId, []);
      return { pushHistory: [] };
    });
  },
  setWsConnected: (connected) => set({ wsConnected: connected }),
  setSyncing: (syncing) => set({ isSyncing: syncing }),
  setLastSyncedAt: (value) => set({ lastSyncedAt: value }),
  setSuppressed: (suppressed) => set({ suppressed }),
  setIdentity: (identityUserId) => set({
    identityUserId,
    features: readFeatureState(identityUserId),
    pushHistory: readPushHistory(identityUserId),
    wsConnected: false,
    isSyncing: false,
    lastSyncedAt: null,
    signalSequence: 0,
    lastSignalMessage: null,
    suppressed: false,
  }),
  resetNotifications: () => set((state) => {
    const nextFeatures = {
      announcements: emptyFeatureState(),
      members: emptyFeatureState(),
    };
    const keys = notificationStorageKeys(state.identityUserId);
    removeStorage(keys.features);
    removeStorage(keys.push);
    return {
      features: nextFeatures,
      pushHistory: [],
      wsConnected: false,
      isSyncing: false,
      lastSyncedAt: null,
      signalSequence: 0,
      lastSignalMessage: null,
      suppressed: false,
    };
  }),
}));

export function synchronizeNotificationStorage(event: StorageEvent): void {
  const state = useNotificationStore.getState();
  const keys = notificationStorageKeys(state.identityUserId);
  if (event.key === keys.features) {
    const stored = readFeatureState(state.identityUserId);
    const features: FeatureMap = {
      announcements: {
        ...stored.announcements,
        latestUpdatedAt: state.features.announcements.latestUpdatedAt,
        hasNew: isNewerThanLastSeen(stored.announcements.lastSeenAt, state.features.announcements.latestUpdatedAt),
      },
      members: {
        ...stored.members,
        latestUpdatedAt: state.features.members.latestUpdatedAt,
        hasNew: isNewerThanLastSeen(stored.members.lastSeenAt, state.features.members.latestUpdatedAt),
      },
    };
    useNotificationStore.setState({ features });
  } else if (event.key === keys.push) {
    useNotificationStore.setState({ pushHistory: readPushHistory(state.identityUserId) });
  }
}
