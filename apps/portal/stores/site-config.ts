import { create } from "zustand";
import { DEFAULT_GAME_RULES, type GameRules } from "@guild/shared";
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from "@guild/shared/config/features";

type SiteConfig = {
  siteName: string;
  siteLogoUrl: string;
  features: FeatureFlags;
  gameRules: GameRules;
  setSiteConfig: (config: {
    siteName: string;
    siteLogoUrl: string;
  }) => void;
  setFeatures: (features: Partial<FeatureFlags>) => void;
};

export const useSiteConfigStore = create<SiteConfig>((set) => ({
  siteName: "",
  siteLogoUrl: "",
  features: { ...DEFAULT_FEATURE_FLAGS },
  gameRules: structuredClone(DEFAULT_GAME_RULES),
  setSiteConfig: (config) => set({
    siteName: config.siteName,
    siteLogoUrl: config.siteLogoUrl,
  }),
  setFeatures: (features) => set((state) => ({ features: { ...state.features, ...features } })),
}));
