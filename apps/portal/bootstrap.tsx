import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/carousel/styles.css";
import "@mantine/dropzone/styles.css";
import "@mantine/nprogress/styles.css";
import { ContextMenuProvider } from "mantine-contextmenu";
import "mantine-contextmenu/styles.css";
import React, { StrictMode } from "react";
import type { Root } from "react-dom/client";
import "@gfazioli/mantine-split-pane/styles.css";
import "./i18n";
import { ErrorBoundary } from "./components/effects/ErrorBoundary";
import { PortalThemeProvider } from "./providers/ThemeProvider";
import { AppRouter } from "./router";
import type { FeatureFlags } from "@guild/shared/config/features";
import { useSiteConfigStore } from "./stores/site-config";

async function loadSiteConfig(): Promise<void> {
  try {
    const response = await fetch("/api/site-config");
    if (response.ok) {
      const data = await response.json() as { site_name: string; site_logo_url: string | null; features?: Partial<FeatureFlags> };
      useSiteConfigStore.getState().setSiteConfig(data.site_name, data.site_logo_url);
      if (data.features) {
        useSiteConfigStore.getState().setFeatures(data.features);
      }
      document.title = data.site_name;
      if (data.site_logo_url) {
        const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
        if (link) {
          link.href = data.site_logo_url;
          link.type = "image/webp";
        }
      }
    }
  } catch {
    // Use defaults on failure
  }
}

export async function mountApp(root: Root): Promise<void> {
  await loadSiteConfig();
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <PortalThemeProvider>
          <ContextMenuProvider
            borderRadius="md"
            classNames={{
              root: "infini-context-menu-root",
              item: "infini-context-menu-item",
              divider: "infini-context-menu-divider",
            }}
            shadow="md"
            submenuDelay={160}
          >
            <AppRouter />
          </ContextMenuProvider>
        </PortalThemeProvider>
      </ErrorBoundary>
    </StrictMode>,
  );

  if (import.meta.env.DEV) {
    import("@axe-core/react").then((axe) => {
      import("react-dom").then((ReactDOM) => {
        axe.default(React, ReactDOM, 1000);
      });
    });
  }
}
