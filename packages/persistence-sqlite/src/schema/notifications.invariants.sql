CREATE TRIGGER notification_inbox_member_joined
AFTER INSERT ON users
WHEN NEW.is_active = 1 AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO notification_inbox
    (id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at)
  SELECT lower(hex(randomblob(16))), recipients.id, 'member_joined', 'member', NEW.id,
    'member_joined:' || NEW.id, json_object('display_name', NEW.display_name), NEW.created_at, NULL
  FROM users AS recipients
  WHERE recipients.is_active = 1 AND recipients.deleted_at IS NULL AND recipients.id <> NEW.id
  ON CONFLICT(user_id, source_key) DO NOTHING;
END;

CREATE TRIGGER notification_inbox_announcement_published_insert
AFTER INSERT ON announcements
WHEN NEW.status = 'published' AND NEW.publish_at IS NOT NULL
  AND NEW.publish_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
BEGIN
  INSERT INTO notification_inbox
    (id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at)
  SELECT lower(hex(randomblob(16))), recipients.id, 'announcement_published', 'announcement', NEW.id,
    'announcement_published:' || NEW.id, json_object('title', NEW.title), NEW.publish_at, NULL
  FROM users AS recipients
  WHERE recipients.is_active = 1 AND recipients.deleted_at IS NULL
  ON CONFLICT(user_id, source_key) DO NOTHING;
END;

CREATE TRIGGER notification_inbox_announcement_published_update
AFTER UPDATE OF status ON announcements
WHEN OLD.status <> 'published' AND NEW.status = 'published' AND NEW.publish_at IS NOT NULL
  AND NEW.publish_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
BEGIN
  INSERT INTO notification_inbox
    (id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at)
  SELECT lower(hex(randomblob(16))), recipients.id, 'announcement_published', 'announcement', NEW.id,
    'announcement_published:' || NEW.id, json_object('title', NEW.title), NEW.publish_at, NULL
  FROM users AS recipients
  WHERE recipients.is_active = 1 AND recipients.deleted_at IS NULL
  ON CONFLICT(user_id, source_key) DO NOTHING;
END;

CREATE TRIGGER notification_inbox_event_created
AFTER INSERT ON events
BEGIN
  INSERT INTO notification_inbox
    (id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at)
  SELECT lower(hex(randomblob(16))), recipients.id, 'event_created', 'event', NEW.id,
    'event_created:' || NEW.id, json_object('title', NEW.title, 'start_at', NEW.start_at), NEW.created_at, NULL
  FROM users AS recipients
  WHERE recipients.is_active = 1 AND recipients.deleted_at IS NULL
  ON CONFLICT(user_id, source_key) DO NOTHING;
END;

CREATE TRIGGER notification_inbox_wiki_article_created
AFTER INSERT ON wiki_articles
WHEN NEW.archived_at IS NULL AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO notification_inbox
    (id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at)
  SELECT lower(hex(randomblob(16))), recipients.id, 'wiki_article_created', 'wiki_article', NEW.id,
    'wiki_article_created:' || NEW.id, json_object('title', NEW.title, 'slug', NEW.slug), NEW.created_at, NULL
  FROM users AS recipients
  WHERE recipients.is_active = 1 AND recipients.deleted_at IS NULL
  ON CONFLICT(user_id, source_key) DO NOTHING;
END;
