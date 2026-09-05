# Visual theme asset contract

[Documentation home](../README.md) · [中文版本](./VISUAL_PRESETS.zh.md)

The Portal uses one typed manifest in `apps/portal/visual/themes.ts` and one UI implementation. Environmental artwork never replaces member avatars, Gallery works, item photos or Announcement/Wiki media. Site Config owns the displayed name and logo. Accessible text, controls, focus and contrast remain owned by the application.

## Activation

Set `VITE_VISUAL_THEME=forged` in the Portal build environment or `.env.local`. An omitted value selects `forged`; unknown values fail clearly. The current pack is version 8.

## Workspace scenes

The existing `components/layout/route-metadata.ts` registry assigns each route a `workspaceScene`. Nested pages inherit their parent scene; there is no separate route or tab artwork registry.

| Scene | Routes | Visual identity |
| --- | --- | --- |
| `guild` | Dashboard, Events, Roster | An immense riverside guild capital with broad palace halls and city districts |
| `falls` | Announcements, Wiki, Gallery | A monumental waterfall and waterfront guild halls on grounded stone terraces |
| `citadel` | Guild War, Storage, Tools, Profile, Settings, Admin | A fortress harbor with massive walls and palace districts on both banks |

Each scene has four opaque WebP files under `public/visual-themes/forged/workspace/`:

- `<scene>-desktop.webp` and `<scene>-mobile.webp`: daylight.
- `<scene>-desktop-dark.webp` and `<scene>-mobile-dark.webp`: separately generated evening counterparts of the corresponding daylight composition.

Desktop scenes are 1672×941; portrait scenes are 941×1672. These are the actual native files returned by the built-in image generator after requesting its largest output; they are not 2K or 4K assets. All 12 images are exported as lossless WebP without resizing, and their decoded pixels are checked against the original PNGs during export. Exact production dimensions are declared in the manifest and checked against the shipped bytes. The generated day/night pairs have matching native dimensions.

These are epic architectural panoramas, with no near alleys, courtyards or framing pillars. Grandeur comes from coherent city massing, broad halls and supported fortifications, rather than repeated towers or mountain peaks. Dense content usually hides the central 70–80%; large palace roofs, walls, waterfalls and waterfront foundations reach the left, right, top and bottom edges. The complete uncovered image must still be one coherent environment, without artificial borders or an empty central rectangle. Natural materials, restrained light and detail that recedes with distance avoid a uniformly sharpened texture. Portraits are independently composed rather than cropped from desktop scenes.

`AppShell` places one non-interactive scene in the actual content grid area, below the header and beside the sidebar; compact navigation also excludes the bottom bar. `VisualThemeScene` uses one responsive `<picture>`, selecting portrait below 768px and the correct day/night source from the active theme. Switching routes within a scene group reuses its assets.

Light scenes have an 18% surface-base veil, and night scenes a 6% veil. All readable groups have opaque semantic surfaces. Do not hide the scene behind an opaque full-page canvas or a heavy global wash. Navigation remains opaque and uses no separate scene. There is no parallax or looping background animation.

## Public, access and status scenes

Existing landing, login, register and four status scenes retain their separate desktop/mobile and light/dark assets under `public/` and `public/light/`. Desktop assets are 3840×2160; portrait assets are 2160×3840. These dimensions describe the public assets only.

Login and registration keep a quiet right-side desktop form zone; mobile keeps the form above its focal scene. Account recovery and invite verification use the login pair. The HTML splash preserves the injected Site Config logo, site name and status on a lightweight semantic background, and resolves the persisted color-mode preference before React mounts. It does not preload or display scene images; the actual page selects its own responsive, theme-correct image.

Not-found, error, forbidden and maintenance pages own their status artwork. Real status codes, messages and actions remain HTML. Landing also has its own independently composed portrait asset.

## Validation

- Asset tests verify every configured file and exact dimensions, and require distinct day/night sources.
- Component tests verify responsive source selection, theme switching and decorative accessibility.
- Route tests verify the three shared groups and nested-page inheritance.
- Browser review checks the artwork through real opaque panels in both themes and at desktop, medium and phone widths, with no horizontal overflow or duplicate desktop/mobile downloads.
