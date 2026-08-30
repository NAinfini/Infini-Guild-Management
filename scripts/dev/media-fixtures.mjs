import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const IMAGE_CONTENT_TYPE = "image/webp";
const AUDIO_CONTENT_TYPE = "audio/ogg";
const PDF_CONTENT_TYPE = "application/pdf";

const files = Object.freeze({
  avatar01: file("avatar-01.webp", 4_848, "eb68ef6ef0a32e6b871162cc9cc258c1c8f4afd2573536110a6f82a7338b4024", 160, 160),
  avatar02: file("avatar-02.webp", 4_448, "d0feb0bd8ea08e2ccc36ddf95d568faca9465a74725581559360a9f633d16226", 160, 160),
  avatar03: file("avatar-03.webp", 5_484, "a8d72b6a38d30b14a09b39bd3f174db55aca09b21f5a02812e7f65a4617247c3", 160, 160),
  avatar04: file("avatar-04.webp", 3_394, "4b7eee21181054d7b9f6bc349b7ed07f8c2167046fe63176a5906ea8217232cb", 160, 160),
  avatar05: file("avatar-05.webp", 4_160, "e2268d50ac94e6db63a45a5deb6bed8dc86ad9a17394de4fec58480db8ae1fa2", 160, 160),
  avatar06: file("avatar-06.webp", 2_144, "bb95abb4c51723b2ccfbcf23100f1a6fa0e6dcd379488558946d1befde1f4b19", 160, 160),
  avatar07: file("avatar-07.webp", 4_250, "f18734730d9de8e0401756b4f60e3ef40b50980c5ed367ca5a5a856e4471def6", 160, 160),
  avatar08: file("avatar-08.webp", 5_376, "30e7c9c385eea66c34095c6e8c24297071bdf41fcd8b15e245d139aa285df5d6", 160, 160),
  avatar09: file("avatar-09.webp", 2_670, "de54d73347b7d6c5b39d7bc67ff9e90ffd5300dabbc4248f5efdbef1f35177a0", 160, 160),
  avatar10: file("avatar-10.webp", 3_352, "e2dcbde00adaa9f7ac512f0ceb1e1d3d7b2cf97cfbc2e6ec3e08e8309b4a8a0a", 160, 160),
  sceneWide: file("scene-wide.webp", 28_946, "4b712206c5e432f413c82033c3ae2887ee344c5dc72df77189b288dcc4935659", 640, 360),
  scenePortrait: file("scene-portrait.webp", 31_948, "31d981950380c1f3c76e711a2e308b1c6f47fe57760b3e234ac30760da434045", 400, 560),
  sceneSquare: file("scene-square.webp", 32_726, "2e3106b388baa9f3a7e6fbe2fd5d586ffbe5257c8be399eaeed411687ff70cab", 480, 480),
  themeAudio: Object.freeze({
    filename: "guild-theme.ogg",
    byteSize: 188,
    contentType: AUDIO_CONTENT_TYPE,
    sha256: "846b3bd7f96020d52447a8658afe1fccecc135f181ee9da605edce6820ece399",
    width: null,
    height: null,
  }),
  fieldGuide: Object.freeze({
    filename: "guild-field-guide.pdf",
    byteSize: 592,
    contentType: PDF_CONTENT_TYPE,
    sha256: "2ebe915cbbdde9914f7f0e19fb0bff941b319057c7121cdc8cfa0bf00c28cd2e",
    width: null,
    height: null,
  }),
});

function file(filename, byteSize, sha256, width, height) {
  return Object.freeze({ filename, byteSize, contentType: IMAGE_CONTENT_TYPE, sha256, width, height });
}

function imageAsset(id, purpose, ownerUserId, target, fixture) {
  return asset({
    id,
    purpose,
    mediaType: "image",
    ownerUserId,
    target,
    fixture,
    originalName: null,
    variants: ["full", "view"],
  });
}

function audioAsset(id, ownerUserId, target, fixture) {
  return asset({
    id,
    purpose: "member_audio",
    mediaType: "audio",
    ownerUserId,
    target,
    fixture,
    originalName: "guild-theme.ogg",
    variants: ["full"],
  });
}

function attachmentAsset(id, ownerUserId, target, fixture) {
  return asset({
    id,
    purpose: "announcement_attachment",
    mediaType: "file",
    ownerUserId,
    target,
    fixture,
    originalName: fixture.filename,
    variants: ["full"],
  });
}

function asset({ id, purpose, mediaType, ownerUserId, target, fixture, originalName, variants }) {
  if (!/^[A-Za-z0-9_-]{21}$/.test(id)) throw new Error(`Development media id is invalid: ${id}`);
  return Object.freeze({
    id,
    purpose,
    mediaType,
    ownerUserId,
    target: Object.freeze(target),
    originalName,
    variants: Object.freeze(variants.map((variant) => Object.freeze({
      variant,
      objectKey: `media/${id}/${variant}.${mediaType === "image" ? "webp" : mediaType === "audio" ? "opus" : "bin"}`,
      ...fixture,
    }))),
  });
}

/**
 * Canonical local-development media graph. SQL seed rows must use this exact
 * data so database manifests and the local blob stores cannot drift apart.
 */
export const DEVELOPMENT_MEDIA_ASSETS = Object.freeze([
  imageAsset("dev-media-00000000001", "site_logo", "dev-owner", target("site_config", "site", "logo", "public"), files.sceneSquare),
  imageAsset("dev-media-00000000002", "class_icon", "dev-owner", target("class_catalog", "dev-class-vanguard", "icon", "public"), files.avatar01),
  imageAsset("dev-media-00000000003", "member_avatar", "dev-owner", target("member_profile", "dev-owner", "avatar", "public"), files.avatar01),
  imageAsset("dev-media-00000000004", "member_avatar", "dev-moderator-29", target("member_profile", "dev-moderator-29", "avatar", "public"), files.avatar02),
  imageAsset("dev-media-00000000005", "member_avatar", "dev-member-01", target("member_profile", "dev-member-01", "avatar", "public"), files.avatar03),
  imageAsset("dev-media-00000000006", "member_avatar", "dev-member-02", target("member_profile", "dev-member-02", "avatar", "public"), files.avatar04),
  imageAsset("dev-media-00000000007", "member_avatar", "dev-member-03", target("member_profile", "dev-member-03", "avatar", "public"), files.avatar05),
  imageAsset("dev-media-00000000008", "member_avatar", "dev-member-04", target("member_profile", "dev-member-04", "avatar", "public"), files.avatar06),
  imageAsset("dev-media-00000000009", "member_avatar", "dev-member-05", target("member_profile", "dev-member-05", "avatar", "public"), files.avatar07),
  imageAsset("dev-media-00000000010", "member_avatar", "dev-member-06", target("member_profile", "dev-member-06", "avatar", "public"), files.avatar08),
  imageAsset("dev-media-00000000011", "member_avatar", "dev-member-07", target("member_profile", "dev-member-07", "avatar", "public"), files.avatar09),
  imageAsset("dev-media-00000000012", "member_avatar", "dev-member-08", target("member_profile", "dev-member-08", "avatar", "public"), files.avatar10),
  imageAsset("dev-media-00000000013", "member_image", "dev-member-03", target("member_profile", "dev-member-03", "image", "public"), files.scenePortrait),
  audioAsset("dev-media-00000000014", "dev-member-03", target("member_profile", "dev-member-03", "audio", "public"), files.themeAudio),
  imageAsset("dev-media-00000000015", "gallery_image", "dev-owner", target("gallery_item", "dev-gallery-01", "image", "public"), files.sceneWide),
  imageAsset("dev-media-00000000016", "gallery_image", "dev-owner", target("gallery_item", "dev-gallery-02", "image", "public"), files.scenePortrait),
  imageAsset("dev-media-00000000017", "gallery_image", "dev-member-01", target("gallery_item", "dev-gallery-03", "image", "public"), files.sceneSquare),
  imageAsset("dev-media-00000000018", "event_image", "dev-owner", target("event", "dev-event-weekly", "attachment", "public"), files.sceneWide),
  imageAsset("dev-media-00000000019", "announcement_image", "dev-owner", target("announcement", "dev-announcement-welcome", "body", "public"), files.sceneWide),
  imageAsset("dev-media-00000000020", "wiki_image", "dev-owner", target("wiki_article", "dev-wiki-article-war-playbook", "body", "public"), files.scenePortrait),
  imageAsset("dev-media-00000000021", "storage_image", "dev-owner", target("storage_item", "dev-storage-item-crystal", "image", "public"), files.sceneSquare),
  imageAsset("dev-media-00000000022", "storage_image", "dev-owner", target("storage_item", "dev-storage-item-potion", "image", "public"), files.scenePortrait),
  imageAsset("dev-media-00000000023", "event_image", "dev-owner", target("recurring_template", "dev-template-weekly", "attachment", "public"), files.sceneSquare),
  attachmentAsset("dev-media-00000000024", "dev-owner", target("announcement", "dev-announcement-welcome", "attachment", "public"), files.fieldGuide),
]);

function target(entityType, entityId, slot, audience) {
  return { entityType, entityId, slot, audience, sortOrder: 0 };
}

/** Flat object manifest for database media_variants rows and BlobStore seeding. */
export const DEVELOPMENT_MEDIA_OBJECTS = Object.freeze(DEVELOPMENT_MEDIA_ASSETS.flatMap((asset) => (
  asset.variants.map((variant) => Object.freeze({ mediaId: asset.id, ...variant }))
)));

const DEVELOPMENT_OWNER_ID = "dev-owner";
const DEVELOPMENT_WIKI_REVISION_MEDIA = Object.freeze([
  Object.freeze({ revisionId: "dev-revision-war-playbook-1", mediaId: "dev-media-00000000020", audience: "private", sortOrder: 0 }),
  Object.freeze({ revisionId: "dev-revision-war-playbook-2", mediaId: "dev-media-00000000020", audience: "private", sortOrder: 0 }),
  Object.freeze({ revisionId: "dev-revision-war-playbook-3", mediaId: "dev-media-00000000020", audience: "private", sortOrder: 0 }),
]);

/**
 * SQL for the development media graph. This is generated from the object
 * manifest, so relational rows cannot drift from fixture metadata.
 */
export function generateDevelopmentMediaDatabaseStatements() {
  const { assets, variants, links, wikiRevisionMedia, logo, classIcon } = developmentMediaRows();

  const ownerGuard = `EXISTS (SELECT 1 FROM users WHERE id = ${sqlValue(DEVELOPMENT_OWNER_ID)})`;
  return Object.freeze([
    `${valuesCte("assets", ["id", "owner_user_id", "purpose", "media_type", "original_name"], assets)}
INSERT OR IGNORE INTO media_assets (
  id, owner_user_id, purpose, media_type, state, original_name,
  expires_at, delete_claim_token, delete_claim_until
)
SELECT id, owner_user_id, purpose, media_type, 'attached', original_name, NULL, NULL, NULL
FROM assets
WHERE ${ownerGuard};`,
    `${valuesCte("variants", ["media_id", "variant", "object_key", "content_type", "byte_size", "sha256", "width", "height"], variants)}
INSERT OR IGNORE INTO media_variants (
  media_id, variant, object_key, content_type, byte_size, sha256, width, height
)
SELECT media_id, variant, object_key, content_type, byte_size, sha256, width, height
FROM variants
WHERE ${ownerGuard};`,
    `${valuesCte("expected", ["id"], assets.map(([id]) => [id]))}
UPDATE media_assets
SET state = 'staged',
    expires_at = '2099-01-01T00:00:00.000Z',
    delete_claim_token = NULL,
    delete_claim_until = NULL
WHERE ${ownerGuard}
  AND id IN (SELECT id FROM expected)
  AND state = 'deleting'
  AND NOT EXISTS (SELECT 1 FROM media_links WHERE media_id = media_assets.id)
  AND NOT EXISTS (SELECT 1 FROM wiki_revision_media WHERE media_id = media_assets.id);`,
    `${valuesCte("expected", ["media_id", "entity_type", "entity_id", "slot", "audience", "sort_order"], links)}
DELETE FROM media_links
WHERE ${ownerGuard}
  AND EXISTS (
    SELECT 1
    FROM expected
    WHERE expected.entity_type = media_links.entity_type
      AND expected.entity_id = media_links.entity_id
      AND expected.slot = media_links.slot
      AND expected.sort_order = media_links.sort_order
      AND expected.media_id <> media_links.media_id
  );`,
    `${valuesCte("expected", ["media_id", "entity_type", "entity_id", "slot", "audience", "sort_order"], links)}
UPDATE media_links
SET audience = (
      SELECT expected.audience
      FROM expected
      WHERE expected.media_id = media_links.media_id
        AND expected.entity_type = media_links.entity_type
        AND expected.entity_id = media_links.entity_id
        AND expected.slot = media_links.slot
    ),
    sort_order = (
      SELECT expected.sort_order
      FROM expected
      WHERE expected.media_id = media_links.media_id
        AND expected.entity_type = media_links.entity_type
        AND expected.entity_id = media_links.entity_id
        AND expected.slot = media_links.slot
    )
WHERE ${ownerGuard}
  AND EXISTS (
    SELECT 1
    FROM expected
    WHERE expected.media_id = media_links.media_id
      AND expected.entity_type = media_links.entity_type
      AND expected.entity_id = media_links.entity_id
      AND expected.slot = media_links.slot
      AND (expected.audience <> media_links.audience OR expected.sort_order <> media_links.sort_order)
  );`,
    `${valuesCte("links", ["media_id", "entity_type", "entity_id", "slot", "audience", "sort_order"], links)}
INSERT OR IGNORE INTO media_links (
  media_id, entity_type, entity_id, slot, audience, sort_order
)
SELECT media_id, entity_type, entity_id, slot, audience, sort_order
FROM links
WHERE ${ownerGuard};`,
    `${valuesCte("links", ["revision_id", "media_id", "audience", "sort_order"], wikiRevisionMedia)}
INSERT OR IGNORE INTO wiki_revision_media (revision_id, media_id, audience, sort_order)
SELECT revision_id, media_id, audience, sort_order
FROM links
WHERE ${ownerGuard};`,
    `UPDATE site_config
SET site_logo_media_id = ${sqlValue(logo.id)}
WHERE singleton = 1 AND ${ownerGuard};`,
    `UPDATE class_catalog
SET icon_type = 'image', vector_icon = NULL
WHERE id = ${sqlValue(classIcon.target.entityId)} AND ${ownerGuard};`,
  ]);
}

export const DEVELOPMENT_MEDIA_DATABASE_STATEMENTS = generateDevelopmentMediaDatabaseStatements();

/** Query existing immutable rows before a development-media repair. */
export function generateDevelopmentMediaDatabasePreflightStatement() {
  const { assets, variants, wikiRevisionMedia } = developmentMediaRows();
  return `${valuesCtes([
    ["assets", ["id", "owner_user_id", "purpose", "media_type", "original_name"], assets],
    ["variants", ["media_id", "variant", "object_key", "content_type", "byte_size", "sha256", "width", "height"], variants],
    ["wiki_links", ["revision_id", "media_id", "audience", "sort_order"], wikiRevisionMedia],
  ])}
SELECT
  (SELECT count(*)
    FROM media_assets AS actual
    JOIN assets AS expected ON expected.id = actual.id
    WHERE actual.owner_user_id IS NOT expected.owner_user_id
      OR actual.purpose <> expected.purpose
      OR actual.media_type <> expected.media_type
      OR actual.original_name IS NOT expected.original_name) AS assetMismatches,
  ((SELECT count(*)
      FROM media_variants AS actual
      JOIN variants AS expected
        ON expected.media_id = actual.media_id AND expected.variant = actual.variant
      WHERE actual.object_key <> expected.object_key
        OR actual.content_type <> expected.content_type
        OR actual.byte_size <> expected.byte_size
        OR actual.sha256 <> expected.sha256
        OR actual.width IS NOT expected.width
        OR actual.height IS NOT expected.height)
    + (SELECT count(*)
      FROM media_variants AS actual
      JOIN variants AS expected ON expected.object_key = actual.object_key
      WHERE actual.media_id <> expected.media_id OR actual.variant <> expected.variant)) AS variantMismatches,
  (SELECT count(*)
    FROM wiki_revision_media AS actual
    JOIN wiki_links AS expected
      ON expected.revision_id = actual.revision_id
      AND expected.sort_order = actual.sort_order
    WHERE actual.media_id <> expected.media_id
      OR actual.audience <> expected.audience) AS wikiRevisionMismatches;`;
}

export const DEVELOPMENT_MEDIA_DATABASE_PREFLIGHT_STATEMENT = generateDevelopmentMediaDatabasePreflightStatement();

export function assertDevelopmentMediaDatabasePreflight(row) {
  if (!row || typeof row !== "object") throw new Error("Development media database preflight did not return a result");
  const mismatches = ["assetMismatches", "variantMismatches", "wikiRevisionMismatches"];
  for (const field of mismatches) {
    if (Number(row[field]) !== 0) throw new Error(`Development media database has incompatible ${field}`);
  }
}

const bytesByFilename = new Map();

export async function readDevelopmentMediaObjectBytes(object) {
  const fixturePath = new URL(`./fixtures/media/${object.filename}`, import.meta.url);
  let bytes = bytesByFilename.get(object.filename);
  if (!bytes) {
    bytes = new Uint8Array(await readFile(fixturePath));
    if (bytes.byteLength !== object.byteSize || sha256(bytes) !== object.sha256) {
      throw new Error(`Development media fixture is corrupt: ${object.filename}`);
    }
    bytesByFilename.set(object.filename, bytes);
  }
  return bytes;
}

export async function seedDevelopmentMediaObjects(blobs) {
  await Promise.all(DEVELOPMENT_MEDIA_OBJECTS.map(readDevelopmentMediaObjectBytes));
  const existing = await Promise.all(
    DEVELOPMENT_MEDIA_OBJECTS.map((object) => blobs.head(object.objectKey)),
  );
  for (let index = 0; index < DEVELOPMENT_MEDIA_OBJECTS.length; index += 1) {
    const metadata = existing[index];
    if (metadata) assertObjectMetadata(metadata, DEVELOPMENT_MEDIA_OBJECTS[index]);
  }

  const missing = DEVELOPMENT_MEDIA_OBJECTS.filter((_, index) => existing[index] === null);
  const concurrency = 4;
  for (let offset = 0; offset < missing.length; offset += concurrency) {
    const results = await Promise.allSettled(missing.slice(offset, offset + concurrency).map(async (object) => {
      const bytes = await readDevelopmentMediaObjectBytes(object);
      const metadata = await blobs.putIfAbsent(object.objectKey, {
        body: bytesToStream(bytes),
        size: object.byteSize,
        contentType: object.contentType,
        sha256: object.sha256,
      });
      assertObjectMetadata(metadata, object);
    }));
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Development media object batch failed");
  }
  return Object.freeze({
    processed: DEVELOPMENT_MEDIA_OBJECTS.length,
    total: DEVELOPMENT_MEDIA_OBJECTS.length,
  });
}

function bytesToStream(bytes) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function assertObjectMetadata(metadata, object) {
  if (
    metadata.key !== object.objectKey
    || metadata.size !== object.byteSize
    || metadata.contentType !== object.contentType
    || metadata.sha256 !== object.sha256
  ) {
    throw new Error(`Development media object already exists with different metadata: ${object.objectKey}`);
  }
}

function developmentMediaRows() {
  const assets = DEVELOPMENT_MEDIA_ASSETS.map((asset) => [
    asset.id,
    asset.ownerUserId,
    asset.purpose,
    asset.mediaType,
    asset.originalName,
  ]);
  const variants = DEVELOPMENT_MEDIA_OBJECTS.map((object) => [
    object.mediaId,
    object.variant,
    object.objectKey,
    object.contentType,
    object.byteSize,
    object.sha256,
    object.width,
    object.height,
  ]);
  const links = DEVELOPMENT_MEDIA_ASSETS.map((asset) => [
    asset.id,
    asset.target.entityType,
    asset.target.entityId,
    asset.target.slot,
    asset.target.audience,
    asset.target.sortOrder,
  ]);
  const wikiRevisionMedia = DEVELOPMENT_WIKI_REVISION_MEDIA.map((link) => [
    link.revisionId,
    link.mediaId,
    link.audience,
    link.sortOrder,
  ]);
  const logo = DEVELOPMENT_MEDIA_ASSETS.find((asset) => asset.purpose === "site_logo");
  const classIcon = DEVELOPMENT_MEDIA_ASSETS.find((asset) => asset.purpose === "class_icon");
  if (!logo || !classIcon) throw new Error("Development media manifest is missing required site metadata");
  return { assets, variants, links, wikiRevisionMedia, logo, classIcon };
}

function valuesCte(name, columns, rows) {
  return valuesCtes([[name, columns, rows]]);
}

function valuesCtes(definitions) {
  return `WITH ${definitions.map(([name, columns, rows]) => (
    `${name} (${columns.join(", ")}) AS (\n  VALUES\n    ${rows.map((row) => `(${row.map(sqlValue).join(", ")})`).join(",\n    ")}\n)`
  )).join(",\n")}`;
}

function sqlValue(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
