import type { MemberProfile, User } from "@guild/shared";
import type { QueryClient } from "@tanstack/react-query";
import { apiRequest, isApiRequestError, resetApiSessionCache } from "./api/client";
import { useAuthStore } from "./stores/auth";
import { useGuildWarStore } from "./stores/guildWar";

export type PortalSession = {
  user: User;
  profile: MemberProfile;
  session_scope: "normal" | "password_change";
};

type SessionSignal = {
  id: string;
  action: "login" | "logout";
};

export const AUTH_SESSION_STORAGE_KEY = "portal:auth-session-transition";

function writeSessionSignal(action: SessionSignal["action"]): void {
  if (typeof window === "undefined") return;
  try {
    const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
    window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify({ id, action } satisfies SessionSignal));
  } catch {
    // The current tab is already transitioned; cross-tab sync is best effort when storage is disabled.
  }
}

function parseSessionSignal(raw: string | null): SessionSignal | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SessionSignal>;
    if (typeof parsed.id !== "string" || (parsed.action !== "login" && parsed.action !== "logout")) {
      return null;
    }
    return { id: parsed.id, action: parsed.action };
  } catch {
    return null;
  }
}

export function transitionSession(
  queryClient: QueryClient,
  session: PortalSession | null,
  options: { broadcast?: boolean } = {},
): void {
  resetApiSessionCache();
  queryClient.clear();
  useGuildWarStore.getState().resetSessionState();
  if (session) {
    useAuthStore.getState().setSession(session.user, session.profile, session.session_scope);
  } else {
    useAuthStore.getState().clearSession();
  }
  if (options.broadcast !== false) {
    writeSessionSignal(session ? "login" : "logout");
  }
}

type SessionSynchronizationOptions = {
  queryClient: QueryClient;
  requestSession?: () => Promise<PortalSession>;
  onSessionChange?: (session: PortalSession | null) => void;
};

export function installSessionSynchronization({
  queryClient,
  requestSession = () => apiRequest<PortalSession>("/api/auth/me"),
  onSessionChange,
}: SessionSynchronizationOptions): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handledSignals = new Set<string>();

  const onStorage = (event: StorageEvent) => {
    if (event.key !== AUTH_SESSION_STORAGE_KEY) return;
    const signal = parseSessionSignal(event.newValue);
    if (!signal || handledSignals.has(signal.id)) return;
    handledSignals.add(signal.id);

    if (signal.action === "logout") {
      transitionSession(queryClient, null, { broadcast: false });
      onSessionChange?.(null);
      return;
    }

    resetApiSessionCache();
    void requestSession()
      .then((session) => {
        transitionSession(queryClient, session, { broadcast: false });
        onSessionChange?.(session);
      })
      .catch((error: unknown) => {
        if (isApiRequestError(error) && error.status === 401) {
          transitionSession(queryClient, null, { broadcast: false });
          onSessionChange?.(null);
        }
      });
  };

  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export async function revalidateSessionSnapshot(
  queryClient: QueryClient,
  requestSession: () => Promise<PortalSession> = () => apiRequest<PortalSession>("/api/auth/me"),
): Promise<PortalSession | null> {
  if (!useAuthStore.getState().user) return null;
  try {
    const session = await requestSession();
    const currentUserId = useAuthStore.getState().user?.id;
    if (currentUserId === session.user.id) {
      useAuthStore.getState().setSession(session.user, session.profile, session.session_scope);
    } else {
      transitionSession(queryClient, session);
    }
    return session;
  } catch (error) {
    if (isApiRequestError(error) && error.status === 401) {
      if (useAuthStore.getState().user) transitionSession(queryClient, null);
      return null;
    }
    throw error;
  }
}
