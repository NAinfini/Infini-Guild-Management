import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/carousel/styles.css";
import "@mantine/dropzone/styles.css";
import "@mantine/nprogress/styles.css";
import React, { StrictMode } from "react";
import type { Root } from "react-dom/client";
import { publicSiteConfigSchema } from "@guild/shared";
import { i18nReady } from "./i18n";
import { ErrorBoundary } from "./components/effects/ErrorBoundary";
import { PortalThemeProvider } from "./providers/ThemeProvider";
import { dismissSplash } from "./splash";
import { AppRouter } from "./router";
import { useSiteConfigStore } from "./stores/site-config";
import { fetchClassCatalog } from "./api/queries/classes";
import { fetchClassTags } from "./api/queries/class-tags";
import { useClassCatalogStore } from "./stores/class-catalog";
import { useClassTagStore } from "./stores/class-tag";

async function loadSiteConfig(): Promise<void> {
  const response = await fetch("/api/site-config");
  if (!response.ok) {
    throw new Error(`Site config request failed: ${response.status}`);
  }
  const data = publicSiteConfigSchema.parse(await response.json());
  useSiteConfigStore.getState().setSiteConfig({
    siteName: data.site_name,
    siteLogoUrl: data.site_logo_url,
  });
  useSiteConfigStore.getState().setFeatures(data.features);
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

async function loadClassTags(): Promise<void> {
  const tags = await fetchClassTags();
  useClassTagStore.getState().setTags(tags);
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
    loadClassTags().catch((error: unknown) => {
      console.error("[bootstrap] Failed to load class tags", error);
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
