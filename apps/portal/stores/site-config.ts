import { create } from "zustand";
import { DEFAULT_GAME_RULES, type GameRules, type SiteMediaPolicy } from "@guild/shared";
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from "@guild/shared/config/features";

type SiteConfig = {
  siteName: string;
  siteLogoUrl: string;
  mediaPolicy: SiteMediaPolicy | null;
  features: FeatureFlags;
  gameRules: GameRules;
  setSiteConfig: (config: {
    siteName: string;
    siteLogoUrl: string;
    mediaPolicy: SiteMediaPolicy;
  }) => void;
  setFeatures: (features: Partial<FeatureFlags>) => void;
};

export function requireSiteMediaPolicy(
  state: { mediaPolicy: SiteMediaPolicy | null },
): SiteMediaPolicy {
  if (!state.mediaPolicy) {
    throw new Error("Site media policy is unavailable");
  }
  return state.mediaPolicy;
}

export const useSiteConfigStore = create<SiteConfig>((set) => ({
  siteName: "",
  siteLogoUrl: "",
  mediaPolicy: null,
  features: { ...DEFAULT_FEATURE_FLAGS },
  gameRules: structuredClone(DEFAULT_GAME_RULES),
  setSiteConfig: (config) => set({
    siteName: config.siteName,
    siteLogoUrl: config.siteLogoUrl,
    mediaPolicy: config.mediaPolicy,
  }),
  setFeatures: (features) => set((state) => ({ features: { ...state.features, ...features } })),
}));
