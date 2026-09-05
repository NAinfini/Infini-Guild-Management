import React, { StrictMode } from "react";
import type { Root } from "react-dom/client";
import i18n, { i18nReady } from "./i18n";
import { ErrorBoundary } from "./components/effects/ErrorBoundary";
import { PortalThemeProvider } from "./providers/ThemeProvider";
import { dismissSplash } from "./splash";
import { AppRouter } from "./router";
import { applyPublicSiteConfig } from "./stores/site-config";
import { fetchPublicSiteConfig } from "./services/SiteConfigService";
import { queryClient } from "./api/query-client";
import { resolveSessionSnapshot } from "./session-transition";

export async function mountApp(root: Root): Promise<void> {
  const [, siteConfig] = await Promise.all([
    i18nReady,
    fetchPublicSiteConfig(),
    resolveSessionSnapshot(queryClient, undefined, { broadcast: false }),
  ]);
  applyPublicSiteConfig(siteConfig);
  const splashStatus = document.getElementById("splash-status");
  if (splashStatus) splashStatus.textContent = i18n.t("message.loading");
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
