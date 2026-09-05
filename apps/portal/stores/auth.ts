import type { MemberProfile, User } from "@guild/shared";
import { create } from "zustand";

type AuthState = {
  user: User | null;
  profile: MemberProfile | null;
  sessionScope: "normal" | "password_change" | null;
  sessionResolved: boolean;
  sessionRevision: number;
  sessionKey: number;
  advanceSessionRevision: () => void;
  setSession: (user: User, profile: MemberProfile, sessionScope: "normal" | "password_change", newSession?: boolean) => void;
  clearSession: () => void;
  markSessionResolved: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  sessionScope: null,
  sessionResolved: false,
  sessionRevision: 0,
  sessionKey: 0,
  advanceSessionRevision: () => set((state) => ({ sessionRevision: state.sessionRevision + 1 })),
  setSession: (user, profile, sessionScope, newSession = false) => set((state) => ({
    user, profile, sessionScope, sessionResolved: true, sessionRevision: state.sessionRevision + 1,
    // Ordinary /me and profile refreshes keep the existing transport connection.
    sessionKey: state.sessionKey + Number(newSession || state.user?.id !== user.id || state.sessionScope !== sessionScope),
  })),
  clearSession: () => set((state) => ({
    user: null, profile: null, sessionScope: null, sessionResolved: true, sessionRevision: state.sessionRevision + 1,
    sessionKey: state.sessionKey + 1,
  })),
  markSessionResolved: () => set({ sessionResolved: true }),
}));
