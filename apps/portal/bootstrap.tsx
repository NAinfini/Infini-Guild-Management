import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/carousel/styles.css";
import "@mantine/dropzone/styles.css";
import "@mantine/nprogress/styles.css";
import React, { StrictMode } from "react";
import type { Root } from "react-dom/client";
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from "@guild/shared/config/features";
import { i18nReady } from "./i18n";
import { ErrorBoundary } from "./components/effects/ErrorBoundary";
import { PortalThemeProvider } from "./providers/ThemeProvider";
import { dismissSplash } from "./splash";
import { AppRouter } from "./router";
import { useSiteConfigStore } from "./stores/site-config";
import { fetchClassCatalog } from "./api/queries/classes";
import { useClassCatalogStore } from "./stores/class-catalog";

type BootstrapSiteConfig = {
  site_name: string;
  site_logo_url: string;
  features?: Partial<FeatureFlags>;
};

function parseBootstrapSiteConfig(value: unknown): BootstrapSiteConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid site config response");
  }
  const data = value as Record<string, unknown>;
  if (typeof data.site_name !== "string" || typeof data.site_logo_url !== "string") {
    throw new Error("Invalid site config identity fields");
  }
  const parsed: BootstrapSiteConfig = {
    site_name: data.site_name,
    site_logo_url: data.site_logo_url,
  };
  if (data.features !== undefined) {
    if (!data.features || typeof data.features !== "object" || Array.isArray(data.features)) {
      throw new Error("Invalid site config feature flags");
    }
    const featureFlags: Partial<FeatureFlags> = {};
    for (const key of Object.keys(DEFAULT_FEATURE_FLAGS) as (keyof FeatureFlags)[]) {
      const flag = (data.features as Partial<Record<keyof FeatureFlags, unknown>>)[key];
      if (flag !== undefined) {
        if (typeof flag !== "boolean") throw new Error(`Invalid site config feature flag: ${key}`);
        featureFlags[key] = flag;
      }
    }
    parsed.features = featureFlags;
  }
  return parsed;
}

async function loadSiteConfig(): Promise<void> {
  const response = await fetch("/api/site-config");
  if (!response.ok) {
    throw new Error(`Site config request failed: ${response.status}`);
  }
  const data = parseBootstrapSiteConfig(await response.json());
  useSiteConfigStore.getState().setSiteConfig({
    siteName: data.site_name,
    siteLogoUrl: data.site_logo_url,
  });
  if (data.features) {
    useSiteConfigStore.getState().setFeatures(data.features);
  }
  document.title = data.site_name;
  const splashTitle = document.getElementById("splash-title");
  if (splashTitle) splashTitle.textContent = data.site_name;
  const splashSub = document.querySelector(".splash-subtitle");
  if (splashSub) splashSub.textContent = data.site_name;
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (link) {
    link.href = data.site_logo_url;
    link.type = "image/webp";
  }
}

async function loadClassCatalog(): Promise<void> {
  const items = await fetchClassCatalog();
  useClassCatalogStore.getState().setItems(items);
}

export async function mountApp(root: Root): Promise<void> {
  await i18nReady;
  await Promise.all([
    loadSiteConfig().catch((error: unknown) => {
      console.error("[bootstrap] Failed to load site config", error);
    }),
    loadClassCatalog().catch((error: unknown) => {
      console.error("[bootstrap] Failed to load class catalog", error);
    }),
  ]);
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <PortalThemeProvider>
          <AppRouter />
        </PortalThemeProvider>
      </ErrorBoundary>
    </StrictMode>,
  );

  // Dismiss the HTML splash screen
  dismissSplash();

  if (import.meta.env.DEV) {
    import("@axe-core/react").then((axe) => {
      import("react-dom").then((ReactDOM) => {
        axe.default(React, ReactDOM, 1000);
      });
    });
  }
}
