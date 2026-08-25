import React, { StrictMode } from "react";
import type { Root } from "react-dom/client";
import { publicSiteConfigSchema } from "@guild/shared";
import i18n, { i18nReady } from "./i18n";
import { ErrorBoundary } from "./components/effects/ErrorBoundary";
import { PortalThemeProvider } from "./providers/ThemeProvider";
import { dismissSplash } from "./splash";
import { AppRouter } from "./router";
import { useSiteConfigStore } from "./stores/site-config";
import { queryClient } from "./api/query-client";
import { classCatalogQueryOptions, classTagsQueryOptions } from "./hooks/data/useClassData";
import { resolveMediaUrl } from "./utils/media";

async function loadSiteConfig(): Promise<void> {
  const response = await fetch("/api/site-config");
  if (!response.ok) {
    throw new Error(`Site config request failed: ${response.status}`);
  }
  const data = publicSiteConfigSchema.parse(await response.json());
  const siteLogoUrl = data.site_logo_media_id
    ? resolveMediaUrl(data.site_logo_media_id)
    : data.default_site_logo_url;
  useSiteConfigStore.getState().setSiteConfig({
    siteName: data.site_name,
    siteDescription: data.site_description,
    siteLogoUrl,
    mediaPolicy: data.media_policy,
    oauth: data.oauth,
  });
  useSiteConfigStore.getState().setFeatures(data.features);
  document.title = data.site_name;
  const splashTitle = document.getElementById("splash-title");
  if (splashTitle) splashTitle.textContent = data.site_name;
  const splashStatus = document.getElementById("splash-status");
  if (splashStatus) splashStatus.textContent = i18n.t("message.loading");
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (link) {
    link.href = siteLogoUrl;
    link.type = "image/webp";
  }
}

export async function mountApp(root: Root): Promise<void> {
  await i18nReady;
  /* fetchQuery 会把请求错误抛出来：目录拉不下来就中止挂载、走可见的启动
     失败路径，不允许换成任何吞错的预取变体。 */
  await Promise.all([
    loadSiteConfig(),
    queryClient.fetchQuery(classCatalogQueryOptions),
    queryClient.fetchQuery(classTagsQueryOptions),
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
