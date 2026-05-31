import { create } from "zustand";
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from "@guild/shared/config/features";

type SiteConfig = {
  siteName: string;
  siteLogoUrl: string;
  features: FeatureFlags;
  setSiteConfig: (name: string, logoUrl: string) => void;
  setFeatures: (features: Partial<FeatureFlags>) => void;
};

export const useSiteConfigStore = create<SiteConfig>((set) => ({
  siteName: "",
  siteLogoUrl: "",
  features: { ...DEFAULT_FEATURE_FLAGS },
  setSiteConfig: (name, logoUrl) => set({ siteName: name, siteLogoUrl: logoUrl }),
  setFeatures: (features) => set((state) => ({ features: { ...state.features, ...features } })),
}));
