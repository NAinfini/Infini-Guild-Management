-- Deliberately small E2E fixture for the fresh modular schema.
-- The admin project authenticates as this seeded admin; specs that need mutable
-- users create run-registered throwaways, while member_01 is the shared peer.
INSERT INTO users (
  id, display_name, role_id, is_active, deleted_at, revision_token, created_at, updated_at
) VALUES (
  'e2e-owner', 'admin', 'admin', 1, NULL, 'e2e-owner-user-revision',
  '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
);

INSERT INTO user_credentials (user_id, login_name, password_hash, updated_at) VALUES (
  'e2e-owner', 'admin',
  'pbkdf2-sha256$10000$aW5maW5pLWUyZS1vd25lcg$-VYi6RNWPNIdHw3hXNV9jsMaTTUvgCy-AqKVhQy7kVw',
  '2026-01-01T00:00:00.000Z'
);

INSERT INTO member_profiles (
  user_id, revision_token, created_at, updated_at
) VALUES (
  'e2e-owner', 'e2e-owner-profile-revision',
  '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
);

INSERT INTO users (
  id, display_name, role_id, is_active, deleted_at, revision_token, created_at, updated_at
) VALUES (
  'e2e-member-01', 'member_01', 'member', 1, NULL, 'e2e-member-user-revision',
  '2026-01-01T00:01:00.000Z', '2026-01-01T00:01:00.000Z'
);

INSERT INTO member_profiles (
  user_id, revision_token, created_at, updated_at
) VALUES (
  'e2e-member-01', 'e2e-member-profile-revision',
  '2026-01-01T00:01:00.000Z', '2026-01-01T00:01:00.000Z'
);
