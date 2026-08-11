-- The built-in site_owner role is the trust root. There may be multiple owners,
-- but the system must always retain at least one active, non-deleted owner.

CREATE TRIGGER auth_role_permission_identity_immutable
BEFORE UPDATE OF role_id, permission ON role_permissions
WHEN OLD.role_id IS NOT NEW.role_id OR OLD.permission IS NOT NEW.permission
BEGIN
  SELECT RAISE(ABORT, 'role permission identity is immutable');
END;

CREATE TRIGGER auth_site_owner_role_identity_immutable
BEFORE UPDATE OF id ON roles
WHEN OLD.id = 'site_owner' OR NEW.id = 'site_owner'
BEGIN
  SELECT RAISE(ABORT, 'site owner role identity is immutable');
END;

CREATE TRIGGER auth_site_owner_role_required
BEFORE DELETE ON roles
WHEN OLD.id = 'site_owner'
BEGIN
  SELECT RAISE(ABORT, 'last site owner required');
END;

CREATE TRIGGER auth_owner_permission_site_owner_only_insert
BEFORE INSERT ON role_permissions
WHEN NEW.permission = 'admin.owners.manage' AND NEW.role_id <> 'site_owner'
BEGIN
  SELECT RAISE(ABORT, 'owner permission is reserved for site owner');
END;

CREATE TRIGGER auth_owner_permission_site_owner_only_delete
BEFORE DELETE ON role_permissions
WHEN OLD.permission = 'admin.owners.manage' AND OLD.role_id = 'site_owner'
BEGIN
  SELECT RAISE(ABORT, 'last site owner required');
END;

CREATE TRIGGER auth_keep_last_site_owner_on_user_update
BEFORE UPDATE OF role_id, is_active, deleted_at ON users
WHEN OLD.is_active = 1
 AND OLD.deleted_at IS NULL
 AND OLD.role_id = 'site_owner'
 AND (
   NEW.is_active = 0
   OR NEW.deleted_at IS NOT NULL
   OR NEW.role_id <> 'site_owner'
 )
 AND NOT EXISTS (
   SELECT 1
   FROM users u
   WHERE u.id <> OLD.id
     AND u.is_active = 1
     AND u.deleted_at IS NULL
     AND u.role_id = 'site_owner'
 )
BEGIN
  SELECT RAISE(ABORT, 'last site owner required');
END;

CREATE TRIGGER auth_keep_last_site_owner_on_user_delete
BEFORE DELETE ON users
WHEN OLD.is_active = 1
 AND OLD.deleted_at IS NULL
 AND OLD.role_id = 'site_owner'
 AND NOT EXISTS (
   SELECT 1
   FROM users u
   WHERE u.id <> OLD.id
     AND u.is_active = 1
     AND u.deleted_at IS NULL
     AND u.role_id = 'site_owner'
 )
BEGIN
  SELECT RAISE(ABORT, 'last site owner required');
END;

-- login_failures also records unknown usernames, so it cannot reference users.
-- Once a real account is deleted, its lock state must not survive username reuse.
CREATE TRIGGER auth_login_failure_cleanup_after_user_delete
AFTER DELETE ON users
BEGIN
  DELETE FROM login_failures WHERE username = lower(OLD.username);
END;
