import { create } from "zustand";
import { type SiteMediaPolicy, type SiteConfig as SharedSiteConfig } from "@guild/shared";
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from "@guild/shared/config/features";

type SiteConfig = {
  siteName: string;
  siteDescription: string;
  siteLogoUrl: string;
  mediaPolicy: SiteMediaPolicy | null;
  oauth: SharedSiteConfig["oauth"];
  features: FeatureFlags;
  setSiteConfig: (config: {
    siteName: string;
    siteDescription: string;
    siteLogoUrl: string;
    mediaPolicy: SiteMediaPolicy;
    oauth: SharedSiteConfig["oauth"];
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
  siteDescription: "",
  siteLogoUrl: "",
  mediaPolicy: null,
  oauth: { google: false, discord: false, kook: false, wechat: false },
  features: { ...DEFAULT_FEATURE_FLAGS },
  setSiteConfig: (config) => set({
    siteName: config.siteName,
    siteDescription: config.siteDescription,
    siteLogoUrl: config.siteLogoUrl,
    mediaPolicy: config.mediaPolicy,
    oauth: config.oauth,
  }),
  setFeatures: (features) => set((state) => ({ features: { ...state.features, ...features } })),
}));
