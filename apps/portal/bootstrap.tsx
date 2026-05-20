import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/carousel/styles.css";
import "@mantine/dropzone/styles.css";
import "@mantine/nprogress/styles.css";
import { ContextMenuProvider } from "mantine-contextmenu";
import "mantine-contextmenu/styles.css";
import React, { StrictMode } from "react";
import type { Root } from "react-dom/client";
import "./i18n";
import { ErrorBoundary } from "./components/effects/ErrorBoundary";
import { PortalThemeProvider } from "./providers/ThemeProvider";
import { AppRouter } from "./router";
import type { FeatureFlags } from "@guild/shared/config/features";
import { useSiteConfigStore } from "./stores/site-config";

async function loadSiteConfig(): Promise<void> {
  const response = await fetch("/api/site-config");
  if (!response.ok) {
    throw new Error(`Site config request failed: ${response.status}`);
  }
  const data = await response.json() as { site_name: string; site_logo_url: string; features?: Partial<FeatureFlags> };
  useSiteConfigStore.getState().setSiteConfig(data.site_name, data.site_logo_url);
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

function dismissSplash(): void {
  const splash = document.getElementById("splash");
  const rootEl = document.getElementById("root");
  if (splash) {
    splash.remove();
    (window as unknown as { __splashCleanup?: () => void }).__splashCleanup?.();
  }
  if (rootEl) {
    rootEl.style.opacity = "1";
    rootEl.style.position = "";
    rootEl.style.inset = "";
  }
  document.documentElement.classList.add("splash-done");
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
