# Product

[Documentation home](../README.md) · [中文版本](./PRODUCT.zh.md)

## What it is

Infini Guild Management is a responsive bilingual web app for running a guild on desktop and mobile.

## Who it serves

- **Guild members** can find current guild information, manage their profiles and absences, join events, vote or enter raffles, review war plans and history, use shared knowledge, media, and storage, and use the tools available to them.
- **Moderators and administrators** publish content, coordinate events and wars, maintain members and catalogs, manage storage, review operational records, and administer roles, permissions, and site policy.
- **Guests** can browse the dashboard, events, roster, announcements, guild-war, gallery, wiki, settings, and tools. Profiles, storage, administration, and other privileged changes require authentication and server-side permission checks.

## Product purpose

The app gives a guild one operational home instead of scattering authoritative information across spreadsheets, chat pins, media folders, and one-off utilities. Members should be able to find what they need and finish common tasks without technical help. Staff should be able to run the guild with clear permissions and a useful audit history.

## What the app supports today

- Use dashboard summaries and command search; browse the roster, profiles, classes, badges, availability, absences, media, and member-controlled profile audio.
- Register through an invite, manage account settings, use cookie sessions, style profile titles, and use the app in English or Chinese on any supported screen size.
- Take part in events with fixed behaviors, recurring templates, quotas, signups, participant management, polls, raffles, and automatic archival.
- Read scheduled rich-text announcements, wiki categories/articles/revisions, gallery images and external videos, and moderated content.
- Plan active guild wars, move teams and pools, conclude wars, review history and member stats, and export analytics.
- Use authenticated storage structures, categories, items, quantities, images, and transaction history.
- Use the dice roller and, when authorized, administer members, invites, roles, permissions, Site Config, classes, class tags, badges, and audit/error/status data.
- During planned data or blob-storage work, operators can place either runtime behind a dependency-free bilingual maintenance response without exposing an in-app maintenance control.
- Receive authenticated realtime update hints through WebSocket connections backed by a Cloudflare Durable Object or the VPS in-process hub.

## Product boundaries

- Runtime feature visibility is limited to `announcements`, `events`, `guildWar`, `gallery`, `wiki`, `tools`, and `storage`.
- Site Config owns branding, those feature flags, and media, storage, and absence policies. Game rules remain source-owned contracts.
- Event types are source-owned and limited to `weekly_mission`, `guild_war`, `social`, `poll`, `raffle`, and `other`.
- Guild-war results are source-owned and limited to `win`, `loss`, and `draw`. KDA is `(kills + assists) / max(deaths, 1)` without pre-rounding. Each stat definition has one `name`; localized `labels` and configurable `precision` are not supported.
- Administrators cannot redefine these persisted contracts. They are not dynamic D1 rule tables, and changing them requires a coordinated code and data migration.
- One physical BlobStore holds persisted media and audit archives: the Cloudflare `BLOBS` R2 bucket or the configured VPS filesystem root. Audit objects are canonical NDJSON, with authoritative metadata in SQLite. Persisted images are WebP and profile audio is Ogg/Opus; the server rejects mismatched bytes, SVG, and GIF.
- Public visibility never grants the right to mutate data. Backend authorization remains authoritative even when the interface hides or disables an action.
- Demo data is representative development content, not evidence of real users, adoption, performance, or customer claims.

## Product principles

1. **The same task model on every device.** Mobile and desktop may arrange information differently, but neither is intentionally reduced.
2. **Guild character, familiar controls.** Hierarchy, media, data, and deliberate interaction give the app its identity; standard controls keep standard behavior.
3. **Complexity appears when needed.** Members see current information and common actions first. Administrative depth is permission-gated and discoverable.
4. **Operations should be traceable.** Sensitive changes require server authorization, carry audit context, and make destructive actions explicit.
5. **Useful identity is worth preserving.** Portrait-led roster cards, reduced-motion support, and member-controlled audio are product features, not decoration.

## Accessibility and inclusion

Keyboard navigation, visible focus, semantic labels, readable contrast, reduced-motion handling, touch targets, zoom, long translated strings, and content reflow are baseline requirements. Audio is always user-controlled and never the only way to convey information.
