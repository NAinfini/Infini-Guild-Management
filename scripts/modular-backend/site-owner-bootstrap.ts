import { LIMITS } from "@guild/shared/config/limits";
import { z } from "zod";

const identifierSchema = z.string()
  .min(1)
  .max(128)
  .refine((value) => value === value.trim(), "identifier must not contain outer whitespace");
const usernameSchema = z.string()
  .min(LIMITS.content.username.min)
  .max(LIMITS.content.username.max)
  .regex(/^[a-zA-Z0-9_一-鿿]+$/);
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
    username: usernameSchema,
    passwordHash: passwordHashSchema,
    nonce: identifierSchema.optional(),
  }).strict(),
  z.object({
    mode: z.literal("promote"),
    userId: identifierSchema,
    nonce: identifierSchema.optional(),
  }).strict(),
]);

export type SiteOwnerBootstrapInput = z.input<typeof bootstrapInputSchema>;

export type SiteOwnerBootstrapBundle = Readonly<{
  mode: "create" | "promote";
  userId: string;
  sql: string;
}>;

/**
 * Creates the one-time private migration that establishes the first site owner.
 * Afterward, additional owners must be assigned through the authenticated admin API.
 */
export function buildSiteOwnerBootstrapBundle(input: SiteOwnerBootstrapInput): SiteOwnerBootstrapBundle {
  const parsed = bootstrapInputSchema.parse(input);
  const nonce = parsed.nonce ?? crypto.randomUUID();
  const userRevision = `bootstrap-user-${nonce}`;
  const profileRevision = `bootstrap-profile-${nonce}`;
  const auditId = `bootstrap-audit-${nonce}`;
  const requestId = `bootstrap-request-${nonce}`;

  const createUserSql = parsed.mode === "create"
    ? `INSERT INTO users (id, username, role_id, is_active, deleted_at, revision_token)
VALUES (${sqlString(parsed.userId)}, ${sqlString(parsed.username)}, 'site_owner', 1, NULL, ${sqlString(userRevision)});
INSERT INTO user_credentials (user_id, password_hash)
VALUES (${sqlString(parsed.userId)}, ${sqlString(parsed.passwordHash)});
INSERT INTO member_profiles (user_id, revision_token)
VALUES (${sqlString(parsed.userId)}, ${sqlString(profileRevision)});`
    : `INSERT INTO _ig_owner_bootstrap_assertions (ok)
SELECT CASE WHEN count(*) = 1 THEN 1 ELSE 0 END
FROM users
WHERE id = ${sqlString(parsed.userId)} AND is_active = 1 AND deleted_at IS NULL;
UPDATE users
SET role_id = 'site_owner', revision_token = ${sqlString(userRevision)},
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ${sqlString(parsed.userId)} AND is_active = 1 AND deleted_at IS NULL;`;

  const sql = `-- Private one-time first-site-owner bootstrap. Never commit the generated file.
CREATE TABLE _ig_owner_bootstrap_assertions (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO _ig_owner_bootstrap_assertions (ok)
SELECT CASE WHEN count(*) = 1 THEN 1 ELSE 0 END
FROM roles
WHERE id = 'site_owner' AND level = 1000;
INSERT INTO _ig_owner_bootstrap_assertions (ok)
SELECT CASE WHEN count(*) = 1 THEN 1 ELSE 0 END
FROM role_permissions
WHERE role_id = 'site_owner' AND permission = 'admin.owners.manage';
INSERT INTO _ig_owner_bootstrap_assertions (ok)
SELECT CASE WHEN count(*) = 0 THEN 1 ELSE 0 END
FROM users
WHERE role_id = 'site_owner' AND is_active = 1 AND deleted_at IS NULL;
${createUserSql}
INSERT INTO audit_log (
  id, request_id, actor_user_id, actor_username, entity_type, entity_id, action, summary, detail_json, occurred_at
) VALUES (
  ${sqlString(auditId)}, ${sqlString(requestId)}, ${sqlString(parsed.userId)},
  (SELECT username FROM users WHERE id = ${sqlString(parsed.userId)}),
  'user', ${sqlString(parsed.userId)}, 'init', 'Established first site owner',
  ${sqlString(JSON.stringify({ mode: parsed.mode, role_id: "site_owner" }))},
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
DROP TABLE _ig_owner_bootstrap_assertions;
`;

  return Object.freeze({ mode: parsed.mode, userId: parsed.userId, sql });
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
