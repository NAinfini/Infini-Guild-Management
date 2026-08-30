# Visual theme asset contract

[Documentation home](../README.md)

> Status 2026-08-26: active production contract.

The Portal uses one business/UI implementation and one typed visual-theme
manifest. A reviewed theme may replace decorative backgrounds, the default
formal mark and explicitly approved category/class/domain icons; it never
replaces real member identity, content media, permissions, schemas, routes or
task flows. Source-owned shadcn/ui compositions and Base UI primitives continue
to own copy, controls, focus, contrast, status and responsive behavior. Artwork
must not contain UI, labels, logos, badges or data that the application would
need to synchronize.

## Activation

Set `VITE_VISUAL_THEME` in `apps/portal/.env.local` or the Portal build
environment:

```dotenv
VITE_VISUAL_THEME=forged
```

The source tree currently ships `forged`, whose version 6 artwork is the
production Zhonghua-wuxia/xianxia game world. An omitted value uses `forged`; an
unknown value fails startup or build instead of mixing packs. Adding a theme
requires a complete reviewed asset pack and one `PortalVisualTheme` registration
in `apps/portal/visual/themes.ts`.

## Runtime slots

Every runtime pack lives under `apps/portal/public/visual-themes/<theme-id>/` and
must provide the slots declared by its typed manifest:

```text
public/
  landing.webp
  landing-mobile.webp
  navigation-sidebar.webp
  login-desktop.webp
  login-mobile.webp
  register-desktop.webp
  register-mobile.webp
  status-not-found-desktop.webp
  status-not-found-mobile.webp
  status-error-desktop.webp
  status-error-mobile.webp
  status-forbidden-desktop.webp
  status-forbidden-mobile.webp
  status-maintenance-desktop.webp
  status-maintenance-mobile.webp
  light/
    # A light-mode counterpart for every public asset above.
routes/
    dashboard.webp
    announcements.webp
    events.webp
    roster.webp
    gallery.webp
    wiki.webp
    guild-war.webp
    storage.webp
    tools.webp
    profile.webp
    settings.webp
    admin.webp
    light/
      # A light-mode counterpart for every route asset above.
```

The manifest records each asset's dark/light sources and byte sizes, shared
intrinsic dimensions, object position and protected safe area. The catalog test
verifies every byte on disk and every route ID. Missing assets fail clearly; there is no
fallback to a legacy pack. Landing, access and status scenes use explicit
desktop/mobile pairs; route scenes remain single wide assets and navigation uses
one dedicated portrait asset.
Every scene is one opaque environment, so transparent mattes cannot appear
around a person or prop.

## Access scenes

Login and registration own separate desktop/mobile pairs. Account recovery,
invite verification, and the initial HTML splash intentionally use the login
pair; system-status pages use their own status pair. Every asset is a complete
pre-composited scene, and the runtime never places a separate character over it.
On desktop the splash card uses the same right-side alignment and safe zone as
the login/register card instead of covering the focal subject at frame center.

### Desktop

- Shipped sources: 3840 × 2160, opaque WebP.
- Focal/story zone: x=4–57%, y=5–94%.
- Form-safe zone: x=61–96%, y=12–89%.
- Put every face, weapon, bright lamp, landmark, and high-contrast edge in the
  focal zone. The form-safe zone must remain dark, quiet atmosphere.
- Keep the top 76 CSS pixels calm because the public header shares the same
  scene.

### Mobile

- Shipped sources: 2160 × 3840, opaque portrait WebP.
- Compact-card-safe zone: x=8–92%, y=6–46%.
- Focal zone: x=8–92%, y=52–96%.
- This is an independently art-directed portrait scene, not a crop of a
  transparent desktop subject.

The static HTML splash loads color-scheme-aware desktop/mobile login sources
and the formal SVG mark before React mounts. `splash.ts` resolves the persisted
light/dark preference and swaps all sources before the application mounts.

## System-status scenes

- `not-found`, `error`, `forbidden`, and `maintenance` select independent
  desktop scenes instead of reusing administration artwork.
- All four states have independently art-directed desktop and mobile scenes;
  the 403 image no longer borrows the 500 storm scene.
- Desktop status panels use the same right-side safe zone as access pages;
  mobile panels use the quiet upper safe zone. The real 403/404/500/503 code,
  title, description and action remain accessible HTML.

## Navigation scene

- The expanded desktop sidebar uses the manifest's explicit `navigation` slot.
- The top 70% remains low-detail and dark behind the brand and navigation. The
  visual focus belongs in the bottom 30%, where jade water, steps, lanterns or
  modest integrated guardians can appear without competing with controls.
- It never reuses a route image, forces a character into the composition, or
  enlarges one isolated statue to fill the rail.
- The artwork is hidden for the collapsed rail and compact/mobile navigation.
  A semantic graduated scrim preserves text and focus contrast while revealing
  the bottom focal area.

## Page scene

- Shipped sources: separate light and dark 3840 × 2160 opaque WebP files.
- Selected through `scenes.routes[routeId]` in the active manifest.
- One fixed scene spans the route header and content workspace. The header adds
  only a low-opacity semantic scrim and no independent image or full-width
  divider, so crop coordinates remain continuous.
- Keep the header band and content-facing region calm enough for real controls
  and copy in light and dark themes.

## Landing scenes and formal mark

- `landing.webp` and `landing-mobile.webp` are independently composed opaque
  environments with no transparent character layer. Semantic surfaces and
  scrims make them work in light and dark themes.
- `/guild-logo.svg` is the source-owned default “guild gate + infinity” mark.
  Administrator-owned Site Config branding remains authoritative at runtime.
  The real heading and status text remain accessible HTML.

## Production art direction: Zhonghua wuxia / xianxia game

- Every source-owned scene reads as mature AAA Chinese PC-game environment key
  art: accurate timber halls and tiled roofs, cloud seas, cliffs, water, bamboo,
  bronze, jade and restrained cultivation qi rendered with high-fidelity
  realistic-painterly game materials.
- The pack is not a film still, photograph, cosplay frame, anime illustration,
  cel-shaded scene, horror image, or pastel fantasy poster. Exposure stays in a
  controlled midtone range: shadows retain structure and highlights never wash
  out the UI in either light or dark theme.
- People are optional. When a route benefits from a hero, the subject stays at
  an outer edge or distant scale and never competes with the interface. Do not
  repeat a back-facing traveler and giant city across the pack.
- Every page has a semantic place: announcement scroll court, empty tournament
  arena, companion hall, art pavilion, scripture archive, opposing guild-war
  heroes, supply court, forge, calibration garden and command citadel. Statues
  may support architecture as a group, but one oversized foreground statue may
  not substitute for environmental scale.
- The central 55–60% stays calm and low-detail for real UI. Narrative detail
  belongs at the left, right, top or bottom edges according to each component's
  safe zone.
- Generated scenery remains decorative and source-owned. Member avatars,
  Gallery works, item images, and Announcement/Wiki media remain authorized user
  content and are never replaced by the theme pack.

## Image-generation prompt envelope

Every request must name the real component-safe zones. Retain the placement and
exclusion clauses while replacing the theme art direction.

### Desktop access template

> Production opaque mature AAA Chinese PC-game environment background, 16:9.
> Use controlled midtone exposure that supports light and dark themes. The HTML access card
> occupies x=61–96%, y=12–89%; keep that entire zone dark, low-detail
> atmospheric negative space with no face, person, weapon, bright lamp, sharp
> skyline, or high-contrast horizon. Place focal architecture and restrained
> environmental light in x=4–57%, y=5–94%. Keep the top header strip calm.
> Single fully composited scene with coherent lighting and shadows. [THEME ART
> DIRECTION]. No text, logo, UI, HUD, watermark, transparent cutout, white
> outline, white matte, checkerboard, frame, or ornamental border.

### Mobile access template

> Production opaque mature AAA Chinese PC-game environment background, portrait
> 9:16, with controlled midtone exposure. The compact HTML
> card occupies x=8–92%, y=6–46%; keep that region dark and low-detail. Place
> the environmental focal architecture in x=8–92%, y=52–96%. Re-art-direct the
> same world for portrait instead of cropping the desktop scene. [THEME
> ART DIRECTION]. No text, logo, UI, watermark, transparent cutout, white
> outline, white matte, checkerboard, frame, or ornamental border.

### Navigation template

> Production opaque portrait navigation background. Keep the upper 70% dark,
> low-detail and free of faces, weapons, bright lights, text and landmarks. Put
> the scenic focus only in the bottom 30%; people are optional and a single
> enlarged statue is forbidden. This is a dedicated navigation asset, not a
> route crop. [THEME ART DIRECTION]. No text, logo, UI,
> watermark, transparent cutout, white outline, white matte, checkerboard, or
> frame.

## Review gate

Reject and regenerate an asset when any of the following is true:

- a component-safe zone contains a face, prop, bright light, or strong edge;
- a subject or piece of equipment reads as a floating cutout;
- any pale one-pixel matte appears around hair, fabric, weapons, packs, or
  particles against `#0A0A0F`, `#141418`, or a light surface;
- the mobile scene is only an accidental desktop crop;
- the navigation crop is busy;
- exposure is washed out, crushed into featureless black, or usable in only one
  colour theme;
- the result reads as a movie still, cosplay photograph, anime illustration or
  horror scene instead of mature Chinese PC-game key art;
- multiple pages repeat the same traveler/city composition, or one giant prop or
  statue is used as a shortcut for scale;
- a genre theme mixes incompatible cultural or game-language cues;
- any asset contains text, UI, branding, a watermark, or recognizable IP.
