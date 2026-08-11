CREATE TRIGGER media_links_before_insert
BEFORE INSERT ON media_links
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM media_assets
      WHERE id = NEW.media_id
        AND state IN ('staged', 'attached')
    ) THEN RAISE(ABORT, 'media asset is not attachable')
  END;
END;

CREATE TRIGGER media_links_after_insert
AFTER INSERT ON media_links
BEGIN
  UPDATE media_assets
  SET state = 'attached',
      expires_at = NULL,
      delete_claim_token = NULL,
      delete_claim_until = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.media_id;
END;

CREATE TRIGGER media_links_target_immutable
BEFORE UPDATE OF media_id, entity_type, entity_id, slot ON media_links
WHEN OLD.media_id <> NEW.media_id
  OR OLD.entity_type <> NEW.entity_type
  OR OLD.entity_id <> NEW.entity_id
  OR OLD.slot <> NEW.slot
BEGIN
  SELECT RAISE(ABORT, 'media link target is immutable');
END;

CREATE TRIGGER media_links_after_delete
AFTER DELETE ON media_links
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
