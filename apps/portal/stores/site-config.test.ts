import {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_SITE_ABSENCE_POLICY,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_OAUTH_SETTINGS,
  DEFAULT_SITE_STORAGE_POLICY,
  type PublicSiteConfig,
} from "@guild/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyPublicSiteConfig, useSiteConfigStore } from "./site-config";

const siteConfig: PublicSiteConfig = {
  site_name: "Infini Guild",
  site_description: "A focused home for our guild.",
  site_logo_media_id: null,
  default_site_logo_url: "/guild-logo.svg",
  features: DEFAULT_FEATURE_FLAGS,
  oauth: DEFAULT_SITE_OAUTH_SETTINGS,
  media_policy: DEFAULT_SITE_MEDIA_POLICY,
  storage_policy: DEFAULT_SITE_STORAGE_POLICY,
  absence_policy: DEFAULT_SITE_ABSENCE_POLICY,
};

describe("applyPublicSiteConfig", () => {
  beforeEach(() => {
    document.head.innerHTML = '<link rel="icon" href="/guild-logo.svg">';
    document.body.innerHTML = '<span id="splash-title"></span><img id="splash-emblem" src="/guild-logo.svg" alt="">';
    useSiteConfigStore.setState({
      siteName: "",
      siteDescription: "",
      siteLogoUrl: "",
      mediaPolicy: null,
      oauth: DEFAULT_SITE_OAUTH_SETTINGS,
      features: DEFAULT_FEATURE_FLAGS,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("only replaces the favicon when the resolved logo URL changes", () => {
    const favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    const setHref = vi.spyOn(HTMLLinkElement.prototype, "href", "set");

    applyPublicSiteConfig(siteConfig);

    expect(setHref).not.toHaveBeenCalled();
    expect(favicon).not.toHaveAttribute("type");

    applyPublicSiteConfig({ ...siteConfig, default_site_logo_url: "/guild-logo.webp" });

    expect(setHref).toHaveBeenCalledOnce();
    expect(favicon).toHaveAttribute("href", "/guild-logo.webp");
    expect(document.getElementById("splash-emblem")).toHaveAttribute("src", "/guild-logo.webp");
  });
});
