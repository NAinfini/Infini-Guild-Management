import type { MemberProfile, User } from "@guild/shared";
import type { QueryClient } from "@tanstack/react-query";
import i18n from "i18next";
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
const SESSION_COOKIE_LOCK = "portal:auth-session-cookie";

type SessionRequest = { isCurrent: () => boolean };
let pendingSessionMutation: SessionRequest | null = null;

export function getSessionSnapshot(): PortalSession | null {
  const { user, profile, sessionScope } = useAuthStore.getState();
  return user && profile && sessionScope ? { user, profile, session_scope: sessionScope } : null;
}

export function captureSessionRequest(): SessionRequest {
  const revision = useAuthStore.getState().sessionRevision;
  return { isCurrent: () => useAuthStore.getState().sessionRevision === revision };
}

function beginSessionRequest(): SessionRequest {
  useAuthStore.getState().advanceSessionRevision();
  return captureSessionRequest();
}

async function withSessionCookieLock<T>(callback: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    throw new Error(i18n.t("common:errors.sessionCoordinationUnavailable", {
      defaultValue: "Sign-in requires HTTPS and an up-to-date browser. Open the secure site and try again.",
    }));
  }
  // Keep the cookie response, local state and broadcast in one cross-tab critical section.
  return navigator.locks.request(SESSION_COOKIE_LOCK, callback);
}

export async function authenticateSession(
  queryClient: QueryClient,
  requestSession: () => Promise<PortalSession>,
): Promise<(SessionRequest & { session: PortalSession }) | null> {
  const request = beginSessionRequest();
  pendingSessionMutation = request;
  try {
    return await withSessionCookieLock(async () => {
      if (!request.isCurrent()) return null;
      const session = await requestSession();
      if (!request.isCurrent()) return null;
      transitionSession(queryClient, session);
      return { session, ...captureSessionRequest() };
    });
  } catch (error) {
    if (!request.isCurrent()) return null;
    throw error;
  } finally {
    if (pendingSessionMutation === request) pendingSessionMutation = null;
  }
}

export async function logoutSession(
  queryClient: QueryClient,
  requestLogout: () => Promise<unknown>,
): Promise<void> {
  // Expire pending responses before the sign-out network round trip.
  transitionSession(queryClient, null, { broadcast: false });
  const request = captureSessionRequest();
  pendingSessionMutation = request;
  try {
    await withSessionCookieLock(async () => {
      if (!request.isCurrent()) return;
      try {
        await requestLogout();
      } finally {
        if (request.isCurrent()) writeSessionSignal("logout");
      }
    });
  } catch (error) {
    if (request.isCurrent()) throw error;
  } finally {
    if (pendingSessionMutation === request) pendingSessionMutation = null;
  }
}

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
    useAuthStore.getState().setSession(session.user, session.profile, session.session_scope, true);
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
  let active = true;

  const onStorage = (event: StorageEvent) => {
    if (event.key !== AUTH_SESSION_STORAGE_KEY) return;
    const signal = parseSessionSignal(event.newValue);
    if (!signal || handledSignals.has(signal.id)) return;
    handledSignals.add(signal.id);

    // A local cookie write holds or awaits the same lock; its completion follows this signal.
    if (pendingSessionMutation?.isCurrent()) return;
    if (signal.action === "logout") {
      transitionSession(queryClient, null, { broadcast: false });
      onSessionChange?.(null);
      return;
    }

    const request = beginSessionRequest();
    resetApiSessionCache();
    void requestSession()
      .then((session) => {
        if (!active || !request.isCurrent()) return;
        transitionSession(queryClient, session, { broadcast: false });
        onSessionChange?.(session);
      })
      .catch((error: unknown) => {
        if (!active || !request.isCurrent()) return;
        if (isApiRequestError(error) && error.status === 401) {
          transitionSession(queryClient, null, { broadcast: false });
          onSessionChange?.(null);
        }
      });
  };

  window.addEventListener("storage", onStorage);
  return () => {
    active = false;
    window.removeEventListener("storage", onStorage);
  };
}

export async function resolveSessionSnapshot(
  queryClient: QueryClient,
  requestSession: () => Promise<PortalSession> = () => apiRequest<PortalSession>("/api/auth/me"),
  options: { broadcast?: boolean } = {},
): Promise<PortalSession | null> {
  if (pendingSessionMutation?.isCurrent()) return getSessionSnapshot();
  const request = beginSessionRequest();
  try {
    const session = await requestSession();
    if (!request.isCurrent()) return getSessionSnapshot();
    const currentUserId = useAuthStore.getState().user?.id;
    if (currentUserId === session.user.id) {
      useAuthStore.getState().setSession(session.user, session.profile, session.session_scope);
    } else {
      transitionSession(queryClient, session, options);
    }
    return session;
  } catch (error) {
    if (!request.isCurrent()) return getSessionSnapshot();
    if (isApiRequestError(error) && error.status === 401) {
      transitionSession(queryClient, null, options);
      return null;
    }
    throw error;
  }
}

export function revalidateSessionSnapshot(
  queryClient: QueryClient,
  requestSession?: () => Promise<PortalSession>,
): Promise<PortalSession | null> {
  if (!useAuthStore.getState().user) return Promise.resolve(null);
  return resolveSessionSnapshot(queryClient, requestSession);
}
