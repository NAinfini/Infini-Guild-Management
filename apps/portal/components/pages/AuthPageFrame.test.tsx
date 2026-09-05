import {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_SITE_ABSENCE_POLICY,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_OAUTH_SETTINGS,
  DEFAULT_SITE_STORAGE_POLICY,
  type PublicSiteConfig,
} from "@guild/shared";
import { act, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyPublicSiteConfig, useSiteConfigStore } from "../../stores/site-config";
import { AuthPageFrame } from "./AuthPageFrame";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, ...props }: ComponentProps<"a"> & { to: string }) => <a href={to} {...props} />,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../shared/ExperienceControls", () => ({ ExperienceControls: () => null }));
vi.mock("../shared/VisualThemeArtwork", () => ({ VisualThemeScene: () => null }));

const siteConfig: PublicSiteConfig = {
  site_name: "Configured Guild",
  site_description: "Our guild home.",
  site_logo_media_id: null,
  default_site_logo_url: "/deployment-guild-logo.webp",
  features: DEFAULT_FEATURE_FLAGS,
  oauth: DEFAULT_SITE_OAUTH_SETTINGS,
  media_policy: DEFAULT_SITE_MEDIA_POLICY,
  storage_policy: DEFAULT_SITE_STORAGE_POLICY,
  absence_policy: DEFAULT_SITE_ABSENCE_POLICY,
};

describe("AuthPageFrame guild identity", () => {
  beforeEach(() => {
    useSiteConfigStore.setState(useSiteConfigStore.getInitialState(), true);
    applyPublicSiteConfig(siteConfig);
  });

  it.each([
    ["login", "title.login"],
    ["register", "title.register"],
    ["reset", "reset.title"],
    ["verify", "verify.title"],
  ] as const)("uses the configured guild logo throughout the %s frame", (mode, title) => {
    const { container } = render(<AuthPageFrame mode={mode}><form aria-label="Account" /></AuthPageFrame>);
    const cardLogo = container.querySelector(".login-page__card-brand img");
    const headerLogo = screen.getByRole("link", { name: siteConfig.site_name }).querySelector("img");

    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(cardLogo).toHaveAttribute("src", siteConfig.default_site_logo_url);
    expect(headerLogo).toHaveAttribute("src", siteConfig.default_site_logo_url);
    expect(cardLogo).toHaveAttribute("alt", "");
    expect(cardLogo).toHaveAttribute("aria-hidden", "true");

    const uploadedLogoId = "g".repeat(21);
    act(() => applyPublicSiteConfig({ ...siteConfig, site_logo_media_id: uploadedLogoId }));

    const uploadedLogoUrl = new URL(`/api/media/${uploadedLogoId}/view`, window.location.origin).toString();
    expect(cardLogo).toHaveAttribute("src", uploadedLogoUrl);
    expect(headerLogo).toHaveAttribute("src", uploadedLogoUrl);
  });
});
