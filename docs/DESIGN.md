# Portal design contract

[Documentation home](../README.md) · [中文版本](./DESIGN.zh.md)

This document records the stable interface rules for the current Portal. Source CSS and components remain authoritative for exact values.

## Direction

The Portal uses a restrained forged-material interface over cinematic wuxia environments. Character comes from the guild identity, panoramic scenes, typography and a few domain colours. Controls remain familiar, readable and consistent. Avoid ornamental frames around every object, excessive nested cards, arbitrary gradients and decorative effects that compete with content.

Site Config owns the public name and guild logo. The same identity appears on the public header, sign-in, invitation registration, account recovery, verification and status pages. Environmental artwork never replaces member avatars, Gallery works, item photos or Announcement/Wiki content media.

## Typography and language

- Body text uses `Inter`; Chinese uses `Noto Sans SC` with `Microsoft YaHei` and system fallbacks.
- Display headings use `Saira Semi Condensed`; code and technical values use the shared monospace stack.
- English and Chinese resources are equal product surfaces. Layouts must tolerate longer translations without clipping, squeezing labels or splitting related controls.
- Headings establish hierarchy; borders and colour do not substitute for clear labels and grouping.

## Colour, surfaces and imagery

- Components consume semantic tokens from `styles/semantic.css` and scale tokens from `styles/scale.css`. Do not hard-code a second theme inside a page.
- Light and dark themes must both preserve text contrast, visible focus, error/warning meaning and disabled-state clarity.
- Workspace pages use the three route-owned scenes defined in `components/layout/route-metadata.ts`. Public, access and status pages use their dedicated responsive assets. See [VISUAL_PRESETS.md](./VISUAL_PRESETS.md).
- Readable content sits on sufficiently opaque semantic surfaces. The scene may remain visible at page edges, but must not reduce legibility.
- Domain colours identify meaning such as announcements, events, guild war and storage. The primary action colour identifies interaction. Do not use either as decoration without meaning.

## Layout

- `PageLayout` and route metadata own the reading, standard and wide content limits. Pages remain centred within their available workspace.
- Each section owns one spacing boundary. Avoid card-inside-card repetition, stray dividers and unrelated blocks with inconsistent gaps.
- Desktop, tablet and phone may rearrange content, but preserve task parity. Controls remain reachable without horizontal scrolling.
- Forms align labels, fields, help and errors as one unit. Password requirements sit beside the fields only when width permits and stack cleanly on smaller screens.
- Access and status cards use a compact readable measure, balanced padding and one clear primary action. They display the configured guild identity and localized server or validation messages.

## Components and interaction

- Use source-owned shadcn/ui compositions backed by Base UI for dialogs, menus, popovers, selection, focus and keyboard behavior.
- TanStack Query owns server state; components do not duplicate request state merely to style it.
- Use one obvious primary action per task area. Secondary and destructive actions retain clear labels and permission-aware states.
- Loading, empty, error, forbidden, unauthorized, not-found and maintenance states must explain what happened and offer the next valid action when one exists.
- Loading uses a top progress bar and a localized spinner with text inside the affected region, never skeleton blocks. Route modules load before replacing the current page; refreshes retain existing content. List filters can retain results only within the same session and viewing mode, with pagination paused until fresh results arrive. Reduced motion disables spinner rotation and page fades.
- Animations communicate state or spatial change. The user Reduce motion preference and the operating-system preference must remove nonessential movement without hiding results.

## Accessibility and review

Every changed page must be checked in English and Chinese, light and dark themes, keyboard operation, reduced motion and representative desktop/phone widths. Verify:

- semantic headings and labels;
- visible focus and logical tab order;
- contrast for text, controls, errors and disabled states;
- 44px touch targets where controls are used on touch layouts;
- reflow at zoom and with long translated text;
- no unexpected horizontal overflow;
- real loading, empty, validation, permission and server-error states;
- background artwork remains decorative and does not duplicate accessible text.

Tests should protect behavior, accessibility and responsive contracts. Exact pixels, border widths and CSS class names belong to visual review unless they encode a real product invariant.
