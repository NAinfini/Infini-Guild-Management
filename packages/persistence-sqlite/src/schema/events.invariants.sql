CREATE TRIGGER recurring_templates_catalog_limit
BEFORE INSERT ON recurring_templates
WHEN (SELECT count(*) FROM recurring_templates) >= __RECURRING_TEMPLATE_CATALOG_MAX__
BEGIN
  SELECT RAISE(ABORT, 'recurring template catalog limit reached');
END;

CREATE TRIGGER event_class_quota_tag_scope_insert
BEFORE INSERT ON event_class_quotas
WHEN NOT EXISTS (
  SELECT 1 FROM class_tags
  WHERE id = NEW.tag_id
    AND (owner_kind IS NULL OR (owner_kind = 'event' AND owner_id = NEW.event_id))
)
BEGIN
  SELECT RAISE(ABORT, 'event quota tag is outside event scope');
END;

CREATE TRIGGER event_class_quota_tag_scope_update
BEFORE UPDATE OF event_id, tag_id ON event_class_quotas
WHEN NOT EXISTS (
  SELECT 1 FROM class_tags
  WHERE id = NEW.tag_id
    AND (owner_kind IS NULL OR (owner_kind = 'event' AND owner_id = NEW.event_id))
)
BEGIN
  SELECT RAISE(ABORT, 'event quota tag is outside event scope');
END;

CREATE TRIGGER recurring_template_quota_tag_scope_insert
BEFORE INSERT ON recurring_template_class_quotas
WHEN NOT EXISTS (
  SELECT 1 FROM class_tags
  WHERE id = NEW.tag_id
    AND (owner_kind IS NULL OR (owner_kind = 'recurring_template' AND owner_id = NEW.template_id))
)
BEGIN
  SELECT RAISE(ABORT, 'template quota tag is outside template scope');
END;

CREATE TRIGGER recurring_template_quota_tag_scope_update
BEFORE UPDATE OF template_id, tag_id ON recurring_template_class_quotas
WHEN NOT EXISTS (
  SELECT 1 FROM class_tags
  WHERE id = NEW.tag_id
    AND (owner_kind IS NULL OR (owner_kind = 'recurring_template' AND owner_id = NEW.template_id))
)
BEGIN
  SELECT RAISE(ABORT, 'template quota tag is outside template scope');
END;

CREATE TRIGGER class_tag_scope_immutable
BEFORE UPDATE OF owner_kind, owner_id ON class_tags
WHEN OLD.owner_kind IS NOT NEW.owner_kind OR OLD.owner_id IS NOT NEW.owner_id
BEGIN
  SELECT RAISE(ABORT, 'class tag scope is immutable');
END;

CREATE TRIGGER event_poll_type_insert
BEFORE INSERT ON event_polls
WHEN NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id AND type = 'poll')
BEGIN
  SELECT RAISE(ABORT, 'poll settings require a poll event');
END;

CREATE TRIGGER event_poll_type_update
BEFORE UPDATE OF event_id ON event_polls
WHEN NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id AND type = 'poll')
BEGIN
  SELECT RAISE(ABORT, 'poll settings require a poll event');
END;

CREATE TRIGGER event_poll_parent_type_update
BEFORE UPDATE OF type ON events
WHEN NEW.type <> 'poll' AND EXISTS (SELECT 1 FROM event_polls WHERE event_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'poll settings require a poll event');
END;

CREATE TRIGGER event_raffle_winner_type_insert
BEFORE INSERT ON event_raffle_winners
WHEN NOT EXISTS (
  SELECT 1
  FROM events
  JOIN event_participants
    ON event_participants.event_id = events.id
   AND event_participants.user_id = NEW.user_id
  WHERE events.id = NEW.event_id AND events.type = 'raffle'
)
BEGIN
  SELECT RAISE(ABORT, 'raffle winners must be event participants');
END;

CREATE TRIGGER event_raffle_winner_type_update
BEFORE UPDATE OF event_id, user_id ON event_raffle_winners
WHEN NOT EXISTS (
  SELECT 1
  FROM events
  JOIN event_participants
    ON event_participants.event_id = events.id
   AND event_participants.user_id = NEW.user_id
  WHERE events.id = NEW.event_id AND events.type = 'raffle'
)
BEGIN
  SELECT RAISE(ABORT, 'raffle winners must be event participants');
END;

CREATE TRIGGER event_raffle_draw_immutable
BEFORE UPDATE OF type, winner_count, signup_locked ON events
WHEN EXISTS (SELECT 1 FROM event_raffle_draws WHERE event_id = OLD.id)
  AND (
    NEW.type <> OLD.type
    OR NEW.winner_count IS NOT OLD.winner_count
    OR NEW.signup_locked <> 1
  )
BEGIN
  SELECT RAISE(ABORT, 'drawn raffle configuration is immutable');
END;

CREATE TRIGGER event_participant_insert_guard
BEFORE INSERT ON event_participants
WHEN NOT EXISTS (
    SELECT 1 FROM event_participants
    WHERE event_id = NEW.event_id AND user_id = NEW.user_id
  )
  AND (
    NOT EXISTS (
      SELECT 1 FROM events
      WHERE id = NEW.event_id
        AND type <> 'poll'
        AND archived_at IS NULL
        AND (end_at IS NULL OR end_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
    OR EXISTS (
      SELECT 1 FROM events
      WHERE id = NEW.event_id
        AND capacity IS NOT NULL
        AND (SELECT count(*) FROM event_participants WHERE event_id = NEW.event_id) >= capacity
    )
    OR (SELECT count(*) FROM event_participants WHERE event_id = NEW.event_id) >= __EVENT_PARTICIPANTS_PER_EVENT_MAX__
  )
BEGIN
  SELECT RAISE(ABORT, 'event signup is unavailable');
END;

CREATE TRIGGER event_participant_identity_immutable
BEFORE UPDATE OF event_id, user_id ON event_participants
WHEN OLD.event_id IS NOT NEW.event_id OR OLD.user_id IS NOT NEW.user_id
BEGIN
  SELECT RAISE(ABORT, 'event participant identity is immutable');
END;

CREATE TRIGGER event_delete_owned_class_tags
AFTER DELETE ON events
BEGIN
  DELETE FROM class_tags WHERE owner_kind = 'event' AND owner_id = OLD.id;
END;

CREATE TRIGGER recurring_template_delete_owned_class_tags
AFTER DELETE ON recurring_templates
BEGIN
  DELETE FROM class_tags WHERE owner_kind = 'recurring_template' AND owner_id = OLD.id;
END;
