-- Gallery social features: likes + comments
-- Bot: WeChat event message tracking

CREATE TABLE gallery_likes (
  id TEXT PRIMARY KEY,
  gallery_item_id TEXT NOT NULL REFERENCES gallery_items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now') || 'Z'),
  UNIQUE(gallery_item_id, user_id)
);

CREATE INDEX idx_gallery_likes_item_id ON gallery_likes(gallery_item_id);

CREATE TABLE gallery_comments (
  id TEXT PRIMARY KEY,
  gallery_item_id TEXT NOT NULL REFERENCES gallery_items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now') || 'Z'),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now') || 'Z')
);

CREATE INDEX idx_gallery_comments_item_created ON gallery_comments(gallery_item_id, created_at, id);
CREATE INDEX idx_gallery_comments_user_id ON gallery_comments(user_id);

CREATE TABLE bot_wechat_event_messages (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  room_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now') || 'Z'),
  UNIQUE(event_id, room_id)
);
