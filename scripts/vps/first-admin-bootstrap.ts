import { LIMITS } from "@guild/shared/config/limits";
import { isReservedSystemTestIdentityName } from "@guild/shared/config/system-test";
import { z } from "zod";

const identifierSchema = z.string()
  .min(1)
  .max(128)
  .refine((value) => value === value.trim(), "identifier must not contain outer whitespace");
const identityNameSchema = z.string()
  .min(LIMITS.content.identityName.min)
  .max(LIMITS.content.identityName.max)
  .regex(/^[a-zA-Z0-9_一-鿿]+$/)
  .refine((value) => !isReservedSystemTestIdentityName(value), "identity name is reserved");
const passwordHashSchema = z.string()
  .regex(/^pbkdf2-sha256\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/)
  .max(512)
  .refine((value) => {
    const iterations = Number(value.split("$", 3)[1]);
    return Number.isInteger(iterations) && iterations >= 10_000 && iterations <= 10_000_000;
  }, "password hash iterations must be between 10000 and 10000000");

const bootstrapInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("create"),
    userId: identifierSchema,
    loginName: identityNameSchema,
    displayName: identityNameSchema,
    passwordHash: passwordHashSchema,
    nonce: identifierSchema.optional(),
  }).strict(),
  z.object({
    mode: z.literal("promote"),
    userId: identifierSchema,
    nonce: identifierSchema.optional(),
  }).strict(),
]);

export type FirstAdminBootstrapInput = z.input<typeof bootstrapInputSchema>;

export type FirstAdminBootstrapBundle = Readonly<{
  mode: "create" | "promote";
  userId: string;
  sql: string;
}>;

/** Creates the private one-time migration that establishes the first active role manager. */
export function buildFirstAdminBootstrapBundle(input: FirstAdminBootstrapInput): FirstAdminBootstrapBundle {
  const parsed = bootstrapInputSchema.parse(input);
  const nonce = parsed.nonce ?? crypto.randomUUID();
  const userRevision = `bootstrap-user-${nonce}`;
  const profileRevision = `bootstrap-profile-${nonce}`;
  const auditEventId = `bootstrap-audit-${nonce}`;
  const requestId = `bootstrap-request-${nonce}`;
  const auditPayload = JSON.stringify({
    schema_version: 2,
    changes: [],
    context: [{ field: "role_id", value: { type: "code", value: "admin" } }],
  });

  const createUserSql = parsed.mode === "create"
    ? `INSERT INTO users (id, display_name, role_id, is_active, deleted_at, revision_token)
VALUES (${sqlString(parsed.userId)}, ${sqlString(parsed.displayName)}, 'admin', 1, NULL, ${sqlString(userRevision)});
INSERT INTO user_credentials (user_id, login_name, password_hash)
VALUES (${sqlString(parsed.userId)}, ${sqlString(parsed.loginName)}, ${sqlString(parsed.passwordHash)});
INSERT INTO member_profiles (user_id, revision_token)
VALUES (${sqlString(parsed.userId)}, ${sqlString(profileRevision)});`
    : `INSERT INTO _ig_role_manager_bootstrap_assertions (ok)
SELECT CASE WHEN count(*) = 1 THEN 1 ELSE 0 END
FROM users
WHERE id = ${sqlString(parsed.userId)} AND is_active = 1 AND deleted_at IS NULL;
UPDATE users
SET role_id = 'admin', revision_token = ${sqlString(userRevision)},
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ${sqlString(parsed.userId)} AND is_active = 1 AND deleted_at IS NULL;`;

  const sql = `-- Private one-time first-admin bootstrap. Never commit the generated file.
CREATE TABLE _ig_role_manager_bootstrap_assertions (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO _ig_role_manager_bootstrap_assertions (ok)
SELECT CASE WHEN count(*) = 1 THEN 1 ELSE 0 END
FROM role_permissions
WHERE role_id = 'admin' AND permission = 'admin.roles.manage';
INSERT INTO _ig_role_manager_bootstrap_assertions (ok)
SELECT CASE WHEN count(*) = 0 THEN 1 ELSE 0 END
FROM users u
JOIN role_permissions rp ON rp.role_id = u.role_id
WHERE u.is_active = 1 AND u.deleted_at IS NULL AND rp.permission = 'admin.roles.manage';
${createUserSql}
INSERT INTO audit_log (
  id, request_id, actor_kind, actor_id, actor_label, subject_type, subject_id,
  subject_label, action, payload_json, occurred_at
) VALUES (
  ${sqlString(auditEventId)}, ${sqlString(requestId)}, 'user', ${sqlString(parsed.userId)},
  (SELECT display_name FROM users WHERE id = ${sqlString(parsed.userId)}),
  'user', ${sqlString(parsed.userId)},
  (SELECT display_name FROM users WHERE id = ${sqlString(parsed.userId)}),
  'init', ${sqlString(auditPayload)},
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
DROP TABLE _ig_role_manager_bootstrap_assertions;
`;

  return Object.freeze({ mode: parsed.mode, userId: parsed.userId, sql });
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
