import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/carousel/styles.css";
import "@mantine/dropzone/styles.css";
import "@mantine/nprogress/styles.css";
import { ContextMenuProvider } from "mantine-contextmenu";
import "mantine-contextmenu/styles.css";
import { StrictMode } from "react";
import type { Root } from "react-dom/client";
import "@gfazioli/mantine-split-pane/styles.css";
import "./i18n";
import { PortalThemeProvider } from "./providers/ThemeProvider";
import { AppRouter } from "./router";

export function mountApp(root: Root): void {
  root.render(
    <StrictMode>
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
    </StrictMode>,
  );
}
