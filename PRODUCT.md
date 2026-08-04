# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Infini Guild Management serves two primary groups:

- Guild administrators and moderators who organize members, permissions, events, announcements, wars, media, knowledge, storage, and site configuration.
- Guild members who check current information, manage their profiles, join activities, review guild-war information, browse shared media and knowledge, and interact with other members.

Desktop and mobile are equally important. Every primary workflow must be complete, understandable, and comfortable on both rather than treating mobile as a reduced companion experience.

## Product Purpose

The portal gives a game guild one self-hosted place to operate instead of splitting important information across spreadsheets, Discord pins, isolated media folders, and one-off utilities. Success means administrators can run the guild efficiently while members can find current information and act without needing technical knowledge or procedural guidance.

## Positioning

The portal combines guild operations, member participation, shared knowledge, media, and game-specific war planning in one configurable system. D1-backed site settings and catalogs supply runtime customization, while small shared domain contracts keep persisted event and guild-war data consistent across the frontend and backend.

## Operating Context

- Frequent guild operations include reviewing the dashboard, publishing announcements, scheduling events, managing signups, maintaining the roster, planning guild wars, curating wiki and gallery content, managing storage, and administering roles and invitations.
- Members commonly arrive to scan current state and complete a short action, such as reading an announcement, joining an event, checking a war plan, opening a profile, or finding a wiki article.
- Selected content is public, while profile, storage, administration, and privileged actions require authentication and permission checks.
- The product is bilingual in English and Chinese and supports light and dark themes.
- The portal is self-hosted on Cloudflare Workers, D1, R2, and Durable Objects.

## Capabilities and Constraints

- Preserve existing business behavior, routes, permissions, API contracts, and data flows during the interface rearchitecture.
- Navigation grouping and page information hierarchy may change when they improve comprehension and task completion.
- Feature visibility remains configurable through Admin Site Config.
- Public and protected access boundaries remain authoritative on the server.
- The responsive interface must provide feature parity across desktop and mobile, adapting composition and interaction rather than hiding primary capabilities.
- Roster member cards are a confirmed product asset. Their current portrait-led presentation, spring-based tilt, hover scale, specular response, color-dispersion glow, profile opening behavior, and reduced-motion handling must remain intact.
- Roster hover audio is a confirmed product behavior. Delayed playback and stop behavior, member-specific media, mute, volume, and user control must remain intact.

## Brand Commitments

- Product name: Infini Guild Management.
- Preserve the recognizable dark guild atmosphere while providing an equally complete, intentionally designed light theme.
- The interface should feel like a capable guild operations space, not a generic admin template or a decorative game landing page.
- The Roster page is an incumbent visual reference: personal, tactile, media-led, and responsive to interaction without obscuring information.

## Evidence on Hand

- Product and deployment facts: `README.md`, `README.zh.md`, `SETUP.md`, and `SETUP.zh.md`.
- Current product flows and route structure: `apps/portal/router.tsx` and `apps/portal/components/pages/`.
- Existing design tokens: `apps/portal/styles/tokens.css`, `semantic.css`, and `scale.css`.
- Confirmed Roster interaction reference: `MemberCard.tsx`, `MemberCard.css`, `RosterPage.tsx`, `RosterPage.css`, `RosterGrid.tsx`, `RosterFilterCard.tsx`, and `useRosterPageController.ts`.
- Existing guild branding asset: `apps/portal/public/guild-logo.webp`.
- Representative development data is available through the local seed; it is demonstration content, not evidence of real deployments or users.
- The repository contains no approved testimonials, customer claims, adoption metrics, or performance claims; future interface work must not fabricate them.

## Product Principles

1. **One task model on every device.** Desktop and mobile may compose information differently, but neither may become the incomplete version.
2. **Familiar operations, guild-specific character.** Standard controls should behave predictably; identity comes from hierarchy, material, data, media, and a few deliberate interactions.
3. **One shared pattern for one job.** Page shells, navigation, tabs, filters, cards, tables, forms, states, and actions should come from reusable primitives rather than page-local imitations.
4. **Progressive complexity.** Members should see the information and actions they need immediately, while administrative depth remains discoverable without crowding every screen.
5. **Preserve interactions that carry identity.** Distinctive, useful experiences such as Roster card motion and member audio are assets to protect and integrate, not flatten during standardization.

## Accessibility & Inclusion

- Keyboard navigation, visible focus, semantic labels, readable contrast, and reduced-motion behavior must be preserved or improved.
- Audio remains user-controlled through mute and volume settings and must never be the only carrier of information.
- Responsive layouts must support touch targets, zoom, long translated strings, and content reflow without hiding primary actions.
