import type { MantineThemeOverride } from "@mantine/core";

import type { ThemeId } from "@infini-dev-kit/theme-core";

export type MantineColorSchemePreference = "light" | "dark";

export interface MantineThemeToken {
  [key: string]: string | number;
  colorPrimary: string;
  colorInfo: string;
  colorSuccess: string;
  colorWarning: string;
  colorDanger: string;
  colorTextBase: string;
  colorBgBase: string;
  colorBgContainer: string;
  colorBorder: string;
  borderRadius: number;
  lineWidth: number;
  fontFamily: string;
  fontFamilyZh: string;
  fontFamilyJa: string;
  fontHeading: string;
  fontHeadingZh: string;
  fontHeadingJa: string;
  fontMono: string;
}

export interface ScopedCssVariables {
  selector: string;
  variables: Record<string, string>;
}

export interface MantineThemeConfig {
  colorScheme: MantineColorSchemePreference;
  token: MantineThemeToken;
  components: Record<string, Record<string, string | number>>;
  theme: MantineThemeOverride;
}

export interface ComposeMantineThemeOptions {
  themeId: ThemeId;
  forcedColorScheme?: MantineColorSchemePreference;
}