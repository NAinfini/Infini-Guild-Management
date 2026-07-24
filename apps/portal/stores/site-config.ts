import { create } from "zustand";
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from "@guild/shared/config/features";

type SiteConfig = {
  siteName: string;
  siteLogoUrl: string;
  features: FeatureFlags;
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
  setSiteConfig: (config) => set({
    siteName: config.siteName,
    siteLogoUrl: config.siteLogoUrl,
  }),
  setFeatures: (features) => set((state) => ({ features: { ...state.features, ...features } })),
}));
