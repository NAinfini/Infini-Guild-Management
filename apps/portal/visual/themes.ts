export const VISUAL_PAGE_SCENE_IDS = [
  "dashboard",
  "announcements",
  "events",
  "roster",
  "gallery",
  "wiki",
  "guild-war",
  "storage",
  "tools",
  "profile",
  "settings",
  "admin",
] as const;

export type VisualPageSceneId = (typeof VISUAL_PAGE_SCENE_IDS)[number];

export const VISUAL_THEME_IDS = ["forged"] as const;

export type VisualThemeId = (typeof VISUAL_THEME_IDS)[number];

export type VisualThemeAsset = Readonly<{
  src: string;
  width: number;
  height: number;
  bytes: number;
  objectPosition: string;
  safeArea: "center" | "top" | "left" | "right";
}>;

export type PortalVisualTheme = Readonly<{
  id: VisualThemeId;
  label: string;
  version: number;
  provenance: "source-owned-generated-art";
  mark: Readonly<{ src: string }>;
  scenes: Readonly<{
    landing: VisualThemeAsset;
    access: Readonly<{
      desktop: VisualThemeAsset;
      mobile: VisualThemeAsset;
    }>;
    status: VisualThemeAsset;
    navigation: VisualThemeAsset;
    routes: Readonly<Record<VisualPageSceneId, VisualThemeAsset>>;
  }>;
}>;

const routeAssetBytes: Readonly<Record<VisualPageSceneId, number>> = {
  dashboard: 110_728,
  announcements: 105_418,
  events: 104_744,
  roster: 146_626,
  gallery: 114_290,
  wiki: 104_744,
  "guild-war": 75_574,
  storage: 122_394,
  tools: 134_798,
  profile: 98_164,
  settings: 134_166,
  admin: 92_812,
};

function routeAsset(sceneId: VisualPageSceneId): VisualThemeAsset {
  return {
    src: `/visual-themes/forged/routes/${sceneId}.webp`,
    width: 1672,
    height: 941,
    bytes: routeAssetBytes[sceneId],
    objectPosition: "center",
    safeArea: "center",
  };
}

const forgedRoutes = Object.fromEntries(
  VISUAL_PAGE_SCENE_IDS.map((sceneId) => [sceneId, routeAsset(sceneId)]),
) as Record<VisualPageSceneId, VisualThemeAsset>;

const forgedTheme: PortalVisualTheme = {
  id: "forged",
  label: "Forged Guildhall",
  version: 1,
  provenance: "source-owned-generated-art",
  mark: { src: "/guild-logo.svg" },
  scenes: {
    landing: {
      src: "/visual-themes/forged/public/landing.webp",
      width: 1672,
      height: 941,
      bytes: 84_362,
      objectPosition: "center",
      safeArea: "center",
    },
    access: {
      desktop: {
        src: "/visual-themes/forged/public/access-desktop.webp",
        width: 1672,
        height: 941,
        bytes: 67_224,
        objectPosition: "center",
        safeArea: "center",
      },
      mobile: {
        src: "/visual-themes/forged/public/access-mobile.webp",
        width: 1122,
        height: 1402,
        bytes: 71_110,
        objectPosition: "center",
        safeArea: "center",
      },
    },
    status: forgedRoutes.admin,
    navigation: forgedRoutes.dashboard,
    routes: forgedRoutes,
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
