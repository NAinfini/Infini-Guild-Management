-- Make D1 the sole authority for editable roles and invite assignments.
-- Existing invitations retain every field and target the historical Member role.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE __new_roles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  level INTEGER NOT NULL CONSTRAINT roles_level_positive CHECK (level >= 1),
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE __new_role_permissions (
  role_id TEXT NOT NULL REFERENCES __new_roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE __new_invite_links (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  role_id TEXT NOT NULL REFERENCES __new_roles(id) ON DELETE RESTRICT,
  max_uses INTEGER NOT NULL CONSTRAINT invite_links_max_uses_positive CHECK (max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CONSTRAINT invite_links_used_count_valid CHECK (used_count >= 0 AND used_count <= max_uses),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT
);

INSERT INTO __new_roles (id, name, level, color, created_at, updated_at)
SELECT id, name, level, color, created_at, updated_at FROM roles;

INSERT INTO __new_role_permissions (role_id, permission, granted)
SELECT role_id, permission, granted FROM role_permissions;

INSERT INTO __new_invite_links
  (id, code, created_by, role_id, max_uses, used_count, expires_at, created_at, revoked_at)
SELECT id, code, created_by, 'member', max_uses, used_count, expires_at, created_at, revoked_at
FROM invite_links;

DROP TABLE invite_links;
DROP TABLE role_permissions;
DROP TABLE roles;

ALTER TABLE __new_roles RENAME TO roles;
ALTER TABLE __new_role_permissions RENAME TO role_permissions;
ALTER TABLE __new_invite_links RENAME TO invite_links;

CREATE INDEX idx_roles_level ON roles(level, id);
CREATE INDEX idx_role_permissions_permission ON role_permissions(permission);
CREATE INDEX idx_invite_links_created ON invite_links(created_at, id);
CREATE INDEX idx_invite_links_status ON invite_links(revoked_at, expires_at, created_at);

PRAGMA defer_foreign_keys = OFF;
PRAGMA foreign_key_check;
