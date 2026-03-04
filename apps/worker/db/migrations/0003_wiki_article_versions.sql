CREATE TABLE IF NOT EXISTS wiki_article_versions (
  id TEXT PRIMARY KEY NOT NULL,
  article_id TEXT NOT NULL REFERENCES wiki_articles(id),
  version_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES wiki_categories(id),
  body_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  source_action TEXT NOT NULL DEFAULT 'update',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(article_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_wiki_article_versions_article_id
  ON wiki_article_versions(article_id);
CREATE INDEX IF NOT EXISTS idx_wiki_article_versions_created_at
  ON wiki_article_versions(created_at DESC);
