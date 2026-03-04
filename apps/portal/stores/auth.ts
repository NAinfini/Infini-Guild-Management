import type { MemberProfile, User } from "@guild/shared";
import { create } from "zustand";

type AuthState = {
  user: User | null;
  profile: MemberProfile | null;
  setSession: (user: User, profile: MemberProfile) => void;
  setProfile: (profile: MemberProfile) => void;
  clearSession: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  setSession: (user, profile) => set({ user, profile }),
  setProfile: (profile) => set({ profile }),
  clearSession: () => set({ user: null, profile: null }),
}));
