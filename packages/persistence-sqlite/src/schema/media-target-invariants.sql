CREATE TRIGGER media_assets_identity_immutable
BEFORE UPDATE OF owner_user_id, purpose, media_type ON media_assets
WHEN OLD.owner_user_id IS NOT NEW.owner_user_id
  OR OLD.purpose <> NEW.purpose
  OR OLD.media_type <> NEW.media_type
BEGIN
  SELECT RAISE(ABORT, 'media asset identity is immutable');
END;

CREATE TRIGGER media_variants_identity_immutable
BEFORE UPDATE ON media_variants
BEGIN
  SELECT RAISE(ABORT, 'media variant metadata is immutable');
END;

CREATE TRIGGER media_links_target_contract
BEFORE INSERT ON media_links
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM media_assets AS assets
    WHERE assets.id = NEW.media_id AND (
      (assets.purpose = 'member_avatar' AND NEW.entity_type = 'member_profile' AND NEW.slot = 'avatar')
      OR (assets.purpose = 'member_image' AND NEW.entity_type = 'member_profile' AND NEW.slot = 'image')
      OR (assets.purpose = 'member_audio' AND NEW.entity_type = 'member_profile' AND NEW.slot = 'audio')
      OR (assets.purpose = 'gallery_image' AND NEW.entity_type = 'gallery_item' AND NEW.slot = 'image')
      OR (assets.purpose = 'event_image' AND NEW.entity_type IN ('event', 'recurring_template') AND NEW.slot = 'attachment')
      OR (assets.purpose = 'announcement_image' AND NEW.entity_type = 'announcement' AND NEW.slot = 'body')
      OR (assets.purpose = 'announcement_attachment' AND NEW.entity_type = 'announcement' AND NEW.slot = 'attachment')
      OR (assets.purpose = 'wiki_image' AND NEW.entity_type = 'wiki_article' AND NEW.slot = 'body')
      OR (assets.purpose = 'storage_image' AND NEW.entity_type = 'storage_item' AND NEW.slot = 'image')
      OR (assets.purpose = 'class_icon' AND NEW.entity_type = 'class_catalog' AND NEW.slot = 'icon')
      OR (assets.purpose = 'site_logo' AND NEW.entity_type = 'site_config' AND NEW.slot = 'logo')
    )
  ) THEN RAISE(ABORT, 'media purpose does not support target') END;

  SELECT CASE WHEN
    (NEW.entity_type = 'member_profile' AND NOT EXISTS (SELECT 1 FROM member_profiles WHERE user_id = NEW.entity_id))
    OR (NEW.entity_type = 'gallery_item' AND NOT EXISTS (SELECT 1 FROM gallery_items WHERE id = NEW.entity_id))
    OR (NEW.entity_type = 'event' AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.entity_id))
    OR (NEW.entity_type = 'recurring_template' AND NOT EXISTS (SELECT 1 FROM recurring_templates WHERE id = NEW.entity_id))
    OR (NEW.entity_type = 'announcement' AND NOT EXISTS (SELECT 1 FROM announcements WHERE id = NEW.entity_id))
    OR (NEW.entity_type = 'wiki_article' AND NOT EXISTS (SELECT 1 FROM wiki_articles WHERE id = NEW.entity_id))
    OR (NEW.entity_type = 'storage_item' AND NOT EXISTS (SELECT 1 FROM storage_items WHERE id = NEW.entity_id))
    OR (NEW.entity_type = 'class_catalog' AND NOT EXISTS (SELECT 1 FROM class_catalog WHERE id = NEW.entity_id))
    OR (NEW.entity_type = 'site_config' AND (NEW.entity_id <> 'site' OR NOT EXISTS (SELECT 1 FROM site_config WHERE singleton = 1)))
  THEN RAISE(ABORT, 'media target does not exist') END;
END;

CREATE TRIGGER member_profiles_media_cleanup AFTER DELETE ON member_profiles
BEGIN
  DELETE FROM media_links WHERE entity_type = 'member_profile' AND entity_id = OLD.user_id;
END;

CREATE TRIGGER gallery_items_media_cleanup AFTER DELETE ON gallery_items
BEGIN
  DELETE FROM media_links WHERE entity_type = 'gallery_item' AND entity_id = OLD.id;
END;

CREATE TRIGGER events_media_cleanup AFTER DELETE ON events
BEGIN
  DELETE FROM media_links WHERE entity_type = 'event' AND entity_id = OLD.id;
END;

CREATE TRIGGER recurring_templates_media_cleanup AFTER DELETE ON recurring_templates
BEGIN
  DELETE FROM media_links WHERE entity_type = 'recurring_template' AND entity_id = OLD.id;
END;

CREATE TRIGGER announcements_media_cleanup AFTER DELETE ON announcements
BEGIN
  DELETE FROM media_links WHERE entity_type = 'announcement' AND entity_id = OLD.id;
END;

CREATE TRIGGER wiki_articles_media_cleanup AFTER DELETE ON wiki_articles
BEGIN
  DELETE FROM media_links WHERE entity_type = 'wiki_article' AND entity_id = OLD.id;
END;

CREATE TRIGGER storage_items_media_cleanup AFTER DELETE ON storage_items
BEGIN
  DELETE FROM media_links WHERE entity_type = 'storage_item' AND entity_id = OLD.id;
END;

CREATE TRIGGER class_catalog_media_cleanup AFTER DELETE ON class_catalog
BEGIN
  DELETE FROM media_links WHERE entity_type = 'class_catalog' AND entity_id = OLD.id;
END;
