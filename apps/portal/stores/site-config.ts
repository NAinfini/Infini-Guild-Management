import { create } from "zustand";
import {
  type PublicSiteConfig,
  type SiteMediaPolicy,
  type SiteConfig as SharedSiteConfig,
} from "@guild/shared";
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from "@guild/shared/config/features";
import { resolveMediaUrl } from "../utils/media";

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

export function applyPublicSiteConfig(config: PublicSiteConfig): void {
  const siteLogoUrl = config.site_logo_media_id
    ? resolveMediaUrl(config.site_logo_media_id)
    : config.default_site_logo_url;
  const store = useSiteConfigStore.getState();
  store.setSiteConfig({
    siteName: config.site_name,
    siteDescription: config.site_description,
    siteLogoUrl,
    mediaPolicy: config.media_policy,
    oauth: config.oauth,
  });
  store.setFeatures(config.features);

  const splashTitle = document.getElementById("splash-title");
  if (splashTitle) splashTitle.textContent = config.site_name;
  const splashEmblem = document.getElementById("splash-emblem");
  if (splashEmblem instanceof HTMLImageElement) splashEmblem.src = siteLogoUrl;
  const favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (favicon && favicon.href !== new URL(siteLogoUrl, document.baseURI).href) {
    favicon.href = siteLogoUrl;
  }
}
