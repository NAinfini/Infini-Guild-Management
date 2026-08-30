import type { SqlBatchStatement, SqlValue } from "@guild/kernel";
import type { ManagedUserTarget } from "@guild/server/modules/auth";

const MAX_MANAGED_USER_BATCH = 50;

function run(sql: string, params: readonly SqlValue[] = []): SqlBatchStatement {
  return { method: "run", sql, params };
}

export function permissionSnapshot(permissions: ReadonlySet<string> | readonly string[]): string {
  return [...permissions].sort().join(",");
}

export function managedTargetSnapshot(targets: readonly ManagedUserTarget[]): string {
  return [...targets]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((target) => [
      target.id,
      target.roleId,
      target.revisionToken,
      target.roleRevisionToken,
      target.roleLevel,
      target.isActive ? 1 : 0,
      target.deletedAt ?? "",
      permissionSnapshot(target.rolePermissions),
    ].join("\u001f"))
    .join("\u001e");
}

function assertManagedBatch(targets: readonly ManagedUserTarget[]): void {
  if (targets.length < 1 || targets.length > MAX_MANAGED_USER_BATCH || new Set(targets.map(({ id }) => id)).size !== targets.length) {
    throw new RangeError(`Managed user batches must contain 1 to ${MAX_MANAGED_USER_BATCH} unique users`);
  }
}

export function targetSnapshotCte(targets: readonly ManagedUserTarget[]): Readonly<{ sql: string; params: readonly SqlValue[] }> {
  assertManagedBatch(targets);
  return {
    sql: `WITH target_snapshot AS (
      SELECT u.id, u.role_id, u.revision_token, role.revision_token AS role_revision_token,
        role.level AS role_level, u.is_active, u.deleted_at,
        COALESCE((
          SELECT group_concat(permission, ',') FROM (
            SELECT permission FROM role_permissions WHERE role_id = u.role_id ORDER BY permission
          )
        ), '') AS permission_snapshot
      FROM users AS u
      JOIN roles AS role ON role.id = u.role_id
      WHERE u.id IN (${targets.map(() => "?").join(", ")})
    )`,
    params: targets.map(({ id }) => id),
  };
}

export const TARGET_SNAPSHOT_MATCH = `COALESCE((
  SELECT group_concat(snapshot, char(30)) FROM (
    SELECT id || char(31) || role_id || char(31) || revision_token || char(31)
      || role_revision_token || char(31) || role_level || char(31) || is_active || char(31)
      || COALESCE(deleted_at, '') || char(31) || permission_snapshot AS snapshot
    FROM target_snapshot ORDER BY id
  )
), '') = ?`;

export const ROLE_SNAPSHOT_MATCH = `EXISTS (
  SELECT 1 FROM roles AS destination
  WHERE destination.id = ? AND destination.revision_token = ? AND destination.level = ?
    AND COALESCE((
      SELECT group_concat(permission, ',') FROM (
        SELECT permission FROM role_permissions WHERE role_id = destination.id ORDER BY permission
      )
    ), '') = ?
)`;

export function deleteSessionsAfterMutation(
  targets: readonly ManagedUserTarget[],
  revisionToken: string,
): SqlBatchStatement {
  return run(
    `WITH intended(id) AS (VALUES ${targets.map(() => "(?)").join(", ")})
     DELETE FROM sessions
     WHERE user_id IN (SELECT id FROM intended)
       AND (SELECT count(*) FROM users JOIN intended ON intended.id = users.id WHERE users.revision_token = ?) = ?`,
    [...targets.map(({ id }) => id), revisionToken, targets.length],
  );
}
