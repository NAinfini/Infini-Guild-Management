---
name: "Infini Guild Management Portal"
description: "A bilingual, dual-theme guild operations interface using a restrained Forged Material language, Mantine foundations, and one protected high-character Roster interaction."
colors:
  primary: "{colors.brand-fill}"
  surface-sunken-light: "#F1EEE7"
  surface-base-light: "#FAF9F5"
  surface-raised-light: "#FFFFFF"
  surface-overlay-light: "#FFFFFF"
  text-primary-light: "#1A1815"
  text-secondary-light: "#3A3833"
  text-muted-light: "#6B665E"
  border-subtle-light: "#E3E1D9"
  border-strong-light: "#D6D2C8"
  surface-sunken-dark: "#0A0A0F"
  surface-base-dark: "#141418"
  surface-raised-dark: "#1C1C22"
  surface-overlay-dark: "#1C1C22"
  text-primary-dark: "#F0EDE8"
  text-secondary-dark: "#D6D2C8"
  text-muted-dark: "#A39D94"
  border-subtle-dark: "#3A3833"
  border-strong-dark: "#6B665E"
  brand-fill: "#2FB49C"
  brand-fill-hover: "#23907D"
  brand-text-light: "#0F6E56"
  brand-text-dark: "#2FB49C"
  brand-on-fill: "#04342C"
  brand-on-fill-hover: "#000000"
  accent-teal: "#2FB49C"
  accent-indigo: "#6E93F7"
  accent-violet: "#9C8CF5"
  accent-orange: "#EC7F13"
  domain-war-light: "#534AB7"
  domain-war-dark: "#9C8CF5"
  domain-event-light: "#0369A1"
  domain-event-dark: "#7DD3FC"
  domain-ops-light: "#3A3833"
  domain-ops-dark: "#D6D2C8"
  domain-community-light: "#954804"
  domain-community-dark: "#EC7F13"
  status-success-light: "#15803D"
  status-success-dark: "#4ADE80"
  status-warning-light: "#A16207"
  status-warning-dark: "#FBBF24"
  status-danger-light: "#DC2626"
  status-danger-dark: "#F87171"
  status-info-light: "#0369A1"
  status-info-dark: "#7DD3FC"
typography:
  display:
    fontFamily: '"Saira Semi Condensed", var(--font-body)'
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  h1:
    fontFamily: "var(--font-body)"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0px"
  h2:
    fontFamily: "var(--font-body)"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0px"
  h3:
    fontFamily: "var(--font-body)"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "0px"
  body:
    fontFamily: "var(--font-body)"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0px"
  body-strong:
    fontFamily: "var(--font-body)"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0px"
  small:
    fontFamily: "var(--font-body)"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0px"
  meta:
    fontFamily: "var(--font-body)"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0.06em"
  micro:
    fontFamily: "var(--font-body)"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0px"
rounded:
  control: "6px"
  surface: "10px"
  overlay: "14px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
components:
  primary-button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.brand-on-fill}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "var(--control-height-regular)"
  primary-button-hover:
    backgroundColor: "{colors.brand-fill-hover}"
    textColor: "{colors.brand-on-fill-hover}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "var(--control-height-regular)"
  secondary-button-light:
    backgroundColor: "{colors.surface-raised-light}"
    textColor: "{colors.text-primary-light}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "var(--control-height-regular)"
  secondary-button-dark:
    backgroundColor: "{colors.surface-raised-dark}"
    textColor: "{colors.text-primary-dark}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "var(--control-height-regular)"
  input-light:
    backgroundColor: "{colors.surface-sunken-light}"
    textColor: "{colors.text-primary-light}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "var(--control-height-regular)"
  input-dark:
    backgroundColor: "{colors.surface-sunken-dark}"
    textColor: "{colors.text-primary-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "var(--control-height-regular)"
  plate-light:
    backgroundColor: "{colors.surface-raised-light}"
    textColor: "{colors.text-primary-light}"
    typography: "{typography.body}"
    rounded: "{rounded.surface}"
    padding: "16px"
  plate-dark:
    backgroundColor: "{colors.surface-raised-dark}"
    textColor: "{colors.text-primary-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.surface}"
    padding: "16px"
  overlay-light:
    backgroundColor: "{colors.surface-overlay-light}"
    textColor: "{colors.text-primary-light}"
    typography: "{typography.body}"
    rounded: "{rounded.overlay}"
    padding: "16px"
  overlay-dark:
    backgroundColor: "{colors.surface-overlay-dark}"
    textColor: "{colors.text-primary-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.overlay}"
    padding: "16px"
  tab-active-light:
    backgroundColor: "transparent"
    textColor: "{colors.brand-text-light}"
    typography: "{typography.body-strong}"
    rounded: "0"
    height: "var(--control-height-regular)"
  tab-active-dark:
    backgroundColor: "transparent"
    textColor: "{colors.brand-text-dark}"
    typography: "{typography.body-strong}"
    rounded: "0"
    height: "var(--control-height-regular)"
  secondary-copy-light:
    backgroundColor: "{colors.surface-base-light}"
    textColor: "{colors.text-secondary-light}"
    typography: "{typography.body}"
  muted-copy-light:
    backgroundColor: "{colors.surface-base-light}"
    textColor: "{colors.text-muted-light}"
    typography: "{typography.small}"
  secondary-copy-dark:
    backgroundColor: "{colors.surface-base-dark}"
    textColor: "{colors.text-secondary-dark}"
    typography: "{typography.body}"
  muted-copy-dark:
    backgroundColor: "{colors.surface-base-dark}"
    textColor: "{colors.text-muted-dark}"
    typography: "{typography.small}"
  divider-subtle-light:
    backgroundColor: "{colors.border-subtle-light}"
    height: "1px"
    width: "100%"
  divider-strong-light:
    backgroundColor: "{colors.border-strong-light}"
    height: "1px"
    width: "100%"
  divider-subtle-dark:
    backgroundColor: "{colors.border-subtle-dark}"
    height: "1px"
    width: "100%"
  divider-strong-dark:
    backgroundColor: "{colors.border-strong-dark}"
    height: "1px"
    width: "100%"
  accent-swatch-teal:
    backgroundColor: "{colors.accent-teal}"
    rounded: "{rounded.control}"
    size: "32px"
  accent-swatch-indigo:
    backgroundColor: "{colors.accent-indigo}"
    rounded: "{rounded.control}"
    size: "32px"
  accent-swatch-violet:
    backgroundColor: "{colors.accent-violet}"
    rounded: "{rounded.control}"
    size: "32px"
  accent-swatch-orange:
    backgroundColor: "{colors.accent-orange}"
    rounded: "{rounded.control}"
    size: "32px"
  domain-war-label-light:
    backgroundColor: "{colors.surface-base-light}"
    textColor: "{colors.domain-war-light}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  domain-war-label-dark:
    backgroundColor: "{colors.surface-base-dark}"
    textColor: "{colors.domain-war-dark}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  domain-event-label-light:
    backgroundColor: "{colors.surface-base-light}"
    textColor: "{colors.domain-event-light}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  domain-event-label-dark:
    backgroundColor: "{colors.surface-base-dark}"
    textColor: "{colors.domain-event-dark}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  domain-ops-label-light:
    backgroundColor: "{colors.surface-base-light}"
    textColor: "{colors.domain-ops-light}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  domain-ops-label-dark:
    backgroundColor: "{colors.surface-base-dark}"
    textColor: "{colors.domain-ops-dark}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  domain-community-label-light:
    backgroundColor: "{colors.surface-base-light}"
    textColor: "{colors.domain-community-light}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  domain-community-label-dark:
    backgroundColor: "{colors.surface-base-dark}"
    textColor: "{colors.domain-community-dark}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  status-success-label-light:
    backgroundColor: "{colors.surface-base-light}"
    textColor: "{colors.status-success-light}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  status-success-label-dark:
    backgroundColor: "{colors.surface-base-dark}"
    textColor: "{colors.status-success-dark}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  status-warning-label-light:
    backgroundColor: "{colors.surface-base-light}"
    textColor: "{colors.status-warning-light}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  status-warning-label-dark:
    backgroundColor: "{colors.surface-base-dark}"
    textColor: "{colors.status-warning-dark}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  status-danger-label-light:
    backgroundColor: "{colors.surface-base-light}"
    textColor: "{colors.status-danger-light}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  status-danger-label-dark:
    backgroundColor: "{colors.surface-base-dark}"
    textColor: "{colors.status-danger-dark}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  status-info-label-light:
    backgroundColor: "{colors.surface-base-light}"
    textColor: "{colors.status-info-light}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  status-info-label-dark:
    backgroundColor: "{colors.surface-base-dark}"
    textColor: "{colors.status-info-dark}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
---

# Portal Design System

> Status: maintained implementation contract
> Governs: `apps/portal`, every page, light and dark themes, desktop and mobile  
> Audience: implementers, reviewers, and coding agents

## Overview

### Contract and authority

This file is the foundational visual specification for the portal. The frontmatter is a compact index; exact implemented values live in `apps/portal/styles/tokens.css`, `semantic.css`, `scale.css`, and `apps/portal/providers/ThemeProvider.tsx`. If prose or frontmatter drifts from those files, source wins and this document must be corrected in the same change.

`AppShell`, `route-metadata.ts`, `SectionHeader`, and `ContentFilterToolbar` define the maintained shell, heading, and responsive-filter compositions. Intentional foundational changes update the relevant source, focused tests, and this document together.

Normative words:

- **MUST / MUST NOT** are enforced and, where practical, covered by `apps/portal/styles/theme-tokens.test.ts` or a focused component test.
- **SHOULD** is the default. A deviation requires a comment at the call site explaining the product reason.
- Exact values are normative. Vague value ranges are not allowed.

### Product constraints

- Desktop and mobile are equally important. Desktop supports dense management; mobile supports fast viewing, registration, and interaction without becoming a reduced product.
- The portal is Chinese-first and bilingual. Long Chinese and English strings are both first-class test inputs.
- Light and dark modes ship together.
- Public and protected routes keep the same visual system; visual affordances must not weaken permission or session enforcement.
- Mantine is the sole foundational component library. Co-located or scoped CSS may style domain content, but may not recreate foundational component behavior.
- Roster's existing member card, pointer response, hover treatment, and audio signature are protected product character.

### Direction: Forged Material

The portal is a restrained guild operations console: anodised metal and smoked glass under one overhead light. It must not look like a neon launcher or a generic admin template.

Identity comes from material, typography, content, and controlled domain colour:

- surfaces have one physical read: field, plate, recess, or overlay;
- numbers are the loudest element on data-heavy screens;
- colour is spent on actions, data, status, and member identity, not general chrome;
- outside Roster, motion explains state and never performs decoration.

### Reference synthesis

The direction learns from, but does not copy, three references:

- [Linear](https://github.com/voltagent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md): machine-readable token discipline, scarce accent colour, and a clear dark surface ladder.
- [IBM](https://github.com/voltagent/awesome-design-md/blob/main/design-md/ibm/DESIGN.md): explicit component states, dense information hierarchy, and accessibility rigor.
- [PlayStation](https://github.com/voltagent/awesome-design-md/blob/main/design-md/playstation/DESIGN.md): game identity carried by content and media while interface chrome remains controlled.

Marketing-page patterns from those references are explicitly rejected: oversized display type, full-bleed campaign layouts, excessive empty space, dark-only assumptions, pill-heavy navigation, and English-only typography.

### Material versus effect

This distinction is load-bearing:

| | Material | Effect |
|---|---|---|
| Definition | surface gradient, root grain, edge highlight, border, low-alpha tint | glow, colour dispersion, 3D tilt, specular sweep, spring motion |
| Allowed location | shell, page field, plates, recesses, overlays | `MemberCard` only; Gallery lightbox may use backdrop blur only |
| State | static | pointer- or spring-driven |
| Runtime cost | one bounded paint | compositing and continuous response |
| Budget | only the recipes in this document | one component on one page |

Any glow, `filter: blur()`, dispersion shadow, 3D transform, or specular layer outside `apps/portal/components/shared/MemberCard.css` is forbidden. A surface that needs more presence gets a stronger edge or clearer hierarchy, not another effect.

## Colors

### Theme surface tokens

The four semantic surfaces form one ordered ladder in both themes:

| Token | Light source | Dark source | Role |
|---|---|---|---|
| `--surface-sunken` | `neutral-50` | `neutral-950` | app field, recess, input well |
| `--surface-base` | `neutral-25` | `neutral-900` | page workspace and shell canvas |
| `--surface-raised` | `neutral-0` | `neutral-850` | Paper, Card, panels |
| `--surface-overlay` | `neutral-0` | `neutral-850` | Modal, Drawer, Menu, Popover |

The values in the frontmatter are sourced from the existing L1 palette. Implementations consume semantic variables, never frontmatter hex values or `--palette-*` directly.

### Action, personalisation, domain, and status

The implemented system keeps four independent colour roles:

| Role | Prefix | User-selectable | Purpose |
|---|---|---:|---|
| Action | `--brand-*` | No | buttons, links, focus, selected controls, selected rows |
| Personalisation | `--accent-*` | Yes | the strict identity allowlist below |
| Domain | `--domain-*` | No | entity category and chart meaning |
| Status | `--status-*` | No | success, warning, danger, and information |

The action group is fixed teal and seeded from the existing teal ramp:

| Token | Source |
|---|---|
| `--brand-fill` | `--palette-teal-500` |
| `--brand-fill-hover` | `--palette-teal-600` |
| `--brand-tint` | light: `--palette-teal-50`; dark: teal-500 mixed 14% into `--surface-raised` |
| `--brand-border` | `--palette-teal-300` |
| `--brand-text` | light: `--palette-teal-700`; dark: `--palette-teal-500` |
| `--brand-on-fill` | `--palette-teal-900` |
| `--brand-on-fill-hover` | `--palette-ink-black` |

Verified contrast against `--surface-base`: brand text is 5.89:1 in light and 7.11:1 in dark; brand-on-fill is 5.30:1; hover text is 5.36:1. These values must not drift below WCAG AA.

### Personalisation allowlist

`--accent-*` may appear only in:

1. the active sidebar indicator;
2. the signed-in user's avatar ring;
3. the signed-in user's own `MemberCard` frame;
4. the accent picker in Settings;
5. the shell brand mark.

All other selection, focus, action, and link states use `--brand-*`. Add a guard so `var(--accent-` is rejected outside the allowlisted files.

### Domain colours

Domain colour is fixed across accent choices but has a light and dark text-safe value:

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--domain-war` | violet-700 | violet-500 | Guild War |
| `--domain-event` | info-deep | info-bright | Events |
| `--domain-ops` | neutral-700 | neutral-200 | Storage, Tools, routine operations |
| `--domain-community` | orange-700 | orange-500 | Announcements, Gallery, Wiki |

Each pair passes AA on `--surface-base`; the lowest measured pair is 5.63:1. Domain colour is allowed only as a Badge colour, a 3px leading rule, an icon tint, or a chart series. It must not fill an entire card, colour a routine button, or outline a whole panel.

### Status colours

`--status-success`, `--status-warning`, `--status-danger`, and `--status-info` keep their existing palette mapping. Status must always be paired with an icon, label, or shape. Colour alone never carries meaning.

### Colour usage rules

- Neutral chrome is the default.
- One composition should normally contain one action colour plus any genuinely meaningful domain or status colours.
- Text uses `--text-primary`, `--text-secondary`, or `--text-muted`; opacity is not a substitute for a text token.
- Selected does not mean success. Primary does not mean personalised accent.
- Colour literals remain confined to `styles/tokens.css`.

## Typography

### Bilingual constraint

A Latin display family has no CJK coverage. Chinese headings silently fall back to the UI stack, so hierarchy for Chinese must come from size, weight, and spacing.

- The display face is used only for numerals, short Latin labels, and the brand mark.
- Chinese headings use the UI stack.
- Negative letter-spacing must never be applied to CJK.
- English and Chinese must preserve the same hierarchy even when their glyph shape differs.

### Families

| Role | Family | Weight | Notes |
|---|---|---|---|
| UI, body, all CJK | existing `--font-body` stack | 400 / 600 / 700 | best platform CJK rendering, zero new body-font cost |
| Display and numerals | Saira Semi Condensed | 700 | self-hosted OFL Latin subset only |

Display font loading:

- self-host two `woff2` files, Latin and Latin-Ext subset only, at or below 30 KB total;
- apply `font-display: swap`;
- preload weight 700 only;
- declare `size-adjust` to keep CLS at or below 0.1;
- do not add another webfont.

The only family declaration exposed to components is:

```css
--font-display: "Saira Semi Condensed", var(--font-body);
```

### Scale

| Token | Size | Weight | Line height | Use |
|---|---:|---:|---:|---|
| `--text-display` | 40px | 700 | 1.2 | one hero number per page at most |
| `--text-h1` | 28px | 700 | 1.2 | large in-content heading |
| `--text-h2` | 22px | 700 | 1.2 | compact route title or major section |
| `--text-h3` | 18px | 700 | 1.35 | card title or subsection |
| `--text-body` | 14px | 400 | 1.6 | default copy and CJK paragraphs |
| `--text-sm` | 13px | 400 | 1.5 | dense rows and table cells |
| `--text-meta` | 12px | 600 | 1.35 | labels, captions, `SectionHeader` |
| `--text-micro` | 11px | 600 | 1.35 | badges and chart ticks, never sentences |

The scale ratio is 40:11, or 3.6. Hierarchy is carried primarily by type, not nested card backgrounds.

Letter-spacing:

| Context | Value |
|---|---|
| display numerals and short Latin display labels | `-0.02em` |
| Latin `h1` opt-in only | `-0.02em` |
| `SectionHeader` or overline | `0.06em`, uppercase for Latin only |
| CJK and normal text | `0` |

### Numerals

Every numeric value in a column, stat, progress readout, countdown, or chart axis uses:

```css
font-variant-numeric: tabular-nums;
font-feature-settings: "tnum" 1;
```

Expose this through one utility or shared style. KPI values additionally use `--font-display` at weight 700.

## Layout

### Surface ladder

Every page composition starts by choosing one of four levels. Skipping a level is allowed; inventing a fifth is not.

| Level | Surface | Owner | Typical content |
|---|---|---|---|
| L0 Field | `--surface-sunken` | root shell | ambient app background |
| L1 Workspace | `--surface-base` | `AppShell.Main` / `PageLayout` | page content canvas |
| L2 Plate | `--surface-raised` | Mantine `Paper` or `Card` | one semantic group |
| L3 Overlay | `--surface-overlay` | Mantine overlay primitives | temporary content above the page |

A page may place content directly on the workspace. A Plate exists only when it groups content semantically, not to make a heading look important. A Plate inside a Plate requires an interaction reason such as a recess, selected item, editor canvas, or drag target.

### Responsive shell contract

`AppShell` uses Mantine `AppShell` and owns all global offsets:

| Metric | Target |
|---|---:|
| header height | 48px |
| expanded desktop sidebar | 236px |
| collapsed desktop sidebar | 84px |
| mobile bottom navigation | 64px plus safe area |
| desktop header-to-content gap | 16px |
| mobile header-to-content gap | 12px |

The shell contract:

- exactly one visible route title, a semantic `h1` with the compact `--text-h2` visual size, appears in the header's left side;
- search, notifications, appearance/language, and account controls occupy the right side;
- no empty row or differently coloured strip may appear above the header;
- the content area must not repeat the route title or description;
- page actions and filters begin in the first content action row, not the global header;
- secondary global actions collapse into Mantine `Menu` or `Drawer` on small screens;
- route content must not add a compensating top margin;
- the shell owns scroll offset, safe-area padding, and the mobile navigation clearance.

At viewport widths up to 1023px, compact navigation replaces the desktop sidebar. The phone-specific header breakpoint remains 767px. The same route metadata generates the sidebar and compact navigation.

### Page padding and content width

| Condition | Horizontal page padding |
|---|---:|
| viewport below 768px | 12px |
| viewport from 768px up to 1199px | 16px |
| viewport at or above 1200px | 24px |

Named width modes:

| Mode | Maximum | Use |
|---|---:|---|
| Reading | 1120px | Wiki article, focused form |
| Standard | 1800px | browse and account pages |
| Wide | 2200px | Dashboard, Gallery, dense data |
| Workbench | available width | Guild War, Storage Management, Admin |

Horizontal centring applies to Reading, Standard, and Wide. Workbench keeps the page padding and uses the remaining width.

### Page templates

Templates are composition contracts, not new UI primitives:

| Template | Mantine foundation | Routes |
|---|---|---|
| Dashboard | `Container`, `Grid`, `Stack`, `Paper`, `Card` | Dashboard |
| Browse | `Container`, `Stack`, responsive filters, `SimpleGrid` or list | Events, Roster, Gallery, Tools |
| Master-detail | `Grid`, `ScrollArea`, `Drawer`, `Stack`, `Paper` | Announcements, Wiki |
| Workbench | `AppShell.Section`, `Grid`, `ScrollArea`, `Drawer`, peer-view `Tabs` | Guild War, Storage, Admin |
| Form workspace | `Container`, `Grid`, `Fieldset`, `Stack`, `Affix` | Profile, Settings, Storage Management |

Login and Register use a simplified auth composition built from Mantine `Paper`, form controls, `Alert`, and `Button`.

### Spacing ownership

The only spacing steps are `4 / 8 / 12 / 16 / 24 / 32 / 48`.

| Step | Owner |
|---:|---|
| 4px | icon-to-label micro-gap, compact inline metadata |
| 8px | tight rows, chip groups, field label-to-control |
| 12px | toolbar-to-result, mobile page gap |
| 16px | card padding, sibling sections, desktop header-to-content gap |
| 24px | large section separation and desktop page edge |
| 32px | distinct task phases |
| 48px | deliberate separation between major work areas only |

The parent owns the gap between siblings. Children must not add top margin to repair the parent's layout.

### Density and responsive transformation

- Text controls use 32px compact, 36px regular with a fine pointer, 44px regular with a coarse pointer, or 52px large. The shared hit-area token remains 44px.
- On compact layouts, dense data transforms into labelled rows, stacked records, or focused detail overlays rather than hiding primary actions behind horizontal scrolling.
- `ContentFilterToolbar` measures its own container: controls stay inline when space permits, move into a desktop Popover when compact, and use a bottom Drawer on phones. Search and primary information remain visible.
- Desktop and mobile may use different compositions, but must expose the same task outcome and state.

## Elevation & Depth

### Material recipes

Exactly five treatments exist.

#### M1 — App field

Applied once at the root:

```css
background: var(--surface-sunken);
```

Add one pre-baked 128×128 monochrome noise tile at opacity 0.03 in dark mode and 0.02 in light mode. A repeating CSS image is acceptable. SVG `feTurbulence` and per-card noise are forbidden.

#### M2 — Plate

The default Mantine `Paper`, `Card`, and panel treatment:

```css
background: var(--surface-raised);
border: 1px solid var(--border-subtle);
box-shadow: var(--edge-top);
```

#### M3 — Edge highlight

```css
/* dark */
--edge-top:
  inset 0 1px 0 rgb(255 255 255 / 0.06),
  0 1px 2px rgb(0 0 0 / 0.20);

/* light */
--edge-top:
  inset 0 1px 0 rgb(255 255 255 / 0.90),
  0 1px 2px rgb(10 10 15 / 0.06);
```

#### M4 — Recess

Inputs, wells, table headers, tracks, and drag targets:

```css
background: var(--surface-sunken);
border: 1px solid var(--border-strong);
```

#### M5 — Overlay

Mantine `Modal`, `Drawer`, `Menu`, and `Popover`:

```css
background: var(--surface-overlay);
border: 1px solid var(--border-subtle);
box-shadow: var(--shadow-overlay);
```

Foundational overlays remain solid. Backdrop blur is reserved for the protected `MemberCard` treatment and the full-screen Gallery lightbox overlay.

### Material rules

1. Material never decorates controls. Buttons, inputs, selections, tabs, and menu items are flat.
2. Any linear material gradient uses `160deg`; every highlight is on the top edge.
3. A surface gradient may not exceed a 6% luminance delta.
4. Grain appears once at the root.
5. A surface has at most two material layers: gradient plus edge.
6. A coloured surface tint may contain at most 4% brand or domain hue.
7. Gradient text, gradient borders, animated backgrounds, and gradient progress fills are forbidden.

### Elevation inventory

Exactly two reusable elevation tokens exist:

| Token | Value | Allowed use |
|---|---|---|
| `--edge-top` | M3 | every Plate and Overlay |
| `--shadow-overlay` | dark `0 18px 44px rgb(0 0 0 / .42)`; light `0 16px 40px rgb(10 10 15 / .18)` | Modal, Drawer, Menu, Popover, Tooltip |

Structural depth uses surface colour and border, not ad hoc drop shadows. `MemberCard`'s protected effect shadows are not generic elevation tokens.

### Light mode translation

Light mode is engraved plate in daylight, not a mechanical inversion of dark mode:

| Element | Dark | Light |
|---|---|---|
| field | cool near-black | warm paper |
| plate | lighter metal | white plate on warm paper |
| edge | white inset at 0.06 plus a low black edge | white inset at 0.90 plus a low dark edge |
| recess | sunken surface with strong border | sunken surface with strong border |
| root grain | 3% | 2% |
| Roster effect | dispersion glow | soft coloured drop shadow, no halo |

Every component phase implements and reviews light and dark together.

### Motion

| Token | Duration | Use |
|---|---:|---|
| `--motion-state` | 120ms | hover, focus, checked, colour |
| `--motion-overlay` | 180ms | Modal, Popover, Menu |
| `--motion-panel` | 240ms | Drawer, Collapse, Accordion |

Enter easing is `cubic-bezier(.2,.8,.2,1)`; exit easing is `cubic-bezier(.4,0,1,1)`.

- Animate transform and opacity only; do not animate width, height, top, left, or margin.
- Do not apply route transitions, page entrance choreography, or continuous loops.
- Do not layer a CSS transform transition onto an element whose transform is written per frame by Motion.
- `prefers-reduced-motion` disables non-essential translation and scale while retaining immediate state, colour, and opacity feedback.
- Roster's protected spring, hover scale 1.04, specular response, dispersion, audio timing, and reduced-motion branch are copied forward unchanged.

## Shapes

### Radius

Only three general radius tokens exist:

| Token | Value | Use |
|---|---:|---|
| `--radius-control` | 6px | buttons, inputs, tabs, badges, chips, selected rows |
| `--radius-surface` | 10px | Paper, Card, panels, wells |
| `--radius-overlay` | 14px | Modal and Drawer |

Circles use `50%` only for avatars, indicators, and circular icon buttons. A 999px pill is not a general-purpose radius. `MemberCard` keeps its existing protected radius.

### Controls and touch targets

| Size | Text control | Visible icon control | Minimum hit area |
|---|---:|---:|---:|
| compact | 32px | 22px | 44×44px |
| regular | 36px fine pointer / 44px coarse pointer | 28px | 44×44px |
| large | 52px | 40px | 52×52px |

Dense icon controls may use a transparent hit expander. Expanded hit areas must not overlap adjacent controls or be clipped by an ancestor.

### Icons

Use the existing Tabler icon set through Mantine component sections:

| Context | Size | Stroke |
|---|---:|---:|
| dense inline action | 16px | 1.75 |
| regular control | 18px | 1.75 |
| navigation | 20px | 1.75 |
| empty state | 24px | 1.5 |

Icons do not receive decorative rounded-square containers by default. A container is allowed only when it communicates brand, domain, status, or a large empty-state anchor. Emoji must not replace interface icons.

### Shape semantics

- Pills are reserved for status, tags, and compact selections.
- Peer navigation uses an underline or edge indicator, never floating pills.
- Cards are rectangles with `--radius-surface`; large floating capsules are not part of this system.
- Destructive controls keep the same geometry as routine controls; danger is communicated through status colour and text.

## Components

### Mantine-only foundation

Pages use Mantine directly for foundational UI:

- layout: `AppShell`, `Container`, `Stack`, `Group`, `Flex`, `Grid`, `SimpleGrid`, `Box`, `Center`, `ScrollArea`;
- typography: `Title`, `Text`, `Anchor`, `Divider`, `Code`;
- actions: `Button`, `ActionIcon`, `CloseButton`, `UnstyledButton`;
- forms: `TextInput`, `Textarea`, `PasswordInput`, `NumberInput`, `Select`, `MultiSelect`, `Checkbox`, `Radio`, `Switch`, `SegmentedControl`, `Slider`, `ColorInput`, `Fieldset`;
- navigation: `NavLink`, `Tabs`, `Breadcrumbs`, `Pagination`, `Stepper`;
- overlays: `Modal`, `Drawer`, `Menu`, `Popover`, `Tooltip`, `HoverCard`;
- surfaces: `Paper`, `Card`, `Accordion`, `Collapse`, `Spoiler`;
- data and state: `Table`, `Badge`, `Avatar`, `Indicator`, `Progress`, `RingProgress`, `Timeline`, `Alert`, `Notification`, `Skeleton`, `Loader`, `LoadingOverlay`.

Mantine Styles API, component `.extend()`, theme CSS variables, co-located CSS, and CSS Modules are the supported styling paths. CSS may style content inside a domain component; it may not reimplement keyboard, focus, overlay, menu, selection, or form behavior.

Foundational controls use Mantine directly. Parallel button, menu, and style-only surface wrappers are not permitted. A local component is justified only when it owns domain behavior, accessibility semantics, or a proven shared composition such as `SectionHeader` or `ContentFilterToolbar`.

### Component choice rules

| Need | Use | Do not use |
|---|---|---|
| routine text action | `Button` | custom depth button |
| icon-only action | `ActionIcon` with accessible name | bare clickable icon |
| low-frequency action list | `Menu` | permanent row of secondary buttons |
| binary preference | `Switch` | two-option Tabs |
| one choice from two to four compact values | `SegmentedControl` | pill Tabs |
| two to five peer workspaces | `Tabs` with underline | navigation chips |
| larger route group | `NavLink`, sidebar, Drawer, or Select | horizontally scrolling Tabs |
| temporary supporting detail | `Popover` or `HoverCard` | modal |
| task requiring focus or confirmation | `Modal` or `Drawer` | Popover |
| destructive confirmation | `Modal`, cancel initially focused | browser confirm |

### State matrix

Every foundational component implements every applicable state. Hover may never be the only way to discover an action.

| Component | Default | Hover / active | Focus | Disabled / loading / error |
|---|---|---|---|---|
| Primary `Button` | flat `--brand-fill`, `--brand-on-fill` | hover uses brand hover tokens; active may translate down 1px | two-ring focus | disabled includes a reason; loading preserves width and label context |
| Secondary `Button` | neutral raised surface and strong border | border strengthens; active darkens one neutral step | two-ring focus | no brand tint; loading preserves width |
| `ActionIcon` | transparent or neutral, accessible name required | neutral or brand tint; active shifts 1px | two-ring focus | disabled reason via Tooltip or adjacent text |
| Text and number inputs | M4 recess, subtle border | strong border only | brand border plus two-ring focus | disabled remains readable; error uses danger border, icon, and message; async loading uses a trailing Loader |
| Select, MultiSelect, Combobox | same field treatment as inputs | option row uses neutral hover; selected row uses brand tint and check | input and option focus both visible | disabled reason; empty and load errors appear inside dropdown |
| Checkbox, Radio, Switch | neutral track or border | stronger neutral edge | two-ring focus around the control | selected uses brand; disabled label remains legible |
| `SegmentedControl` | neutral M4 track | hover changes neutral surface | one visible group focus plus item keyboard state | selected item uses raised surface and brand text |
| `Tabs` | Mantine default/underline variant | text and underline strengthen | focus on each tab | active uses 2px brand underline; disabled stays readable; no pill background |
| `NavLink` | flat neutral row | neutral tint | two-ring focus | active has 3px indicator plus restrained tint; collapsed mode supplies Tooltip |
| `Paper` / `Card` | M2 Plate | no hover unless interactive | interactive card gets focus ring | interactive hover changes border/surface only; no generic lift, glow, or scale |
| `Menu`, `Popover`, `Tooltip` | M5 Overlay | item uses flat neutral tint | Mantine roving focus remains visible | destructive item uses danger icon and label; unavailable item includes reason |
| `Modal` / `Drawer` | M5 Overlay, labelled title, trapped focus | not applicable | initial and return focus are explicit | async submit locks duplicate action but keeps cancel rules clear |
| `Table` | workspace or Plate, value-axis hierarchy | optional neutral row tint | row action focus visible | selected row uses brand tint plus indicator; failure never becomes an empty table |
| `Badge` | semantic text plus low-alpha tint | no hover unless interactive | interactive Badge follows control focus | status always includes text or icon |
| Feedback | structural content preserved | retry or next action is explicit | action focus visible | Skeleton matches layout; error is Alert; empty state has exactly one next action |

The universal focus ring is:

```css
box-shadow:
  0 0 0 2px var(--surface-base),
  0 0 0 4px var(--brand-fill);
```

It must remain visible on Plate, Recess, and Overlay surfaces in both themes.

### Page-state contract

- **Loading:** structural Mantine `Skeleton` blocks match the final layout. Do not use a full-page centred spinner. Skeletons use the recess treatment without shimmer.
- **Empty:** one restrained icon, one-line reason, and exactly one next action. Never ship a dead end that only says “no data”.
- **Error:** preserve page structure and show an `Alert` with retry. A failed request must never render as a real zero or empty collection.
- **Disabled:** explain why through Tooltip or adjacent text.
- **Destructive confirmation:** use Mantine `Modal`; cancel takes initial focus; the danger action is visually separated from routine save actions.
- **Success:** use a bounded notification or inline confirmation. Do not replace content with a celebratory state.

### Roster protected signature

`MemberCard` is a domain component and the only exception to the otherwise restrained effect budget.

Protected behavior:

- existing card composition and radius;
- hover scale, pointer tilt, specular response, and colour dispersion;
- existing audio response and timing;
- keyboard focus affordance;
- touch fallback;
- reduced-motion branch;
- light-mode translation to a soft coloured shadow rather than a halo.

The audio is enhancement only and never the sole carrier of state. A global user preference must be able to mute it. Refactoring may change data plumbing or Mantine primitives around the card, but must not flatten, restyle, or silently remove this signature interaction. Before-and-after visual, pointer, keyboard, touch, audio, and reduced-motion checks are required.

### Data visualisation

ECharts remains the charting library:

- series order is war → event → ops → community using `--domain-*`;
- value-axis grid lines use an 8% text-primary mix; category-axis grid, chart border, and chart background are absent;
- axis and data labels use `--text-micro` with tabular numerals;
- area charts may use one vertical fade from 20% series colour to transparent;
- progress tracks use M4; fills are flat brand or threshold status colours;
- chart options consume the existing theme bridge and contain no hard-coded colour literals.

## Do's and Don'ts

### Do

- Start with the route task, then choose a page template and width mode.
- Use one route title in the shell header and begin content with the first actionable or informative element.
- Choose the lowest surface level that communicates the grouping.
- Use Mantine behavior first, then apply shared tokens through the theme or Styles API.
- Keep action, personalisation, domain, and status colour semantics separate.
- Design populated, loading, empty, error, disabled, and permission states together.
- Review desktop and mobile, Chinese and English, light and dark in the same phase.
- Preserve Roster's signature interaction deliberately.
- Extract a domain component only when it owns behavior or serves two confirmed consumers.

### Don't

1. Do not use glow, blur, dispersion, 3D tilt, or specular layers outside `MemberCard.css`; only the full-screen Gallery lightbox may additionally use its guarded backdrop blur.
2. Do not put gradients on buttons, inputs, selects, switches, tabs, or menu items.
3. Do not use gradient text, gradient borders, animated backgrounds, or looping decoration.
4. Do not define generic shadows outside `--edge-top` and `--shadow-overlay`.
5. Do not define a general radius outside the three shape tokens.
6. Do not use spacing outside the seven-step scale.
7. Do not consume `--accent-*` outside the personalisation allowlist.
8. Do not consume `--palette-*` in a component.
9. Do not place colour literals outside `styles/tokens.css`.
10. Do not add `var()` fallbacks inside token layers.
11. Do not add route or page entrance choreography.
12. Do not add a second webfont.
13. Do not apply negative letter-spacing to CJK.
14. Do not use proportional figures in data or statistics.
15. Do not nest surfaces purely to create another background.
16. Do not repeat title or description between shell and page content.
17. Do not use horizontally scrolling pill-tab strips.
18. Do not create a foundational control wrapper when Mantine already owns the behavior.
19. Do not hide a failed request behind a zero, empty collection, or logged-out state.
20. Do not remove or dilute Roster's protected interaction during architecture cleanup.

### Iteration guide

For every page or component batch:

1. Identify the user task, route template, width mode, and responsive transformation.
2. Select a direct Mantine primitive. If none fits, prove that the need is domain behavior rather than styling preference.
3. Select one surface level and tokens from this document.
4. Specify default, hover, active, focus, disabled, loading, empty, and error behavior before styling.
5. Implement dark and light together.
6. Verify at 375×812, 390×844, 768×1024, 1024×768, 1440×900, and 1920×1080, plus 200% zoom.
7. Test long Chinese and English labels, keyboard-only use, touch, reduced motion, and visible focus.
8. Run the token guards, focused component tests, `pnpm typecheck`, and the relevant build or smoke check.
9. If implementation needs a new foundational token, radius, shadow, primitive, or effect, stop and update this document before adding it.

### Acceptance checks

| # | Requirement | Verification |
|---|---|---|
| A1 | exactly eight distinct font-size steps; max/min ratio at least 3.0 | token test |
| A2 | exactly two generic elevation tokens and three general radius tokens | token test |
| A3 | effects stay inside `MemberCard.css`, with only the guarded Gallery lightbox backdrop blur exception | architecture guard |
| A4 | no gradient in a foundational control selector | grep guard |
| A5 | `var(--accent-` appears only in allowlisted files | token guard |
| A6 | every surface gradient uses 160deg | grep guard |
| A7 | light theme contains no halo glow | grep guard and visual check |
| A8 | numeric columns and stats use tabular figures | component test |
| A9 | exactly one visible route `h1` | render test |
| A10 | focus ring is visible on every interactive primitive in both themes | a11y and visual test |
| A11 | text and controls pass WCAG 2.2 AA across theme × accent | contrast test |
| A12 | LCP at most 2.5s and CLS at most 0.1 after font load | production measurement |
| A13 | foundational behavior imports from Mantine rather than a parallel UI library | dependency and import audit |
| A14 | Tabs use underline/default presentation and never global pills | theme and component test |
| A15 | shell owns one header-to-content gap; pages add none | layout test |
| A16 | page content does not duplicate route title or description | render test |
| A17 | Roster pointer, keyboard, touch, audio, reduced-motion, light, and dark signatures remain | focused regression checklist |

### Maintenance and validation

Foundational changes update the source token/theme layer, this document, and the focused guard or component test in one change. Token and theme values have one source; transitional duplicate systems are not permitted.

For design-system work, run the relevant focused tests from:

```bash
pnpm test -- apps/portal/styles/theme-tokens.test.ts \
  apps/portal/components/architecture-boundaries.test.ts \
  apps/portal/components/layout/AppShellAccessibility.test.ts \
  apps/portal/components/shared/SectionHeader.test.tsx \
  apps/portal/components/shared/ContentFilterToolbar.test.tsx
```

Add `pnpm typecheck` and `pnpm build` when implementation code changes. Use `pnpm release:check` only for a release candidate. Review representative phone, tablet, desktop, and zoomed layouts in both themes and languages; include keyboard, coarse pointer, and reduced-motion behavior when affected.

### Known risks

1. Forged Material becomes cheap-looking as soon as controls receive gradients, chrome becomes saturated, or multiple noise/effect layers accumulate.
2. Light mode will fail first if implemented after dark rather than beside it.
3. The display family has no CJK benefit; without the wider size hierarchy, typography work helps English only.
4. Fixed action teal and user-selectable personal accents have distinct semantics; validation must ensure routine action states never inherit the personal accent.
5. Root grain may cost paint time on large screens. If measurement shows a regression, remove grain before weakening the structural surface ladder.
6. Style-only wrappers can bypass Mantine keyboard, focus, and overlay behavior; foundational interactions must stay on Mantine primitives.
