import type { MemberProfile, User } from "@guild/shared";
import { create } from "zustand";

type AuthState = {
  user: User | null;
  profile: MemberProfile | null;
  sessionScope: "normal" | "password_change" | null;
  setSession: (user: User, profile: MemberProfile, sessionScope: "normal" | "password_change") => void;
  setProfile: (profile: MemberProfile) => void;
  clearSession: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  sessionScope: null,
  setSession: (user, profile, sessionScope) => set({ user, profile, sessionScope }),
  setProfile: (profile) => set({ profile }),
  clearSession: () => set({ user: null, profile: null, sessionScope: null }),
}));
