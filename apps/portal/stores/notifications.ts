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

const FEATURE_STORAGE_KEY = "portal:last_seen";
const LEGACY_PUSH_STORAGE_KEY = "portal:push-notification-center";
const FEATURES: NotificationFeature[] = ["announcements", "members"];

export function notificationStorageKeys(userId: string | null) {
  return {
    features: userScopedStorageKey(FEATURE_STORAGE_KEY, userId),
  };
}

function legacyPushStorageKey(userId: string | null): string {
  return userScopedStorageKey(LEGACY_PUSH_STORAGE_KEY, userId);
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
    // Feature freshness is advisory when browser storage is unavailable.
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
  return parseFeatureState(readStorage(notificationStorageKeys(userId).features));
}

function persistFeatureState(userId: string | null, state: FeatureMap): void {
  const key = notificationStorageKeys(userId).features;
  const stored = parseFeatureState(readStorage(key));
  const latestSeen = (left: string, right: string) => Date.parse(left) >= Date.parse(right) ? left : right;
  writeStorage(
    key,
    JSON.stringify({
      announcements: { lastSeenAt: latestSeen(stored.announcements.lastSeenAt, state.announcements.lastSeenAt) },
      members: { lastSeenAt: latestSeen(stored.members.lastSeenAt, state.members.lastSeenAt) },
    }),
  );
}

function isNewerThanLastSeen(lastSeenAt: string, latestUpdatedAt: string | null): boolean {
  return Boolean(latestUpdatedAt && isIsoDate(lastSeenAt) && Date.parse(latestUpdatedAt) > Date.parse(lastSeenAt));
}

function nowIso(): string {
  return new Date().toISOString();
}

type NotificationStore = {
  identityUserId: string | null;
  features: FeatureMap;
  wsConnected: boolean;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  suppressed: boolean;
  setFeatureLatest: (feature: NotificationFeature, latestUpdatedAt: string | null) => void;
  setFeatureLatestBatch: (latest: Partial<Record<NotificationFeature, string | null>>) => void;
  markFeatureAsRead: (feature: NotificationFeature) => void;
  markAllFeaturesAsRead: () => void;
  setWsConnected: (connected: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setLastSyncedAt: (value: string | null) => void;
  setSuppressed: (suppressed: boolean) => void;
  setIdentity: (userId: string | null) => void;
  resetNotifications: () => void;
};

export const useNotificationStore = create<NotificationStore>((set) => ({
  identityUserId: null,
  features: readFeatureState(null),
  wsConnected: false,
  isSyncing: false,
  lastSyncedAt: null,
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
        if (!(feature in latest)) continue;
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
      const nextFeatures: FeatureMap = {
        ...state.features,
        [feature]: {
          ...state.features[feature],
          lastSeenAt: state.features[feature].latestUpdatedAt ?? nowIso(),
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
  setWsConnected: (connected) => set({ wsConnected: connected }),
  setSyncing: (syncing) => set({ isSyncing: syncing }),
  setLastSyncedAt: (value) => set({ lastSyncedAt: value }),
  setSuppressed: (suppressed) => set({ suppressed }),
  setIdentity: (identityUserId) => {
    removeStorage(legacyPushStorageKey(identityUserId));
    set({
      identityUserId,
      features: readFeatureState(identityUserId),
      wsConnected: false,
      isSyncing: false,
      lastSyncedAt: null,
      suppressed: false,
    });
  },
  resetNotifications: () => set((state) => {
    const features = {
      announcements: emptyFeatureState(),
      members: emptyFeatureState(),
    };
    removeStorage(notificationStorageKeys(state.identityUserId).features);
    removeStorage(legacyPushStorageKey(state.identityUserId));
    return {
      features,
      wsConnected: false,
      isSyncing: false,
      lastSyncedAt: null,
      suppressed: false,
    };
  }),
}));

export function synchronizeNotificationStorage(event: StorageEvent): void {
  const state = useNotificationStore.getState();
  if (event.key !== notificationStorageKeys(state.identityUserId).features) return;

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
}
