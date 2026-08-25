# Visual theme asset contract

> Status 2026-08-24: active production contract. The expanded delivery goal and
> review matrix live in `SITE_REDESIGN_GOAL_HANDOFF.md`; the audit evidence lives
> in `SITE_DESIGN_AUDIT_2026-08-24.md`.

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

The source tree currently ships `forged`. An omitted value uses `forged`; an
unknown value fails startup or build instead of mixing packs. Adding a theme
requires a complete reviewed asset pack and one `PortalVisualTheme` registration
in `apps/portal/visual/themes.ts`.

## Runtime slots

Every runtime pack lives under `apps/portal/public/visual-themes/<theme-id>/` and
must provide the slots declared by its typed manifest:

```text
public/
  landing.webp
  access-desktop.webp
  access-mobile.webp
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
```

The manifest records each asset's source, intrinsic dimensions, byte size,
object position and protected safe area. The catalog test verifies every byte
on disk and all twelve route IDs. Missing assets fail clearly; there is no
fallback to a legacy pack. Access, status and navigation reuse only explicitly
declared opaque environmental scenes so transparent mattes cannot appear around
a person or prop.

## Access scenes

`access-desktop.webp` and `access-mobile.webp` are shared by login,
registration, account recovery, invite verification, maintenance, and the
initial HTML splash. They are complete pre-composited scenes; the runtime never
places a separate character over them.

### Desktop

- Shipped source: 1672 × 941, opaque WebP, approximately 16:9.
- Focal/story zone: x=4–57%, y=5–94%.
- Form-safe zone: x=61–96%, y=12–89%.
- Put every face, weapon, bright lamp, landmark, and high-contrast edge in the
  focal zone. The form-safe zone must remain dark, quiet atmosphere.
- Keep the top 76 CSS pixels calm because the public header shares the same
  scene.

### Mobile

- Shipped source: 1122 × 1402, opaque portrait WebP.
- Compact-card-safe zone: x=8–92%, y=6–46%.
- Focal zone: x=8–92%, y=52–96%.
- This is an independently art-directed portrait scene, not a crop of a
  transparent desktop subject.

The static HTML splash loads the default theme's desktop/mobile access sources
and formal SVG mark before React mounts. `splash.ts` swaps all three sources to
the configured theme without changing layout.

## Navigation scene

- The expanded desktop sidebar uses the manifest's explicit `navigation` slot.
- The crop remains low-detail and dark across the full rail; it contains no
  people, weapons, labels or high-contrast landmarks behind navigation.
- The artwork is hidden for the collapsed rail and compact/mobile navigation.
  A semantic opaque scrim preserves text and focus contrast.

## Page scene

- Shipped source: 1672 × 941, opaque WebP, approximately 16:9.
- Selected through `scenes.routes[routeId]` in the active manifest.
- One fixed scene spans the route header and content workspace. The header adds
  only a low-opacity semantic scrim and no independent image or full-width
  divider, so crop coordinates remain continuous.
- Keep the header band and content-facing region calm enough for real controls
  and copy in light and dark themes.

## Landing scene and formal mark

- `landing.webp` is one opaque environment with no transparent character layer.
  Semantic surfaces and scrims make it work in light and dark themes.
- `/guild-logo.svg` is the source-owned default “guild gate + infinity” mark.
  Administrator-owned Site Config branding remains authoritative at runtime.
  The real heading and status text remain accessible HTML.

## Image-generation prompt envelope

Every request must name the real component-safe zones. Retain the placement and
exclusion clauses while replacing the theme art direction.

### Desktop access template

> Production opaque cinematic website background, 16:9. The HTML access card
> occupies x=61–96%, y=12–89%; keep that entire zone dark, low-detail
> atmospheric negative space with no face, person, weapon, bright lamp, sharp
> skyline, or high-contrast horizon. Place focal architecture and restrained
> environmental light in x=4–57%, y=5–94%. Keep the top header strip calm.
> Single fully composited scene with coherent lighting and shadows. [THEME ART
> DIRECTION]. No text, logo, UI, HUD, watermark, transparent cutout, white
> outline, white matte, checkerboard, frame, or ornamental border.

### Mobile access template

> Production opaque mobile website background, portrait 9:16. The compact HTML
> card occupies x=8–92%, y=6–46%; keep that region dark and low-detail. Place
> the environmental focal architecture in x=8–92%, y=52–96%. Re-art-direct the
> same world for portrait instead of cropping the desktop scene. [THEME
> ART DIRECTION]. No text, logo, UI, watermark, transparent cutout, white
> outline, white matte, checkerboard, frame, or ornamental border.

### Navigation template

> Production opaque environmental background whose left navigation crop remains
> dark, quiet and free of people, weapons, bright lights, text and landmarks.
> Keep the full frame useful as a dashboard background so the explicit
> navigation slot may reuse it without a second download. [THEME ART DIRECTION]. No text, logo, UI,
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
- a genre theme mixes incompatible cultural or game-language cues;
- any asset contains text, UI, branding, a watermark, or recognizable IP.
