-- Role management is dynamic. The system must retain at least one active,
-- non-deleted user whose current role grants admin.roles.manage.
CREATE TRIGGER auth_role_permission_identity_immutable
BEFORE UPDATE OF role_id, permission ON role_permissions
WHEN OLD.role_id IS NOT NEW.role_id OR OLD.permission IS NOT NEW.permission
BEGIN
  SELECT RAISE(ABORT, 'role permission identity is immutable');
END;

CREATE TRIGGER auth_keep_last_role_manager_on_permission_delete
BEFORE DELETE ON role_permissions
WHEN OLD.permission = 'admin.roles.manage'
 AND EXISTS (
   SELECT 1
   FROM users u
   WHERE u.role_id = OLD.role_id
     AND u.is_active = 1
     AND u.deleted_at IS NULL
 )
 AND NOT EXISTS (
   SELECT 1
   FROM users u
   JOIN role_permissions rp ON rp.role_id = u.role_id
   WHERE u.role_id <> OLD.role_id
     AND u.is_active = 1
     AND u.deleted_at IS NULL
     AND rp.permission = 'admin.roles.manage'
 )
BEGIN
  SELECT RAISE(ABORT, 'last role manager required');
END;

CREATE TRIGGER auth_keep_last_role_manager_on_user_update
BEFORE UPDATE OF role_id, is_active, deleted_at ON users
WHEN OLD.is_active = 1
 AND OLD.deleted_at IS NULL
 AND EXISTS (
   SELECT 1 FROM role_permissions rp
   WHERE rp.role_id = OLD.role_id AND rp.permission = 'admin.roles.manage'
 )
 AND (
   NEW.is_active = 0
   OR NEW.deleted_at IS NOT NULL
   OR NOT EXISTS (
     SELECT 1 FROM role_permissions rp
     WHERE rp.role_id = NEW.role_id AND rp.permission = 'admin.roles.manage'
   )
 )
 AND NOT EXISTS (
   SELECT 1
   FROM users u
   JOIN role_permissions rp ON rp.role_id = u.role_id
   WHERE u.id <> OLD.id
     AND u.is_active = 1
     AND u.deleted_at IS NULL
     AND rp.permission = 'admin.roles.manage'
 )
BEGIN
  SELECT RAISE(ABORT, 'last role manager required');
END;

CREATE TRIGGER auth_keep_last_role_manager_on_user_delete
BEFORE DELETE ON users
WHEN OLD.is_active = 1
 AND OLD.deleted_at IS NULL
 AND EXISTS (
   SELECT 1 FROM role_permissions rp
   WHERE rp.role_id = OLD.role_id AND rp.permission = 'admin.roles.manage'
 )
 AND NOT EXISTS (
   SELECT 1
   FROM users u
   JOIN role_permissions rp ON rp.role_id = u.role_id
   WHERE u.id <> OLD.id
     AND u.is_active = 1
     AND u.deleted_at IS NULL
     AND rp.permission = 'admin.roles.manage'
 )
BEGIN
  SELECT RAISE(ABORT, 'last role manager required');
END;
