import { create } from "zustand";

type SiteConfig = {
  siteName: string;
  siteLogoUrl: string | null;
  loaded: boolean;
  setSiteConfig: (name: string, logoUrl: string | null) => void;
};

export const useSiteConfigStore = create<SiteConfig>((set) => ({
  siteName: "Guild Portal",
  siteLogoUrl: null,
  loaded: false,
  setSiteConfig: (name, logoUrl) => set({ siteName: name, siteLogoUrl: logoUrl, loaded: true }),
}));
