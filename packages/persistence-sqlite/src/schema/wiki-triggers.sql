CREATE TRIGGER wiki_categories_parent_depth_insert
BEFORE INSERT ON wiki_categories
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM wiki_categories WHERE id = NEW.parent_id)
      THEN RAISE(ABORT, 'wiki parent category does not exist')
    WHEN EXISTS (SELECT 1 FROM wiki_categories WHERE id = NEW.parent_id AND parent_id IS NOT NULL)
      THEN RAISE(ABORT, 'wiki categories support one child level')
  END;
END;

CREATE TRIGGER wiki_categories_parent_depth_update
BEFORE UPDATE OF parent_id ON wiki_categories
WHEN NEW.parent_id IS NOT OLD.parent_id
BEGIN
  SELECT CASE
    WHEN NEW.parent_id = NEW.id
      THEN RAISE(ABORT, 'wiki category cannot parent itself')
    WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM wiki_categories WHERE id = NEW.parent_id)
      THEN RAISE(ABORT, 'wiki parent category does not exist')
    WHEN NEW.parent_id IS NOT NULL AND EXISTS (SELECT 1 FROM wiki_categories WHERE id = NEW.parent_id AND parent_id IS NOT NULL)
      THEN RAISE(ABORT, 'wiki categories support one child level')
    WHEN NEW.parent_id IS NOT NULL AND EXISTS (SELECT 1 FROM wiki_categories WHERE parent_id = NEW.id)
      THEN RAISE(ABORT, 'wiki category with children cannot become a child')
  END;
END;

CREATE TRIGGER wiki_revisions_snapshot_matches_article
BEFORE INSERT ON wiki_revisions
WHEN NOT EXISTS (
  SELECT 1 FROM wiki_articles
  WHERE id = NEW.article_id
    AND current_revision = NEW.revision
    AND title = NEW.title
    AND slug = NEW.slug
    AND category_id = NEW.category_id
    AND body_json = NEW.body_json
    AND sort_order = NEW.sort_order
    AND pinned = NEW.pinned
    AND archived_at IS NEW.archived_at
    AND deleted_at IS NEW.deleted_at
)
BEGIN
  SELECT RAISE(ABORT, 'wiki revision must snapshot the current article');
END;

CREATE TRIGGER wiki_revisions_restore_source_valid
BEFORE INSERT ON wiki_revisions
WHEN NEW.restored_from IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM wiki_revisions
  WHERE article_id = NEW.article_id
    AND revision = NEW.restored_from
    AND revision < NEW.revision
)
BEGIN
  SELECT RAISE(ABORT, 'wiki restore source does not exist');
END;

CREATE TRIGGER wiki_revisions_update_immutable
BEFORE UPDATE ON wiki_revisions
BEGIN
  SELECT RAISE(ABORT, 'wiki revisions are immutable');
END;

CREATE TRIGGER wiki_revisions_delete_system_test_only
BEFORE DELETE ON wiki_revisions
WHEN NOT EXISTS (
  SELECT 1
  FROM system_test_artifacts AS artifacts
  JOIN system_test_runs AS runs ON runs.id = artifacts.run_id
  WHERE artifacts.artifact_type = 'wiki_article'
    AND artifacts.artifact_key = OLD.article_id
    AND runs.status = 'cleaning'
)
BEGIN
  SELECT RAISE(ABORT, 'wiki revisions are immutable');
END;

CREATE TRIGGER wiki_articles_physical_delete_system_test_only
BEFORE DELETE ON wiki_articles
WHEN NOT EXISTS (
  SELECT 1
  FROM system_test_artifacts AS artifacts
  JOIN system_test_runs AS runs ON runs.id = artifacts.run_id
  WHERE artifacts.artifact_type = 'wiki_article'
    AND artifacts.artifact_key = OLD.id
    AND runs.status = 'cleaning'
)
BEGIN
  SELECT RAISE(ABORT, 'wiki articles use tombstone deletion');
END;

CREATE TRIGGER wiki_revision_media_insert_valid
BEFORE INSERT ON wiki_revision_media
WHEN NOT EXISTS (
  SELECT 1
  FROM wiki_revisions AS revisions
  JOIN media_assets AS assets ON assets.id = NEW.media_id
  WHERE revisions.id = NEW.revision_id
    AND assets.purpose = 'wiki_image'
    AND assets.state IN ('staged', 'attached')
    AND NEW.audience = 'private'
)
BEGIN
  SELECT RAISE(ABORT, 'wiki revision media is not attachable');
END;

CREATE TRIGGER wiki_revision_media_after_insert
AFTER INSERT ON wiki_revision_media
BEGIN
  UPDATE media_assets
  SET state = 'attached',
      expires_at = NULL,
      delete_claim_token = NULL,
      delete_claim_until = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.media_id;
END;

CREATE TRIGGER wiki_revision_media_update_immutable
BEFORE UPDATE ON wiki_revision_media
BEGIN
  SELECT RAISE(ABORT, 'wiki revision media is immutable');
END;

CREATE TRIGGER wiki_revision_media_delete_system_test_only
BEFORE DELETE ON wiki_revision_media
WHEN NOT EXISTS (
  SELECT 1
  FROM wiki_revisions AS revisions
  JOIN system_test_artifacts AS artifacts
    ON artifacts.artifact_type = 'wiki_article'
   AND artifacts.artifact_key = revisions.article_id
  JOIN system_test_runs AS runs
    ON runs.id = artifacts.run_id
   AND runs.status = 'cleaning'
  WHERE revisions.id = OLD.revision_id
)
BEGIN
  SELECT RAISE(ABORT, 'wiki revision media is immutable');
END;

CREATE TRIGGER wiki_revision_media_after_delete
AFTER DELETE ON wiki_revision_media
BEGIN
  UPDATE media_assets
  SET state = 'deleting',
      expires_at = NULL,
      delete_claim_token = NULL,
      delete_claim_until = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = OLD.media_id
    AND state = 'attached'
    AND NOT EXISTS (SELECT 1 FROM media_links WHERE media_id = OLD.media_id)
    AND NOT EXISTS (SELECT 1 FROM wiki_revision_media WHERE media_id = OLD.media_id);
END;
