# Media Architecture

This document is the single source of truth for persisted content media. Audit
archives share the same R2 bucket, but remain an independent `audit-archive/`
keyspace with their own manifest and integrity rules.

## Ownership

D1 owns every fact about a media asset:

- `media_assets` identifies the logical asset, owner, purpose, type, lifecycle
  state, original display name, and optional expiry.
- `media_variants` identifies the exact R2 object for each required variant,
  including content type, bytes, and image dimensions.
- `media_links` attaches an asset to a domain entity, slot, and sort position.

R2 stores bytes only. Code must never infer ownership, authorization, entity
identity, quota usage, or lifecycle state from an R2 key or bucket listing.

## Canonical objects

Media IDs are 21-character URL-safe nanoids. Content media uses only these key
shapes:

```text
media/<mediaId>/full.webp
media/<mediaId>/view.webp
media/<mediaId>/full.ogg
```

Every image has both `full` and `view`; audio has only `full`. There is no
missing-variant fallback and no original filename in an R2 key.
Object keys are derived only from the opaque media ID and the fixed variant
name above. Domain IDs, entity types, upload paths, and display filenames never
participate in key derivation.

`full` is a WebP conversion at the source pixel dimensions. It is requested
only for an explicit enlargement or download. `view` preserves aspect ratio,
never crops, and never upscales. Its orientation-aware bounds are:

| Source orientation | View bounds |
| --- | --- |
| Landscape | 1920 × 1080 |
| Portrait | 1080 × 1920 |
| Square | 1080 × 1080 |

When the source already fits, `view` is still written as a separate R2 object
with the same pixel dimensions. Lists, cards, avatars, rich-text reading, and
other previews request `view`; lightboxes request `full`.

JPEG, PNG, AVIF, and WebP may be selected in the browser and are converted to
the canonical WebP pair before upload. SVG and GIF are not accepted as images.
Animated content belongs in the existing external-video flow. Profile audio is
stored as Ogg/Opus.

## Lifecycle and policy

Uploads create short-lived `pending` assets and their complete variants. A
domain create commits its parent and related business children first, then
MediaService validates purpose, ownership, quota, and link coordinates before
marking the asset `ready` and attaching it. If attachment fails, the service
deletes the newly created parent; parent-lifecycle triggers remove any partial
links and schedule newly unlinked assets for expiry. If that compensation also
fails, both errors are surfaced together.

Domain deletion first resolves non-media relationships, then deletes the parent
directly. Parent-lifecycle triggers remove its `media_links` and schedule assets
whose last link disappeared for expiry; services do not detach links or restore
them around the parent delete. Scheduled maintenance deletes only expired,
unlinked assets by the exact R2 keys recorded in `media_variants`, then removes
the D1 asset.

`site_config.media_policy` is the runtime source for upload byte limits and
logical-asset quotas. A two-variant image counts as one asset. Neither Portal
constants nor R2 object counts may override that policy.

The only read endpoint is:

```text
GET /api/media/:mediaId/:variant
```

It resolves the variant through D1, applies the linked entity's visibility and
permission rules, and then reads the exact recorded R2 object. R2 keys never
appear in public API responses.

## Change rules

- Add a purpose, entity type, or slot only by updating the shared tuple, D1
  checks, MediaService link matrix, API schema, and tests together.
- Domain services use MediaService; they do not put, list, parse, or delete
  content-media R2 objects directly.
- Rich-text services extract canonical media IDs from image nodes and replace
  their `media_links` only after the owning parent exists.
- Production reconciliation compares D1 variants with exact R2 object metadata;
  it does not invent links from key names.
