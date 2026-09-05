export const VISUAL_ACCESS_SCENE_IDS = ["login", "register"] as const;

export type VisualAccessSceneId = (typeof VISUAL_ACCESS_SCENE_IDS)[number];

export const VISUAL_STATUS_SCENE_IDS = [
  "not-found",
  "error",
  "forbidden",
  "maintenance",
] as const;

export type VisualStatusSceneId = (typeof VISUAL_STATUS_SCENE_IDS)[number];

export const VISUAL_WORKSPACE_SCENE_IDS = ["guild", "falls", "citadel"] as const;
export type VisualWorkspaceSceneId = (typeof VISUAL_WORKSPACE_SCENE_IDS)[number];

export const VISUAL_THEME_IDS = ["forged"] as const;

export type VisualThemeId = (typeof VISUAL_THEME_IDS)[number];

export const VISUAL_COLOR_MODES = ["light", "dark"] as const;

export type VisualColorMode = (typeof VISUAL_COLOR_MODES)[number];

export type VisualThemeAssetSource = Readonly<{
  src: string;
}>;

export type VisualThemeAsset = Readonly<{
  sources: Readonly<Record<VisualColorMode, VisualThemeAssetSource>>;
  width: number;
  height: number;
  objectPosition: string;
}>;

export type ResponsiveVisualThemeAsset = Readonly<{
  desktop: VisualThemeAsset;
  mobile: VisualThemeAsset;
}>;

export type PortalVisualTheme = Readonly<{
  id: VisualThemeId;
  label: string;
  version: number;
  provenance: "source-owned-generated-art";
  scenes: Readonly<{
    workspace: Readonly<Record<VisualWorkspaceSceneId, ResponsiveVisualThemeAsset>>;
    landing: ResponsiveVisualThemeAsset;
    access: Readonly<Record<VisualAccessSceneId, ResponsiveVisualThemeAsset>>;
    status: Readonly<Record<VisualStatusSceneId, ResponsiveVisualThemeAsset>>;
  }>;
}>;

function assetSources(
  darkSrc: string,
  lightSrc: string,
): VisualThemeAsset["sources"] {
  return {
    dark: { src: darkSrc },
    light: { src: lightSrc },
  };
}

export function resolveVisualThemeAssetSource(
  asset: VisualThemeAsset,
  colorMode: VisualColorMode,
): VisualThemeAssetSource {
  return asset.sources[colorMode];
}

function publicAsset(
  name: string,
  width: number,
  height: number,
  objectPosition = "center",
): VisualThemeAsset {
  return {
    sources: assetSources(
      `/visual-themes/forged/public/${name}.webp`,
      `/visual-themes/forged/public/light/${name}.webp`,
    ),
    width,
    height,
    objectPosition,
  };
}

function workspaceAsset(name: string, width: number, height: number): VisualThemeAsset {
  return {
    sources: assetSources(
      `/visual-themes/forged/workspace/${name}-dark.webp`,
      `/visual-themes/forged/workspace/${name}.webp`,
    ),
    width,
    height,
    objectPosition: "center",
  };
}

const forgedTheme: PortalVisualTheme = {
  id: "forged",
  label: "Zhonghua Wuxia Guildhall",
  version: 8,
  provenance: "source-owned-generated-art",
  scenes: {
    workspace: {
      guild: {
        desktop: workspaceAsset("guild-desktop", 1672, 941),
        mobile: workspaceAsset("guild-mobile", 941, 1672),
      },
      falls: {
        desktop: workspaceAsset("falls-desktop", 1672, 941),
        mobile: workspaceAsset("falls-mobile", 941, 1672),
      },
      citadel: {
        desktop: workspaceAsset("citadel-desktop", 1672, 941),
        mobile: workspaceAsset("citadel-mobile", 941, 1672),
      },
    },
    landing: {
      desktop: publicAsset("landing", 3840, 2160),
      mobile: publicAsset("landing-mobile", 2160, 3840),
    },
    access: {
      login: {
        desktop: publicAsset("login-desktop", 3840, 2160),
        mobile: publicAsset("login-mobile", 2160, 3840),
      },
      register: {
        desktop: publicAsset("register-desktop", 3840, 2160),
        mobile: publicAsset("register-mobile", 2160, 3840),
      },
    },
    status: {
      "not-found": {
        desktop: publicAsset("status-not-found-desktop", 3840, 2160),
        mobile: publicAsset("status-not-found-mobile", 2160, 3840),
      },
      error: {
        desktop: publicAsset("status-error-desktop", 3840, 2160),
        mobile: publicAsset("status-error-mobile", 2160, 3840),
      },
      forbidden: {
        desktop: publicAsset("status-forbidden-desktop", 3840, 2160),
        mobile: publicAsset("status-forbidden-mobile", 2160, 3840),
      },
      maintenance: {
        desktop: publicAsset("status-maintenance-desktop", 3840, 2160),
        mobile: publicAsset("status-maintenance-mobile", 2160, 3840),
      },
    },
  },
};

export const VISUAL_THEMES: Readonly<Record<VisualThemeId, PortalVisualTheme>> = {
  forged: forgedTheme,
};

export const DEFAULT_VISUAL_THEME_ID: VisualThemeId = "forged";

export function isVisualThemeId(value: string): value is VisualThemeId {
  return (VISUAL_THEME_IDS as readonly string[]).includes(value);
}

export function resolveVisualThemeId(configuredId: string | undefined): VisualThemeId {
  const candidate = configuredId?.trim();
  if (!candidate) return DEFAULT_VISUAL_THEME_ID;
  if (isVisualThemeId(candidate)) return candidate;
  throw new Error(
    `Unknown VITE_VISUAL_THEME "${candidate}". Expected one of: ${VISUAL_THEME_IDS.join(", ")}.`,
  );
}

export const ACTIVE_VISUAL_THEME_ID = resolveVisualThemeId(
  import.meta.env.VITE_VISUAL_THEME,
);

export const ACTIVE_VISUAL_THEME = VISUAL_THEMES[ACTIVE_VISUAL_THEME_ID];
