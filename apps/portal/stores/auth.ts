import type { MemberProfile, User } from "@guild/shared";
import { create } from "zustand";

type AuthState = {
  user: User | null;
  profile: MemberProfile | null;
  sessionScope: "normal" | "password_change" | null;
  sessionResolved: boolean;
  setSession: (user: User, profile: MemberProfile, sessionScope: "normal" | "password_change") => void;
  setProfile: (profile: MemberProfile) => void;
  clearSession: () => void;
  markSessionResolved: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  sessionScope: null,
  sessionResolved: false,
  setSession: (user, profile, sessionScope) => set({ user, profile, sessionScope, sessionResolved: true }),
  setProfile: (profile) => set({ profile }),
  clearSession: () => set({ user: null, profile: null, sessionScope: null, sessionResolved: true }),
  markSessionResolved: () => set({ sessionResolved: true }),
}));
