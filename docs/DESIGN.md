---
name: "Infini Guild Management Portal"
description: "A bilingual, dual-theme guild operations interface using a restrained Forged Material language, shadcn/ui compositions backed by Base UI, and one protected high-character Roster interaction."
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
  domain-announce-light: "#954804"
  domain-announce-dark: "#EC7F13"
  domain-ops-light: "#4F6412"
  domain-ops-dark: "#86A91E"
  domain-gallery-light: "#136C13"
  domain-gallery-dark: "#1FB21F"
  domain-event-light: "#0369A1"
  domain-event-dark: "#7DD3FC"
  domain-wiki-light: "#185FA5"
  domain-wiki-dark: "#6E93F7"
  domain-war-light: "#534AB7"
  domain-war-dark: "#9C8CF5"
  domain-personal-light: "#8823C7"
  domain-personal-dark: "#C181E9"
  domain-admin-light: "#8E3687"
  domain-admin-dark: "#DE72D5"
  domain-roster-light: "#AD1F5F"
  domain-roster-dark: "#E779AA"
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
  domain-announce-label-light:
    backgroundColor: "{colors.surface-base-light}"
    textColor: "{colors.domain-announce-light}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  domain-announce-label-dark:
    backgroundColor: "{colors.surface-base-dark}"
    textColor: "{colors.domain-announce-dark}"
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
  domain-gallery-label-light:
    backgroundColor: "{colors.surface-base-light}"
    textColor: "{colors.domain-gallery-light}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  domain-gallery-label-dark:
    backgroundColor: "{colors.surface-base-dark}"
    textColor: "{colors.domain-gallery-dark}"
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
  domain-wiki-label-light:
    backgroundColor: "{colors.surface-base-light}"
    textColor: "{colors.domain-wiki-light}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  domain-wiki-label-dark:
    backgroundColor: "{colors.surface-base-dark}"
    textColor: "{colors.domain-wiki-dark}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
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
  domain-personal-label-light:
    backgroundColor: "{colors.surface-base-light}"
    textColor: "{colors.domain-personal-light}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  domain-personal-label-dark:
    backgroundColor: "{colors.surface-base-dark}"
    textColor: "{colors.domain-personal-dark}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  domain-admin-label-light:
    backgroundColor: "{colors.surface-base-light}"
    textColor: "{colors.domain-admin-light}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  domain-admin-label-dark:
    backgroundColor: "{colors.surface-base-dark}"
    textColor: "{colors.domain-admin-dark}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  domain-roster-label-light:
    backgroundColor: "{colors.surface-base-light}"
    textColor: "{colors.domain-roster-light}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  domain-roster-label-dark:
    backgroundColor: "{colors.surface-base-dark}"
    textColor: "{colors.domain-roster-dark}"
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

[Documentation home](../README.md)

> Status: maintained implementation contract
> Governs: `apps/portal`, every page, light and dark themes, desktop and mobile  
> Audience: implementers, reviewers, and coding agents

## Overview

### Contract and authority

This document is the portal's visual contract. The frontmatter is a compact index; the implemented values live in `apps/portal/styles/tokens.css`, `semantic.css`, `scale.css`, and `apps/portal/providers/ThemeProvider.tsx`. If this document disagrees with those sources, the source wins and this file must be corrected in the same change.

`AppShell`, `route-metadata.ts`, `admin-context-nav.ts`, `AdminContextNavigation`, `SectionHeader`, `PageSubnav`, `EntityNavigator`, and `ContentFilterToolbar` define the maintained shell, navigation, heading, entity-selection, and responsive-filter compositions. Any intentional foundational change updates the source, focused tests, and this document together.

**Unified navigation contract (2026-08-22):** the semantic migration is complete. Admin uses the shell's single context-switching sidebar, stable page tasks use `PageSubnav`, dynamic records use `EntityNavigator`, and page-level collections use `ContentFilterToolbar`. Vertical Admin Tabs and page-owned query bars are obsolete and must not return as compatibility paths or supported alternatives.

Normative words:

- **MUST / MUST NOT** guide implementation and review. Automated tests are reserved for stable behavior, accessibility, semantic contrast, and interaction contracts; they do not freeze exact CSS values or source layout.
- **SHOULD** is the default. Any deviation needs a call-site comment that explains the product reason.
- Exact values are normative. Vague value ranges are not allowed.

### Product constraints

- Desktop and mobile are equally important: desktop supports dense management, while mobile supports fast viewing, registration, and interaction without becoming a reduced product.
- The portal is Chinese-first and bilingual. Long Chinese and English strings are first-class test inputs.
- Light and dark modes ship together.
- Public and protected routes use the same visual system. Visual affordances must not weaken permission or session enforcement.
- Base UI is the sole headless behavior foundation. Source-owned shadcn/ui compositions under `components/ui/` provide the styled control boundary; domain CSS may style content but may not recreate keyboard, focus, overlay, selection, or form behavior.
- Roster's existing member card, pointer response, hover treatment, and audio signature are protected product character.

### Direction: Forged Material

The portal is a restrained guild-operations console: anodised metal and smoked glass under a single overhead light. It must not resemble a neon launcher or a generic admin template.

Identity comes from material, typography, content, and controlled domain colour:

- Each surface has one physical role: field, plate, recess, or overlay.
- Numbers are the loudest element on data-heavy screens.
- Colour is reserved for actions, data, status, and member identity, not general chrome.
- Outside Roster, motion explains state rather than decorating it.

### Source-owned imagery: Chinese wuxia world

The interface material remains restrained Forged Material; its environmental art
belongs to one fictional Zhonghua-wuxia/xianxia PC-game world. Primary routes,
landing, access, and system-status journeys use page-specific Chinese environments:
timber halls, tiled roofs, archives, tournament courts, supply pavilions, forges,
cloud seas, bridges and waterfalls in ink-blue, jade and restrained lantern light.
The work reads as mature high-fidelity game key art, never live-action cinema,
photography, cosplay, anime, cel shading, pastel fantasy or horror.

People are optional and may not be forced into every frame. A person who appears
stays at a distant scale or an outer edge unless the page specifically benefits
from a game-profile composition. Repeating a back-facing traveler and giant city
across routes is forbidden. Statues may exist as integrated architectural groups;
one isolated oversized statue may not be used as a shortcut for scale. Every
background protects a calm central UI field and moves narrative detail toward the
left, right, top or bottom edges required by its component.

Source exposure stays in a controlled midtone range with preserved shadow detail
and restrained highlights. Semantic scrims—not bleached source art or crushed
black levels—provide final contrast in both light and dark themes. Close portraits,
European castle forms, literal feature metaphors, embedded text, logos and modern
props remain forbidden.

Desktop public scenes protect the right-side card zone; landing protects its
left-side copy zone; portrait scenes are independently composed rather than
accidental desktop crops. Theme art is decorative and source-owned. It never
replaces member avatars, Gallery works, item photos, or Announcement/Wiki media.

### Reference synthesis

The system takes principles from, but does not copy, three references:

- [Linear](https://github.com/voltagent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md): machine-readable token discipline, scarce accent colour, and a clear dark surface ladder.
- [IBM](https://github.com/voltagent/awesome-design-md/blob/main/design-md/ibm/DESIGN.md): explicit component states, dense information hierarchy, and accessibility rigor.
- [PlayStation](https://github.com/voltagent/awesome-design-md/blob/main/design-md/playstation/DESIGN.md): game identity carried by content and media while interface chrome remains controlled.

The portal explicitly rejects their marketing-page patterns: oversized display type, full-bleed campaign layouts, excessive empty space, dark-only assumptions, pill-heavy navigation, and English-only typography.

### Material versus effect

Keep material and effect distinct:

| | Material | Effect |
|---|---|---|
| Definition | surface gradient, root grain, edge highlight, border, low-alpha tint | glow, colour dispersion, 3D tilt, specular sweep, spring motion |
| Allowed location | shell, page field, plates, recesses, overlays | `MemberCard` only; Gallery lightbox may use backdrop blur only |
| State | static | pointer- or spring-driven |
| Runtime cost | one bounded paint | compositing and continuous response |
| Budget | only the recipes in this document | one component on one page |

Glow, `filter: blur()`, dispersion shadow, 3D transform, and specular layers are forbidden outside `apps/portal/components/shared/MemberCard.css`. If a surface needs more presence, strengthen its edge or hierarchy instead of adding an effect.

**Radial gradients are the only named exception.** Exactly two files may contain `radial-gradient`; a third occurrence anywhere is a violation.

| File | What it owns |
|---|---|
| `styles/semantic.css` | the ambient recipe — the three lights of `--ambient-field` |
| `styles.css` | the empty-state icon well |

The guard names both files and asserts that each still contains a radial gradient, so the exception stays tied to its intended use.

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

The system keeps four separate colour roles:

| Role | Prefix | User-selectable | Purpose |
|---|---|---:|---|
| Action | `--brand-*` | No | buttons, links, focus, selected controls, selected rows |
| Personalisation | `--accent-*` | Yes | the strict identity allowlist below |
| Domain | `--domain-*` | No | entity category and chart meaning |
| Status | `--status-*` | No | success, warning, danger, and information |

The action group is fixed teal and comes from the existing teal ramp:

| Token | Source |
|---|---|
| `--brand-fill` | `--palette-teal-500` |
| `--brand-fill-hover` | `--palette-teal-600` |
| `--brand-tint` | light: `--palette-teal-50`; dark: teal-500 mixed 14% into `--surface-raised` |
| `--brand-border` | `--palette-teal-300` |
| `--brand-text` | light: `--palette-teal-700`; dark: `--palette-teal-500` |
| `--brand-on-fill` | `--palette-teal-900` |
| `--brand-on-fill-hover` | `--palette-ink-black` |

Against `--surface-base`, brand text is 5.89:1 in light mode and 7.11:1 in dark mode; brand-on-fill is 5.30:1; hover text is 5.36:1. These values must remain at or above WCAG AA.

### Personalisation allowlist

`--accent-*` may be used only in:

1. the active sidebar indicator;
2. the signed-in user's avatar ring;
3. the signed-in user's own `MemberCard` frame;
4. the accent picker in Settings;
5. the shell brand mark;
6. the shell's ambient field.

All other selection, focus, action, and link states use `--brand-*`. A guard rejects `var(--accent-` outside the allowlisted files.

**Quantity uses accent through named tokens, not the identity allowlist.** The list above is only for surfaces that identify the signed-in user. Amounts use semantic aliases so the allowlist stays meaningful.

Quantity surfaces consume a semantic name instead:

| Token | Value | Consumers |
|---|---|---|
| `--meter-fill` | `--accent-on-surface` | Progress fills, dashboard ratio meters |
| `--meter-track` | `--surface-sunken` | the same components' empty portion |
| `--series-accent` | `--accent-on-surface` | the lead slot of the categorical series, i.e. a single-series chart |

Only `semantic.css` maps these names to `--accent-*`; consumers reference `--meter-*` and `--series-accent`. Accent may fill a quantity bar or lead a chart's colour sequence, but it must not colour a button, link, or other action control. Those use `--brand-*`.

**Choose accent steps by their background, not by the thing being drawn.** `--accent-fill` stays at 500 in both modes because it is calibrated for ink on top of it, as in a button; `--accent-on-fill` is the matching ink. `--accent-on-surface` is 700 in light mode and 500 in dark mode because it is calibrated to read against a surface. Text (`--accent-text`), the lead series slot, and a meter fill all use this second case through the same token.

The distinction is essential: `--accent-fill` on `--meter-track` measures only 2.23–2.52:1 in light mode, making both halves of a progress bar blend together. `--accent-on-surface` measures 5.35–5.98:1 on the same track. A guard enforces the 3:1 non-text minimum for all four accents in both modes.

### Domain colours

Domain colour is fixed across accent choices and has a text-safe value for each theme:

| Token | Hue | Light | Dark | Destination |
|---|---:|---|---|---|
| `--domain-announce` | 30° | orange-700 | orange-500 | Announcements |
| `--domain-ops` | 75° | moss-700 | moss-500 | Storage, Tools |
| `--domain-gallery` | 120° | fern-700 | fern-500 | Gallery |
| `--domain-event` | 199° | info-deep | info-bright | Events |
| `--domain-wiki` | 224° | indigo-700 | indigo-500 | Wiki |
| `--domain-war` | 249° | violet-700 | violet-500 | Guild War |
| `--domain-personal` | 277° | orchid-700 | orchid-500 | Profile, Settings |
| `--domain-admin` | 305° | magenta-700 | magenta-500 | Admin console |
| `--domain-roster` | 333° | rose-700 | rose-500 | Roster |

Every pair passes AA on `--surface-base`; the lowest measured pair is 5.63:1. Domain colour is allowed only for a Badge, 3px leading rule, icon tint, chart series, or the ambient field's first light. It must not fill a whole card, colour a routine button, or outline a whole panel.

**Nine, and nine is the ceiling.** The sidebar lists twelve destinations, so "one hue per tab" is the obvious reading of the requirement and it is not achievable. Three constraints bound the ring, and each is a rule the palette already obeys rather than a preference invented here:

- the brand teal at 169° is reserved — it is what a selected sidebar item is painted with, and a route that tinted its page the same colour would make the selected row read as chrome;
- a domain stays at least 13° off a status hue (danger 0°, warning 43°, success 142°), 13° being the clearance the shipping orange-vs-warning pair already has and the tightest anywhere in the palette;
- domains stay at least 24° apart, the info-vs-indigo step that already ships as two distinguishable series colours.

Those leave room for nine. A tenth lands inside 13° of a neighbour, and the two pages stop being told apart — which is worse than sharing a hue on purpose, because the user cannot tell whether they moved. So two pairs merge, both times where the pair is already one thing: Storage and Tools are the same operational surface, and Settings is the configuration panel of Profile. Only the dashboard carries no domain at all; it is the site itself rather than a section of it, and leaving it on the user's chosen accent puts that choice on the first screen.

Domains never appear side by side — `data-domain` is singular on `<html>` — so the bar the ring has to clear is "recognisably changed after navigating", not "separable when adjacent". Within each hue the two steps are matched to the family's luminance profile (700 at ≈0.11, 500 at ≈0.33) at the family-median 70% saturation, so every ratio involving `--domain` lands within a few hundredths of war's and no single domain becomes the binding case for the ambient contrast budget. Derivation and the ramps themselves live in `tokens.css`.

### Status colours

`--status-success`, `--status-warning`, `--status-danger`, and `--status-info` keep their existing palette mapping. Status always needs an icon, label, or shape; colour alone never carries meaning.

### Colour usage rules

- Neutral chrome is the default.
- A composition should normally contain one action colour plus only genuinely meaningful domain or status colours.
- Text uses `--text-primary`, `--text-secondary`, or `--text-muted`; opacity is not a substitute for a text token.
- Selected does not mean success. Primary does not mean personalised accent.
- Colour literals remain confined to `styles/tokens.css`.
- Links use `--brand-text`, never the stronger interaction fill. The shared anchor rule maps directly to this calibrated text step in both themes, including rich-text content.

## Typography

### Bilingual constraint

A Latin display family has no CJK coverage. Chinese headings therefore fall back to the UI stack, so their hierarchy must come from size, weight, and spacing.

- The display face is used only for numerals, short Latin labels, and the brand mark.
- Chinese headings use the UI stack.
- Negative letter-spacing must never be applied to CJK.
- English and Chinese must preserve the same hierarchy even when their glyph shape differs.

`text-transform: uppercase` and positive `letter-spacing` are Latin typographic devices. Chinese has no letter case, so uppercasing does nothing and tracking separates related characters. Neither may be declared unconditionally. Both belong in a `:lang(en)` branch; the base rule carries the shared size, weight, and colour:

```css
.thing__label { font-size: var(--text-meta); font-weight: var(--fw-medium); }
.thing__label:lang(en) { font-weight: var(--fw-strong); letter-spacing: 0.06em; text-transform: uppercase; }
```

The selector is part of the contract: reviewers can grep for `text-transform: uppercase` and confirm every use is language-guarded.

### Families

| Role | Family | Weight | Notes |
|---|---|---|---|
| UI, body, all CJK | existing `--font-body` stack | 400 / 600 / 700 | best platform CJK rendering, zero new body-font cost |
| Display and numerals | Saira Semi Condensed | 700 | self-hosted OFL Latin subset only |

Display font loading:

- self-host two `woff2` files, with Latin and Latin-Ext subsets only, at or below 30 KB total;
- apply `font-display: swap`;
- preload weight 700 only;
- declare `size-adjust` to keep CLS at or below 0.1;
- do not add another webfont.

Components use this family declaration only:

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

The scale ratio is 40:11, or 3.6. Use type, not nested card backgrounds, as the primary hierarchy signal.

`SectionHeader` stays at `--text-meta`: level-two page sections use `--text-primary`, while deeper card labels use `--text-muted`.

Letter-spacing:

| Context | Value |
|---|---|
| display numerals and short Latin display labels | `-0.02em` |
| Latin `h1` opt-in only | `-0.02em` |
| `SectionHeader` or overline | `0.06em` and uppercase, both behind `:lang(en)` |
| CJK and normal text | `0` |

### Numerals

Use the following for every numeric value in a column, stat, progress readout, countdown, or chart axis:

```css
font-variant-numeric: tabular-nums;
font-feature-settings: "tnum" 1;
```

Expose this through one utility or shared style. KPI values also use `--font-display` at weight 700.

## Layout

### Surface ladder

Every page composition starts with one of four levels. A composition may skip a level, but it may not invent a fifth.

| Level | Surface | Owner | Typical content |
|---|---|---|---|
| L0 Field | `--surface-sunken` | navigation sidebar | permanent chrome |
| L1 Workspace | `--surface-base` + ambient field | shell root, header, `PageLayout` | page content canvas |
| L2 Plate | `--plate-fill` (the raised surface, opaque) | shadcn/ui `Card` or a semantic section | one semantic group |
| L3 Overlay | `--surface-overlay` | Base UI-backed overlay compositions | temporary content above the page |

**Only L1 is lit.** The ambient field belongs to the ground; L0, L2, and L3 are opaque and do not carry it. Letting a plate inherit the field would make its material depend on its page position. Keep sunken chrome, a lit workspace, and opaque plates as distinct levels of depth; only the most distant level moves.

The sidebar also stays unlit because the field carries the current route's domain hue. A permanent navigation rail must not change colour with the route it is pointing to.

A page may place content directly on the workspace. Use a Plate only for a semantic group, not to make a heading look important. A Plate inside a Plate needs an interaction reason, such as a recess, selected item, editor canvas, or drag target.

List rows are not a surface level. A row inside a Plate stays transparent, separated by a hairline and, for long lists, an alternating tint made from `--text-primary` at 3%. Giving every row its own surface makes it read as a slot rather than a list item. A row becomes a real surface only when detached: a drag overlay under the cursor uses `--surface-overlay` and `--shadow-overlay` because it has left the Plate.

### Responsive shell contract

The source-owned `AppShell` uses semantic HTML, CSS Grid/Flex, and one route metadata source to own every global offset:

| Metric | Target |
|---|---:|
| header height | 48px |
| expanded desktop sidebar | 236px |
| collapsed desktop sidebar | 84px |
| mobile bottom navigation | 64px plus safe area |
| desktop header-to-content gap | 16px |
| mobile header-to-content gap | 12px |

The shell contract:

- The header's left side contains exactly one visible route title: a semantic `h1` at the compact `--text-h2` visual size.
- Search, notifications, appearance/language, and account controls occupy the right side.
- No empty row or differently coloured strip may appear above the header.
- The content area must not repeat the route title or description.
- Page actions and filters begin in the first content action row, not the global header.
- Secondary global actions collapse into the Base UI-backed `DropdownMenu` or `Drawer` compositions on small screens.
- Route content must not add a compensating top margin.
- The shell owns scroll offset, safe-area padding, and mobile-navigation clearance.

The shell owns exactly one navigation surface. Portal routes render `PortalNav`; Admin routes replace those destinations with `ContextNav` and expose one “return to portal” action. The two sets never render as adjacent desktop rails. Desktop rail, compact navigation, and mobile Drawer are three responsive compositions of the same route metadata and permission result, not separately maintained menus.

At viewport widths up to 1023px, compact navigation replaces the desktop sidebar. The phone-specific header breakpoint remains 767px. The same route metadata drives both navigation forms.

Within a route, a media query must reuse one of four widths rather than introduce a new one. Each marks a real change in what fits and is declared in `em` with `max-width`:

| Query | Equivalent | What changes |
|---|---:|---|
| `39.99em` | 640px | phone portrait: tables become cards, multi-column collapses to one |
| `47.99em` | 768px | small tablet: master-detail stacks, four-up stat bars fold to two |
| `63.99em` | 1024px | tablet: panel heads stack, three-column groups narrow |
| `79.99em` | 1280px | narrow desktop: a vertical nav rail turns horizontal |

A JavaScript `useMediaQuery` that drives the same transformation must use its CSS counterpart's exact width.

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

Reading, Standard, and Wide are horizontally centred. Workbench keeps page padding and uses the remaining width.

### Page templates

Templates are composition contracts, not new UI primitives:

| Template | Composition foundation | Routes |
|---|---|---|
| Dashboard | responsive CSS Grid, semantic sections, `Card` | Dashboard |
| Browse | responsive filters, CSS Grid or list, `ScrollArea` where bounded | Events, Roster, Gallery, Tools |
| Master-detail | CSS Grid, bounded `ScrollArea`, responsive `Drawer` | Announcements, Wiki |
| Workbench | shell fill chain, CSS Grid, `ScrollArea`, `Drawer`, semantic navigation below | Guild War, Storage, Admin |
| Form workspace | centred layout, semantic `fieldset`, sticky action region | Profile, Settings, Storage Management |

Login and Register use the simplified source-owned auth frame with shadcn/ui form controls, `Alert`, and `Button`.

### Filled work surfaces

A Workbench work area that reaches the bottom of the content region is a layout contract, not a per-page style:

- **The fill is one unbroken chain.** Every element between the shell content slot and the filled region declares `flex: 1 1 auto` together with `min-block-size: 0`. A single missing `min-block-size: 0` restores the flex item's automatic minimum size, the chain collapses to content height, and the page grows a second scrollbar instead.
- **One region, one scroll owner.** Exactly one element inside a filled area declares `overflow-y: auto`; the panels within it scroll as a group. A panel that opens its own scroller inside a scrolling group traps the pointer and hides the list the fill existed to expose.
- **What must stay in view stays outside the scroller.** A reference panel — the source a user drags from, the totals they read against — sits beside the scrolling group, never inside it. That is the point of filling the height: the fixed side stays put while the variable side moves.
- **A filled list pins its rows to the start.** A flex or grid container that has just been handed extra height distributes it to its own tracks by default, so a list holding one row renders that row at full container height — its indicator rules stretch end to end and its content floats in the middle. Filled row containers declare `align-content: start`.
- **Below the desktop breakpoint the contract inverts.** The chain resets to `flex: 0 1 auto`, the region returns to content height, and the page scrolls as one column. Nested scroll regions on a phone are a trap, not a density gain.

### Spacing ownership

The only spacing steps are `4 / 8 / 12 / 16 / 24 / 32 / 48`.

Three quantities are not spacing and are therefore not held to this scale: hairlines and indicator rules (`1px` borders, the `2px` tab underline, the `3px` selected-row rule), the `44px` hit-area token, and control heights. They are measured against the thing they mark, not against the layout rhythm, and each already has its own token.

| Step | Owner |
|---:|---|
| 4px | icon-to-label micro-gap, compact inline metadata |
| 8px | tight rows, chip groups, field label-to-control |
| 12px | page rhythm (`--page-rhythm`), toolbar-to-result, mobile page gap |
| 16px | card padding, sibling sections |
| 24px | large section separation and desktop page edge |
| 32px | distinct task phases |
| 48px | deliberate separation between major work areas only |

The parent owns the gap between siblings. Children must not add top margin to repair the parent's layout.

**One page rhythm, one token.** The gap between top-level blocks on a page — filter toolbar to work area, section to section — is `--page-rhythm`, defined once on `.page-layout` as `--space-md`. It matches the shell page padding, the shell content gap, and the two-pane grid gap, so a page reads as one grid instead of several.

Pages that wrap their children in a further `Stack` (to pass remaining height down to a full-height workbench) must pass `gap="var(--page-rhythm)"`. They may not type a number. Before this rule the five workbench pages carried five different values — 24, 16, 16, 12, 12 — and the same visual gap was a different width on each page. Spacing is a property of the layout, not a per-page decision.

### Density and responsive transformation

- Text controls use 32px compact, 36px regular with a fine pointer, 44px regular with a coarse pointer, or 52px large. The shared hit-area token remains 44px.
- On compact layouts, dense data transforms into labelled rows, stacked records, or focused detail overlays rather than hiding primary actions behind horizontal scrolling.
- `ContentFilterToolbar` keeps search, an explicit `筛选 N` entry, an optional same-data `ViewSwitcher`, and visible actions in one stable order. Search owns the primary track; read-only result metadata and the tool cluster share the adjacent track, then reflow together below search when inline capacity is tight. Page CSS must not cap the search width or independently stretch and reorder toolbar actions. Query conditions always live in one desktop Popover or mobile bottom Drawer; they do not expand into a second inline filter row on wide screens. The filter count describes hidden query conditions only, never the visible search term.
- Settings option grids reflow from their own inline capacity with `auto-fit`; while capacity permits, option copy owns at least `12rem` before the preview and radio columns are allocated. Theme and accent choices show miniature surfaces made from the real semantic surface, border, ink, and action tokens rather than decorative colour dots.
- Desktop and mobile may use different compositions, but must expose the same task outcome and state.

## Elevation & Depth

### Material recipes

Exactly five treatments exist.

#### M1 — App field

One ambient image, defined once in `semantic.css` and painted on the ground:

```css
--ambient-layer-domain:
  radial-gradient(120% 105% at var(--ambient-x1) var(--ambient-y1),
    var(--ambient-domain), transparent 100%);
--ambient-layer-companion:
  radial-gradient(112% 118% at var(--ambient-x2) var(--ambient-y2),
    var(--ambient-companion), transparent 100%);
--ambient-layer-accent:
  radial-gradient(118% 108% at var(--ambient-x3) var(--ambient-y3),
    var(--ambient-accent), transparent 100%);

--ambient-field:
  var(--ambient-layer-domain),
  var(--ambient-layer-companion),
  var(--ambient-layer-accent),
  linear-gradient(160deg, var(--ambient-vignette), transparent 56%);

background-color: var(--surface-base);
background-image: var(--ambient-field);
background-attachment: fixed;
```

Mix ratios live in `semantic.css` as `--ambient-mix-domain` / `--ambient-mix-companion` / `--ambient-mix-accent`, so the light and dark difference is six numbers rather than two copies of the recipe.

**Three lights, none of them centred.** Two lights on opposite corners with near-equal radii sum to a straight diagonal ramp — the eye reads "one colour at the bottom left fading to another at the top right", which is the most generic gradient there is. Three fixes it structurally rather than by taste: the centres sit at (6%, 116%), (114%, 58%), and (42%, −14%), roughly 120° apart around the viewport and deliberately not collinear, so the field has a bend in it that no straight ramp can produce. The radii differ too (120×105, 112×118, 118×108) so the three falloffs never track each other.

**The third light turns a route into a colour pair.** Each domain declares a companion, and the companion is not hand-picked: it is the next hue clockwise on the domain ring, so the pairing has one rule instead of nine decisions and is guaranteed to sit at least 24° away. The consequence is that the nine sections give nine visibly different grounds — teal-into-indigo, violet-into-orchid — rather than nine hue rotations of the same picture. The third light is the user's accent, which is the same in every section and is what keeps the whole set recognisably one product.

Every centre sits outside the viewport, so no light reaches its own peak on screen. Review the field at the supported desktop and mobile viewports to ensure the colour reaches the full workspace without competing with content.

**Only the ground is lit.** Panels once painted the same image over their own `--surface-raised`, on the reasoning that panels cover most of the viewport and an unlit panel would leave the light showing only in the gutters. Two things came out of that. The light became the effective background of every word in the product, so the contrast budget had to be computed on washed surfaces and the mix ratios pressed down to where the light was barely visible at all — the fix defeating its own purpose. And because the image is fixed to the viewport rather than to the panel, a tall panel spanned a large slice of it: a card filled to the bottom of the content area read as a colour wash across its lower half, and a member card picked up a blue tint that belonged to the route, not to the member.

So the light is now the floor's, and panels are opaque. What makes that legible instead of empty is the field itself covering the whole viewport (above) — the ground is visible in every gutter, margin, and gap between plates, in every direction, rather than in one bright corner.

**The vignette is a floor move, not a panel move.** Darkening the far corner is how a floor shows which way the light runs; a panel that dimmed with its position would read as a different rung of the ladder rather than the same plate. Its colour is `--surface-sunken` at 62% rather than black, because sunken is below base in *both* modes and one recipe therefore covers each. Its dark end has to land where the light is weakest — measured at the top-left, 8.1% total light against 18.5% mid-screen — and 160° is the site's only material-gradient angle, so what flips is the colour stops rather than the axis: the vignette is written at the gradient's start and clears by 56%, and that start is the top-left end of the 160° axis.

**The ambient carries a contrast budget.** Body text sits directly on the ground wherever a page skips the plate level, so the mix ratios are not free-hand aesthetic values: they are bounded by the weakest ink step still clearing AA on the lit surface.

Contrast is verified on the semantic foreground/background token pairs that text and controls actually use. Compositional placement and atmospheric balance are reviewed visually rather than frozen through viewport sampling or pixel assertions.

Only `--surface-base` is in the budget. `raised` and `overlay` left it when panels stopped carrying the light; `sunken` was never in it, because the sidebar, inputs, and meter tracks paint it opaquely and nothing reaches behind them.

Each mode's ceiling is set by its own clean headroom, and the two are not symmetric. Light's binding surface has always been `base` (`#FAF9F5`), which is *darker* than `raised` — muted starts at 5.41 there, leaving 0.91 to spend, and 12/10/9 is the strongest the three lights go on that line. Dark's binding surface used to be `raised` (`#1C1C22`, brighter than base `#141418`), so removing the light from panels genuinely raised its ceiling: muted on base starts at 6.83, and the two lights at 16/15 became three at 20/16/14. Within each mode the extreme is `--domain-event`, whose dark step is `info-bright` `#7DD3FC` and lifts the surface further than the other eight; the five hues added with the ring were pinned to the 0.33 luminance line specifically so as not to create a second outlier.

**Tinted surfaces take `--text-secondary`, never muted.** `--brand-tint` and `--domain-tint` are washes over `raised`, not ladder steps; the semantic text token is covered by the ordinary WCAG contrast check.

A selected state still needs to read as *branded*, so dropping it to neutral secondary is not an option. That is what `--brand-on-tint` is for — the same "the step is chosen by what sits behind the colour" split as `--accent-on-surface`. In light the tint is pale enough that the text step already works and the two names resolve to one value. In dark they diverge: `--brand-text` is calibrated for the ladder and measures 5.26 on its own tint, the thinnest text ratio anywhere in the dark theme. `--brand-on-tint` moves up to `teal-300` for 7.32 on the tint and 9.14 on `raised`, so it holds on either ground with room to spare. Every place that paints brand ink on brand tint — the admin rail's selected tab in both orientations, the header icon hover, the active menu item — reaches through this one name.

**The three lights drift, and the budget constrains how.** Each runs its own loop — `ambient-drift-domain` over 53s, `ambient-drift-companion` over 67s, `ambient-drift-accent` over 43s. The three periods are pairwise co-prime, so the set does not visibly repeat. The six centre coordinates are registered with `@property` as `<percentage>`, because unregistered custom properties interpolate discretely and would make the lights jump rather than travel. `initial-value` is the sole statement of each resting position — no second copy in `:root`, and no `var()` fallback, which Don't rule 10 forbids for exactly that reason. This makes `@property` a hard dependency: an engine without it treats the coordinates as invalid and drops `--ambient-field` entirely. Every engine has shipped it since mid-2024 and the repo declares no earlier baseline.

Motion keeps the light centres outside the viewport and must stop under reduced motion. Validate that visually at the supported viewports; do not add tests for individual keyframe coordinates.

The timing function is `steps(200)`, and that is a performance decision rather than a stylistic one. One coordinate change repaints the whole ground. A half-cycle moves a centre 22% of the viewport width over 26.5s, so at 60Hz most frames shift it less than 0.4px and change nothing visible. Quantising to 200 steps makes each step 0.11% of viewport width — about 3px on a 2560px display, against a horizontal radius wider than the viewport, which moves any given pixel by under 0.05 of a colour level — while dropping the repaint rate to roughly 7.5Hz per layer. The cost is the soft turnaround that `ease-in-out` gave; it falls at the midpoint of a 26.5-second sweep, where constant speed is indistinguishable.

**`background-attachment: fixed` is what keeps the header seamless.** The shell root and the fixed header are separate elements with different boxes; painting the same gradient on both normally produces two different crops and a visible seam at the header edge. The header cannot simply let the ground show through — it has to be opaque over scrolling content — so it paints the image a second time, and `fixed` makes the viewport the positioning area for both, so the two elements paint pixel-identical regions. Any new element that needs to continue the field must set all three properties together; setting `background-image` alone re-introduces the seam.

Add one pre-baked 128×128 monochrome noise tile at opacity 0.05 in dark mode and 0.035 in light mode. At the previous 0.03 / 0.02 the grain was below the visible threshold on ordinary displays — it satisfied the rule while doing nothing, which left the workspace reading as one flat colour. The current values remain far below the level that interferes with body text. A repeating CSS image is acceptable. SVG `feTurbulence` and per-card noise are forbidden.

#### M2 — Plate

The default shadcn/ui `Card` and domain panel treatment:

```css
background: var(--plate-fill);
border: 1px solid var(--border-subtle);
box-shadow: var(--edge-top);
```

`--plate-fill` is the site's only plate material. It resolves to `--surface-raised` and nothing else — the plate is an opaque block, for the reasons under M1 — but `background: var(--surface-raised)` is still not a shorter way of writing it. `--surface-*` is the ladder rung, the raw stock; `--plate-fill` is the material made from it. Writing the rung directly puts the same statement in two layers, and the material is then unable to change without leaving every hand-written copy behind on the old one. That is not hypothetical: the material *did* carry an extra layer for a while, and the six panels that had spelled out their own `background: var(--surface-raised)` were the six that silently stopped matching.

A plate that has to be tinted — a drop target under a drag — writes its own surface colour outright, because there is no second layer left to preserve. What it must not do is invent a new border, radius, or shadow along with it.

A managed panel — any titled, bordered region that frames a body of content — must take this material from one shared class, never by redeclaring the three properties locally. Local redeclaration is how a console ends up with six panel materials that differ by a border colour and a radius, and no reviewer can tell which one is canonical. Panel-local CSS may set layout, padding, and scroll behaviour; it may not set `background`, `border`, `border-radius`, or `box-shadow`.

The admin console's implementation of that class is `.admin-panel` in `AdminPage.css`, with `.admin-panel__head`, `__title`, and `__body` (plus `--flush` and `--scroll` modifiers) supplying the internal structure.

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

Base UI-backed `Dialog`, `Sheet`, `Drawer`, `AlertDialog`, `DropdownMenu`, `Popover`, and `Tooltip` compositions:

```css
background: var(--surface-overlay);
border: 1px solid var(--border-subtle);
box-shadow: var(--shadow-overlay);
```

Foundational overlays remain solid. Backdrop blur is reserved for the protected `MemberCard` treatment and the full-screen Gallery lightbox overlay.

All application hover hints use the shared Base UI-backed `Tooltip`, not native HTML `title` bubbles. Compact labels and detailed cards share the theme-aware M5 surface, ink, border, shadow, and arrow; their variants change content layout, not colour mode. Tooltip content must wrap within the available viewport width and remain available on keyboard focus. Semantic titles for embedded frames and documents are not hover hints and stay intact.

Modal compositions share two source-owned class recipes in `components/ui/overlay-material.ts`: `OVERLAY_BACKDROP_CLASS_NAME` is the flat smoked `bg-black/60` scrim with no backdrop filter, and `OVERLAY_SURFACE_CLASS_NAME` maps the popup to the opaque M5 background, border, ink, and overlay shadow. `Dialog`, `Sheet`, `Drawer`, and `AlertDialog` consume both recipes without redefining either material. The Gallery lightbox's backdrop exception enters through its explicit overlay class; its protected `12px` backdrop blur is not a generic overlay option.

### Material rules

1. Material never decorates controls. Buttons, inputs, selections, tabs, and menu items are flat.
2. Any linear material gradient uses `160deg`; every highlight is on the top edge.
3. A surface gradient may not exceed a 6% luminance delta.
4. Grain appears once at the root.
5. A surface has at most two material layers: gradient plus edge.
6. A coloured surface tint may contain at most 4% brand or domain hue.
7. Gradient text, gradient borders, and gradient progress fills are forbidden. A background may animate only in the two places named in M1 and *Roster protected signature*, and only within the limits stated there: motion that cannot raise a glow's in-viewport peak, and a rate quantised to what the eye can actually resolve.

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
| `--motion-guild-pulse` | 32s linear | the single Dashboard guild-pulse loop; it must expose pause and stop under reduced motion |

Enter easing is `cubic-bezier(.2,.8,.2,1)`; exit easing is `cubic-bezier(.4,0,1,1)`.

Displacement amounts are tokens too, so that `prefers-reduced-motion` degrades at one point instead of in every component that happens to remember it:

| Token | Value | Use |
|---|---:|---|
| `--motion-lift` | `-2px` | hover raise on a pressable surface |
| `--motion-press` | `0.98` | press on a whole surface — card, list row |
| `--motion-sink` | `1px` | press on a small control — button, icon button |

Two press vocabularies exist because the feel differs with size: scaling a 36px button reads as blur, sinking a whole card reads as nothing. Under `prefers-reduced-motion` all three go to zero in `scale.css`; a component that writes a literal `1px` or `0.98` instead of the token silently opts out of that and is a defect.

- Animate transform and opacity only; do not animate width, height, top, left, or margin.
- Every clickable surface answers the pointer on press, not only on hover.
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

A row of a list is a control, and stacked rows are vertically adjacent, so a row's height *is* its hit area: it takes the 44px floor and may not reach it with an expander, which would necessarily overlap the row above or below. A list therefore never fixes its height to a row count. `block-size: 5 × row` leaves a four-member roster with half a card of void beneath it and forces a second scroller inside the card once the sixth member arrives; the list is sized by its content and scrolls only against a viewport-relative cap.

Column heads of a dense list are the one control exempt from the 44px floor. They take a 28px minimum, which clears the 24×24 of WCAG 2.2 SC 2.5.8 (Target Size, Minimum) — the level the floor exists to exceed rather than to meet. The exemption is bounded by what makes a head different from a row: a head cell is as wide as the column it labels, its neighbours are beside it rather than above and below it, and it never carries the destructive action. A column head must also leave a second route to the same sort, since the head is the first thing a narrow viewport drops.

### Icons

Use the existing Tabler icon set through the source-owned icon and UI compositions:

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

### Navigation and workspace semantics

Choose controls by the state they own, not by how many labels fit in a row:

| Intent | Contract | State owner | Examples |
|---|---|---|---|
| move between product areas | `PortalNav` | route path | Dashboard, Roster, Events, Gallery |
| move within a complex product context | `ContextNav` | route path | Admin people, configuration, operations, governance |
| move between two to five stable page tasks | `PageSubnav` | child route or explicit URL state | Profile sections; Guild War active, history, analytics; Events and recurring templates |
| change presentation of one result set | `ViewSwitcher` backed by the shared Toggle Group composition | query or local display state | cards/calendar, table/chart, analytics modes |
| select a dynamic record or hierarchy | `EntityNavigator` | entity ID in the route or query | storage/category, class/tag, notice, article |
| scan and edit a selected record | `MasterDetailWorkspace` | selected record ID | classes, badges, important notices, Wiki |
| switch one temporary panel inside a bounded flow | Base UI-backed `Tabs` | component state | Gallery add-media image/video input |

`PageSubnav` is navigation: it is deep-linkable, preserves browser history, and uses underline/default presentation. `ViewSwitcher` is not navigation and never contains creation, deletion, export, permission, or entity-selection actions. `EntityNavigator` may become a Select or Drawer on narrow screens, but its desktop and mobile forms read from one entity source.

`ContentFilterToolbar` is the only page-level collection query bar. Its final slots are `search`, `filters`, optional `view`, optional `actions`, and optional read-only `summary`. The component owns a full-width-capable search track, one wrapping metadata/tool region, Popover/Drawer behavior, focus return, filtering count, and coarse-pointer hit areas. Pages continue to own query values, URL synchronization, permissions, results, and mutations. Selection-only operations use a contextual selection action region after selection; they do not enter `filters`.

Do not preserve old and new navigation or toolbar structures in parallel. A migration removes the replaced Tabs, SegmentedControl, page toolbar CSS, and responsive branch in the same batch.

### Base UI and shadcn/ui foundation

Pages consume source-owned compositions from `components/ui/`; those compositions use Base UI primitives wherever an interaction needs headless behavior:

- layout: semantic HTML plus CSS Grid/Flex, with the shared `ScrollArea` for bounded scrolling;
- typography: native headings, text, anchors, dividers, and code styled by semantic tokens;
- actions: `Button` and icon-sized `Button` variants;
- forms: `Input`, `Textarea`, `PasswordInput`, `NumberField`, `Select`, `Combobox`, `Checkbox`, `RadioGroup`, `Switch`, `ToggleGroup`, `Slider`, and semantic `fieldset`;
- navigation: route links, Base UI-backed `Tabs`, `Breadcrumb`, and `Pagination`;
- overlays: `Dialog`, `Drawer`, `DropdownMenu`, `Popover`, `Tooltip`, and `HoverCard`;
- surfaces and state: `Card`, `Accordion`, `Collapsible`, `Table`, `Badge`, `Avatar`, `Progress`, `Alert`, `Toast`, and `Skeleton`.

Tailwind utilities define shared primitive composition; semantic custom properties and co-located domain CSS define product material and page layout. Domain CSS may not reimplement keyboard, focus, overlay, menu, selection, or form behavior.

Foundational controls use the existing `components/ui/` composition directly. Parallel button, menu, dialog, or style-only surface implementations are not permitted. A domain component is justified only when it owns domain behavior, accessibility semantics, or a proven shared composition such as `SectionHeader` or `ContentFilterToolbar`.

### Component choice rules

| Need | Use | Do not use |
|---|---|---|
| routine text action | `Button` | custom depth button |
| icon-only action | icon-sized `Button` with accessible name | bare clickable icon |
| low-frequency action list | `Menu` | permanent row of secondary buttons |
| binary preference | `Switch` | two-option Tabs |
| same-data view from two to four compact values | `ViewSwitcher` with `SegmentedControl` | page navigation or filter Tabs |
| two to five stable page tasks | `PageSubnav` with route state and underline presentation | local component state or navigation chips |
| one temporary bounded panel | `Tabs` with underline | route navigation or a page-wide mode system |
| dynamic entity or hierarchy | `EntityNavigator` using list, `NavLink`, `Select`, or `Drawer` | generated Tabs or horizontal scrolling chips |
| larger route group | `NavLink`, sidebar, Drawer, or Select | horizontally scrolling Tabs |
| temporary supporting detail | `Popover` or `HoverCard` | modal |
| task requiring focus or confirmation | `Modal` or `Drawer` | Popover |
| destructive confirmation | `Modal`, cancel initially focused | browser confirm |
| editing a record's own fields | one named edit control opening `Modal` or `Drawer` | a live input parked in the record's display surface |

**Editing is a mode you enter.** A display surface — a card head, a list row, a column header — shows values; it does not host live inputs for them. An always-editable field costs its full control height on every record whether or not anyone is editing, and it teaches nothing: the reader cannot tell which values are editable until they click one. Route every field of a record through a single edit control, so the affordance is discoverable in one place and the record itself stays a compact, readable line.

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
| `Tabs` / `PageSubnav` | Base UI-backed underline presentation | text and underline strengthen | focus on each item; arrow keys for true Tabs | active uses 2px brand underline; disabled stays readable; no pill background |
| `NavLink` | flat neutral row | neutral tint | two-ring focus | active has 3px indicator plus restrained tint; collapsed mode supplies Tooltip |
| `PortalNav` / `ContextNav` rail | flat transparent `NavLink` row | neutral surface tint | two-ring focus | selected uses a 3px brand indicator and restrained tint; the rail never becomes a second adjacent sidebar |
| `Paper` / `Card` | M2 Plate | no hover unless interactive | interactive card gets focus ring | interactive hover changes border/surface only; no generic lift, glow, or scale |
| `DropdownMenu`, `Popover`, `Tooltip` | M5 Overlay | item uses flat neutral tint | Base UI roving focus remains visible | destructive item uses danger icon and label; unavailable item includes reason |
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

- **Loading:** structural `Skeleton` blocks match the final layout. Do not use a full-page centred spinner. Skeletons use the recess treatment without shimmer.
- **Empty:** one restrained icon, one-line reason, and exactly one next action. Never ship a dead end that only says “no data”.
- **Error:** preserve page structure. A failed request must never render as a real zero or empty collection. Two shapes, chosen by what the failure costs the user:
  - *The content cannot render at all.* Use the empty-state block in its error status — icon, reason, and exactly one action, which is retry. It occupies the space the content would have, so it must offer the way out; telling the user to reload the page is not one, because a reload discards their filters, selection, and scroll position. The retry action is a required prop, not an optional one, so a call site cannot silently omit it.
  - *The content still renders and the message only qualifies it.* Use an `Alert`. It carries no retry when the recovery control is already on screen, and none is possible when the failure is a permission denial rather than a transport failure.
- **Disabled:** explain why through Tooltip or adjacent text.
- **Destructive confirmation:** use the Base UI-backed `Dialog`; cancel takes initial focus; the danger action is visually separated from routine save actions.
- **Success:** use a bounded notification or inline confirmation. Do not replace content with a celebratory state.

### Roster protected signature

`MemberCard` is a domain component and the only exception to the otherwise restrained effect budget.

Protected behavior:

- existing card composition and radius;
- hover scale, pointer tilt, specular response, and colour dispersion;
- the dispersion halo's rotation (see below);
- existing audio response and timing;
- keyboard focus affordance;
- touch fallback;
- reduced-motion branch;
- light-mode translation to a soft coloured shadow rather than a halo.

**The dispersion is a rotating halo, not three fixed shadows.** The same three fixed hues — `--glow-dispersion-cool`, `-mid`, `-warm` — now fill a `conic-gradient` on a blurred pseudo-element behind the card, turning once every 6s. At the resting angle cool, mid, and warm still fall left, below, and right, so the static frame matches the three-shadow arrangement it replaces.

It has to be its own layer rather than an animated `box-shadow`, and for the same reason the tilt is not a CSS transition: the card carries `transition: box-shadow`, so a per-frame shadow change would restart a transition every frame and smear the motion. The halo does not participate in that transition; only its `opacity` fade does. The layer is inset asymmetrically — less at the top, more at the bottom — to keep the lift the offset drop shadow used to give. Under `prefers-reduced-motion` the rotation stops at the resting angle and the hover still lights up, since the glow is the hover's only surface-level feedback.

Light mode keeps its "soft coloured drop shadow, no halo" rule without a second implementation. The same rotating layer is re-inset so its top edge sits *inside* the card by 10px: the card covers the upper arc, and only the lower fringe shows. What reads as a ring on a dark ground reads as a coloured shadow on paper, and the hue of that fringe still travels as the layer turns.

The audio is enhancement only and never the sole carrier of state. A global user preference must be able to mute it. Refactoring may change data plumbing or shared primitives around the card, but must not flatten, restyle, or silently remove this signature interaction. Before-and-after visual, pointer, keyboard, touch, audio, and reduced-motion checks are required.

### Data visualisation

ECharts remains the charting library.

**The chart theme is built from the live token layer, not from a palette of its own.** `theme/echarts.ts` reads the computed custom properties off `<html>` — that is, the result of `[data-theme] × [data-accent]` — and hands ECharts concrete strings, because ECharts cannot resolve `var()`. It previously held a private six-colour gold-and-brown ramp plus its own `Inter` stack and its own axis greys, none of which matched anything else in the portal and none of which responded to the accent. A chart is part of the page, not a guest on it.

- The series palette is `--series-accent` followed by `--series-1` … `--series-4`, de-duplicated by value: when the chosen accent belongs to a hue family the sequence already contains, the repeat is dropped rather than shown twice.
- Text is `--text-primary`, labels and legends `--text-muted`, axis lines `--border-subtle`, grid lines a 55% mix of the same, tooltips `--surface-overlay`, font `--font-body`.
- Radar split areas derive from `--text-primary`. The previous fixed white overlays were invisible against a light-mode plate.
- The caller must rebuild the theme when either the mode or the accent changes, and must vary the registered theme *name* with both — `echarts.registerTheme` caches by name, so a same-named re-registration is ignored.
- Axis and data labels use `--text-micro` with tabular numerals; category-axis grid, chart border, and chart background are absent.
- Area charts may use one vertical fade from 20% series colour to transparent.
- Progress tracks use `--meter-track`; fills use `--meter-fill`, or a status colour when the bar is reporting a state (failed, complete) rather than an amount.
- Chart options contain no hard-coded colour literals.

### Time

**The server stores UTC; the interface displays and edits in the viewer's local zone. Every crossing of that boundary goes through `utils/datetime.ts` — no module converts on its own.**

The rule exists because hand-rolled conversion does not fail loudly, it forks. Three splits had already appeared, each individually plausible:

- **The sign of an offset.** `Date.getTimezoneOffset()` returns *how many minutes local is behind UTC*, so UTC+8 yields −480. Two modules each picked one sign, and a reader of an `offsetMinutes` parameter had no way to tell which was meant. The offset is now east-positive (UTC+8 → +480) and comes only from `viewerUtcOffsetMinutes()`.
- **Whose "today".** `toISOString().slice(0, 10)` is the UTC day, not the reader's. East of UTC it is a day behind from early evening onward, which silently shifted absence windows, war-history grouping, and date-input bounds. Local day keys come from `localDateKey()`.
- **What a `datetime-local` value is.** It is a timezone-less local wall clock — neither ISO nor storable — and must cross through `toDateTimeLocalValue` / `fromDateTimeLocalValue` in both directions. Passing the raw string to `new Date()` is not equivalent: `"2026-08"` parses successfully and invents a day, an hour, and a timezone.

**A calendar date is not an instant.** `YYYY-MM-DD` values — absence start and end, a template's last generated day — carry no time and no zone. Rendering them through the local zone moves them a day for western viewers. They go through `formatCalendarDate` / `formatCalendarParts`, which pin UTC to mean *this value never had a zone*, and which reject a day that does not exist rather than rolling it forward into a real but different one.

Unreadable input renders as `EMPTY_TIME_TEXT`, never `Invalid Date` and never a blank; a wall-clock string that cannot be parsed is returned verbatim so bad data stays visible instead of being quietly rounded into something plausible.

## Do's and Don'ts

### Do

- Start with the route task, then choose a page template and width mode.
- Use one route title in the shell header and begin content with the first actionable or informative element.
- Choose the lowest surface level that communicates the grouping.
- Use Base UI behavior through the existing shadcn/ui composition first, then apply shared semantic tokens.
- Keep action, personalisation, domain, and status colour semantics separate.
- Design populated, loading, empty, error, disabled, and permission states together.
- Review desktop and mobile, Chinese and English, light and dark in the same phase.
- Preserve Roster's signature interaction deliberately.
- Extract a domain component only when it owns behavior or serves two confirmed consumers.

### Don't

1. Do not use glow, blur, dispersion, 3D tilt, or specular layers outside `MemberCard.css`; only the full-screen Gallery lightbox may additionally use its guarded backdrop blur, and only `styles/semantic.css` and `styles.css` may hold a radial gradient.
2. Do not put gradients on buttons, inputs, selects, switches, tabs, or menu items.
3. Do not use gradient text or gradient borders. Looping background motion exists in exactly two places — the app field's two drifting glows (M1) and the Roster card's rotating dispersion halo (*Roster protected signature*). Adding another looping field requires a stated contrast/performance bound, design review, and reduced-motion stop.
4. Do not define generic shadows outside `--edge-top` and `--shadow-overlay`.
5. Do not define a general radius outside the three shape tokens.
6. Do not use spacing outside the seven-step scale, and do not type a page-level block gap as a number instead of `--page-rhythm`.
7. Do not consume `--accent-*` outside the personalisation allowlist; quantity surfaces use `--meter-*` and `--series-accent` instead of widening that list.
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
18. Do not create a parallel foundational control when Base UI or an existing `components/ui/` composition already owns the behavior.
19. Do not hide a failed request behind a zero, empty collection, or logged-out state.
20. Do not remove or dilute Roster's protected interaction during architecture cleanup.

### Iteration guide

For every page or component batch:

1. Identify the user task, route template, width mode, and responsive transformation.
2. Select an existing shadcn/ui composition backed by Base UI. If none fits, prove that the need is domain behavior rather than styling preference.
3. Select one surface level and tokens from this document.
4. Specify default, hover, active, focus, disabled, loading, empty, and error behavior before styling.
5. Implement dark and light together.
6. Verify at 375×812, 390×844, 768×1024, 1024×768, 1440×900, and 1920×1080, plus 200% zoom.
7. Test long Chinese and English labels, keyboard-only use, touch, reduced motion, and visible focus.
8. Run focused behavior, accessibility, and contrast tests, `pnpm typecheck`, and the relevant build or smoke check.
9. If implementation needs a new foundational token, radius, shadow, primitive, or effect, stop and update this document before adding it.

### Acceptance checks

This table is a review checklist. Automate only stable behavior, accessibility, semantic contrast, data, security, or runtime contracts. Exact CSS values, selectors, file ownership, geometry, and pixel composition are verified through design review instead of unit tests.

| # | Requirement | Verification |
|---|---|---|
| A1 | exactly eight distinct font-size steps; max/min ratio at least 3.0 | design-system review |
| A2 | exactly two generic elevation tokens and three general radius tokens | design-system review |
| A3 | effects stay inside `MemberCard.css`, with only the guarded Gallery lightbox backdrop blur exception | design review |
| A3b | `radial-gradient` appears in exactly the two named owner files (`styles/semantic.css`, `styles.css`), and each of them still contains one | design review |
| A4 | no gradient in a foundational control selector | design review |
| A5 | `var(--accent-` appears only in allowlisted files; quantity surfaces reach the accent through `--meter-*` / `--series-accent` | design-system review |
| A6 | every surface gradient uses 160deg | design review |
| A7 | light theme contains no halo glow | visual review |
| A8 | numeric columns and stats use tabular figures | visual review |
| A9 | exactly one visible route `h1` | render test |
| A10 | focus ring is visible on every interactive primitive in both themes | a11y and visual test |
| A11 | text and controls pass WCAG 2.2 AA across theme × accent | contrast test |
| A12 | LCP at most 2.5s and CLS at most 0.1 after font load | production measurement |
| A13 | foundational interactive behavior comes from Base UI through the shared shadcn/ui boundary, with no legacy UI dependency or parallel primitive | dependency and import audit |
| A14 | Tabs use underline/default presentation and never global pills | interaction and visual review |
| A14b | `PageSubnav`, `ViewSwitcher`, entity selection, filters, and actions are not substituted for one another; every route uses the semantic matrix above | route review |
| A14c | `ContentFilterToolbar` exposes only its final semantic slots; hidden filters use one desktop Popover or mobile Drawer and page-owned query bars do not reappear | focused component and boundary tests |
| A15 | shell owns one header-to-content gap; pages add none | layout review |
| A15b | every page-level block gap resolves through `--page-rhythm`; no page passes a literal `Stack gap` at that level | design-system review |
| A21 | the root grain sits at 0.05 dark / 0.035 light | visual review |
| A22 | the chart theme reads `--series-*`, `--text-*`, `--border-subtle`, `--surface-overlay`, and `--font-body`, and holds no colour literal of its own | chart theme test |
| A23 | press displacement uses `--motion-press` or `--motion-sink`, never a literal, so reduced motion degrades at one point | interaction review |
| A24 | the light and dark blocks of `semantic.css` declare exactly the same token names | token test |
| A25 | the four fixed series slots are mutually distinct in both modes, and every series hue is drawn from the accent set at that mode's step | token test |
| A26 | `--meter-fill` clears 3:1 against `--meter-track` for all four accents in both modes | contrast test |
| A27 | shared anchors and rich-text links resolve to `--brand-text`, never the stronger interaction fill | design-system review |
| A28 | semantic foreground/background pairs used by body and muted text clear WCAG 2.2 AA in both modes | contrast test |
| A29 | tinted surfaces (`--brand-tint`, `--domain-tint`) carry `--text-secondary`, which clears 4.5:1; `--text-muted` is left with under 0.5 of margin there, which is why it is banned | contrast test |
| A30 | `--brand-on-tint` clears 4.5:1 on both `--brand-tint` and `--surface-raised`, in both modes | contrast test |
| A31 | ambient drift remains unobtrusive and stops under reduced motion | interaction and visual review |
| A32 | no `Paper` or `Card` root restates a ladder surface as its own background instead of taking the plate material | design-system review |
| A16 | page content does not duplicate route title or description | render test |
| A17 | Roster pointer, keyboard, touch, audio, reduced-motion, light, and dark signatures remain | focused regression checklist |
| A18 | in the admin console, a managed panel's own class declares no `background`, `border`, `border-radius`, or `box-shadow`; the material comes only from `.admin-panel` | design-system review |
| A19 | in `SectionHeader` and the admin console, `text-transform: uppercase` and positive `letter-spacing` appear only on a `:lang(en)` selector | localization review |
| A20 | a load failure that replaces content offers retry, and the retry callback is a required prop | typecheck plus render test |
| A33 | a list row declares no surface of its own and no fixed height; its floor is the 44px hit-area token and its column template is shared with the column head | interaction and visual review |
| A34 | a filled work region has one bounded scroll owner and remains keyboard- and touch-scrollable without moving the whole page | interaction test and responsive review |
| A35 | a record's display surface hosts no live input; its fields are reached through one named edit control | interaction review |
| A36 | the ambient stays on the ground: only `semantic.css` composes the `--ambient-layer-*` gradients, only it and `AppShell.css` name `--ambient-field`, `--plate-fill` resolves to the bare raised surface, and no `--plate-glow` comes back | design-system review |
| A38 | every route `domain` has a matching semantic colour context and the field remains balanced across supported viewports | route test and visual review |
| A37 | no portal module outside `utils/datetime.ts` reaches for `getTimezoneOffset`, `toISOString().slice(`, `toLocaleDateString`, `toLocaleTimeString`, or `Intl.DateTimeFormat`; a calendar date renders the day it was written on in every timezone | boundary test, unit test |
| A39 | Portal and Admin contexts render one navigation surface from one permission-filtered route source; no desktop composition contains adjacent global and Admin rails | shell accessibility and route tests |

A18 and A19 are scoped to where the convergence has actually landed. Widening either to the whole portal is a migration, not a re-reading of the check — see Known risks.

### Maintenance and validation

Foundational changes update the source token/theme layer and this document in one change. Add or update tests only when a stable behavior, accessibility, or contrast contract changes. Token and theme values have one source; transitional duplicate systems are not permitted.

For design-system work, run the relevant focused behavior and accessibility tests from:

```bash
pnpm test apps/portal/styles/theme-tokens.test.ts \
  apps/portal/components/architecture-boundaries.test.ts \
  apps/portal/components/layout/AppShellAccessibility.test.ts \
  apps/portal/components/shared/SectionHeader.test.tsx \
  apps/portal/components/shared/ContentFilterToolbar.test.tsx
```

Add `pnpm typecheck` and `pnpm build` when implementation code changes. Use `pnpm release:check` only for a release candidate. Review representative phone, tablet, desktop, and zoomed layouts in both themes and languages; include keyboard, coarse pointer, and reduced-motion behavior when affected.

**Checking a theme in a live browser means loading the page in that theme.** Switch the theme through the app, reload, and audit one theme per pass so component state, system colour scheme, charts, and media all initialize from the same mode. The token layer itself is safe to sweep in place because `[data-theme]` custom properties re-resolve; that is how the accent × theme numbers in this document were measured.

### Known risks

1. Forged Material becomes cheap-looking as soon as controls receive gradients, chrome becomes saturated, or multiple noise/effect layers accumulate.
2. Light mode will fail first if implemented after dark rather than beside it.
3. The display family has no CJK benefit; without the wider size hierarchy, typography work helps English only.
4. Fixed action teal and user-selectable personal accents have distinct semantics; validation must ensure routine action states never inherit the personal accent.
5. Root grain may cost paint time on large screens. If measurement shows a regression, remove grain before weakening the structural surface ladder.
6. Style-only wrappers can bypass Base UI keyboard, focus, and overlay behavior; foundational interactions must stay on Base UI-backed shared compositions.
7. English-only uppercase treatments must remain guarded by `:lang(en)` so Chinese labels never inherit Latin letter spacing.
