# Tools (`/tools`)

@FEATURE: TOOLS
@ROLE: External (read-only), Member, Moderator, Admin

## Summary

A growing utility hub for guild members. Designed to expand over time with small tools and helpers.

## Access

- External: read-only (view tools and descriptions only)
- External route visibility: always visible in v1
- Members: full use
- Admin/Mod: full use

### Tool Card Design

- Hover animation + subtle glow
- Icon + tool name + 1-line description

## Initial Tool Set (v1)

### 1. HTML Title Sandbox

- Visual editor for `title_html` (the styled member title)
- Text input box with live preview
- **Typography controls:**
  - Bold, italic, underline toggles
  - Font size selector
  - Text alignment options
- **Full color picker widget (Chrome-style):**
  - HSL color area (saturation/lightness square + hue slider)
  - Hex code input field for precise color entry
  - Opacity slider (alpha channel)
  - 12 preset color swatches for quick selection (common guild title colors)
  - Recent colors row (last 5 used, stored in localStorage)
  - Gradient color support for multi-color titles
- Output: sanitized HTML string (same allowlist as `title_html` in Global.md)
- "Copy HTML" button → copies raw HTML string to clipboard
- "Copy example" button with pre-made examples
- Preview renders with DOMPurify (same rules as roster card)

## v1 Scope

- v1 ships with exactly 1 tool: HTML Title Sandbox
- No additional tools planned for v1; page remains extensible for future releases

## Storage

- Tools can be: hardcoded features
- Every tool has an ID and a short "What it does" section for searchability


## Permissions

| Action | External | Member | Moderator | Admin |
|--------|----------|--------|-----------|-------|
| View tools | Yes | Yes | Yes | Yes |
| Use tools | No (read-only) | Yes | Yes | Yes |
| Edit tool templates | No | No | Yes | Yes |

## Freshness

- Static content; no realtime requirements
