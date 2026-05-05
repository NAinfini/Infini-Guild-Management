import { create } from "zustand";
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from "@guild/shared/config/features";

type SiteConfig = {
  siteName: string;
  siteLogoUrl: string | null;
  features: FeatureFlags;
  loaded: boolean;
  setSiteConfig: (name: string, logoUrl: string | null) => void;
  setFeatures: (features: Partial<FeatureFlags>) => void;
};

export const useSiteConfigStore = create<SiteConfig>((set) => ({
  siteName: "Guild Portal",
  siteLogoUrl: null,
  features: { ...DEFAULT_FEATURE_FLAGS },
  loaded: false,
  setSiteConfig: (name, logoUrl) => set({ siteName: name, siteLogoUrl: logoUrl, loaded: true }),
  setFeatures: (features) => set((state) => ({ features: { ...state.features, ...features } })),
}));
