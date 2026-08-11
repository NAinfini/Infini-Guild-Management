# Product

## Platform

Responsive bilingual web application for desktop and mobile.

## Users

- Guild members browse current information, manage their profiles and absences, join events, vote or enter raffles, review war plans and history, use shared knowledge/media/storage, and interact with permitted tools.
- Moderators and administrators publish content, coordinate events and wars, maintain members and catalogs, manage storage, review operational records, and administer permissions and site policy.
- Guests may read the dashboard, events, roster, announcements, guild-war, gallery, wiki, settings, and tools surfaces. Profile, storage, administration, and privileged mutations require authentication and server-side permission checks.

## Product purpose

Infini Guild Management gives a game guild one self-hosted operational home instead of splitting authoritative information across spreadsheets, chat pins, media folders, and isolated utilities. Success means members can find current information and complete common actions without technical guidance, while staff can operate the guild with traceable permissions and audit history.

## Current user capabilities

- Dashboard summaries, command search, member roster, rich profiles, classes, badges, availability, absences, media, and user-controlled profile audio.
- Invite registration, account settings, cookie sessions, profile-title styling, and responsive English/Chinese presentation.
- Events with fixed behaviors, recurring templates, quotas, signups, participant management, polls, raffles, and automatic archival.
- Scheduled rich-text announcements, wiki categories/articles/revisions, gallery images/external videos, and content moderation.
- Active guild-war planning, team/pool movement, conclusion, history, member stats, export, and analytics.
- Authenticated storage structures, categories, items, quantities, images, and transaction history.
- A Tools surface currently containing the dice roller, plus administration for members, invites, roles, permissions, Site Config, classes, class tags, badges, audit/error/status data, and maintenance.
- Authenticated realtime update hints through WebSocket connections backed by a Cloudflare Durable Object or the VPS in-process hub.

## Product boundaries

- Runtime feature visibility is limited to `announcements`, `events`, `guildWar`, `gallery`, `wiki`, `tools`, and `storage`.
- Site Config covers branding, those feature flags, and media/storage/absence policies. Game rules remain source-owned contracts.
- Event types are source-owned and limited to `weekly_mission`, `guild_war`, `social`, `poll`, `raffle`, and `other`.
- Guild-war results are source-owned and limited to `win`, `loss`, and `draw`. KDA is `(kills + assists) / max(deaths, 1)` without pre-rounding. Stat definitions own one `name`, not localized `labels` or a configurable `precision`.
- Admin cannot redefine those persisted contracts. They are not represented by dynamic D1 rule tables and require coordinated code/data migration when changed.
- One physical BlobStore contains persisted media and audit archives: the Cloudflare `BLOBS` R2 bucket or the configured VPS filesystem root. Audit objects are canonical NDJSON with authoritative metadata in SQLite. Persisted images are WebP and profile audio is Ogg/Opus; server validation rejects mismatched bytes, SVG, and GIF.
- Public visibility never grants mutation rights. Backend authorization remains authoritative even when the interface hides or disables an action.
- Demo data is representative development content, not evidence of real users, adoption, performance, or customer claims.

## Product principles

1. **One task model on every device.** Mobile and desktop may compose information differently, but neither is an intentionally reduced product.
2. **Guild-specific character with predictable controls.** Identity comes from hierarchy, media, data, and deliberate interaction; standard controls keep standard behavior.
3. **Progressive complexity.** Members see current information and common actions first; administrative depth remains permission-gated and discoverable.
4. **Traceable operations.** Sensitive changes have server authorization, audit context, and explicit destructive actions.
5. **Preserve useful identity.** Portrait-led roster cards, reduced-motion behavior, and user-controlled member audio are product assets rather than decoration.

## Accessibility and inclusion

Keyboard navigation, visible focus, semantic labels, readable contrast, reduced-motion handling, touch targets, zoom, long translated strings, and content reflow are baseline requirements. Audio is user-controlled and never the only carrier of information.
