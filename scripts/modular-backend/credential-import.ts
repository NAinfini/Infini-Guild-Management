import { convertLegacyWorkerPasswordHash } from "@guild/server/migrations/auth-password-hash";
import { z } from "zod";

const legacyCredentialRowSchema = z.object({
  user_id: z.string().min(1).max(128).refine((value) => value === value.trim(), "user_id must not contain outer whitespace"),
  password_hash: z.string().min(1).max(512),
  salt: z.string().min(1).max(128),
}).strict();

const legacyCredentialRowsSchema = z.array(legacyCredentialRowSchema).min(1).max(10_000);

export type LegacyCredentialRow = z.infer<typeof legacyCredentialRowSchema>;

export type CredentialImportBundle = Readonly<{
  rowCount: number;
  sql: string;
}>;

/**
 * Builds one SQLite migration body shared by D1 migrations and the VPS
 * transactional importer. It intentionally contains no BEGIN/COMMIT because
 * D1 migration application owns the transaction boundary.
 */
export function buildLegacyCredentialImportBundle(input: unknown): CredentialImportBundle {
  const rows = legacyCredentialRowsSchema.parse(input)
    .map((row) => ({
      userId: row.user_id,
      passwordHash: convertLegacyWorkerPasswordHash({
        passwordHash: row.password_hash,
        salt: row.salt,
      }),
    }))
    .sort((left, right) => left.userId.localeCompare(right.userId));
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.userId)) throw new TypeError(`Duplicate user_id: ${row.userId}`);
    seen.add(row.userId);
  }

  const values = rows
    .map((row) => `(${sqlString(row.userId)}, ${sqlString(row.passwordHash)})`)
    .join(",\n  ");
  const count = rows.length;
  const sql = `-- Private one-time credential import. Never commit the generated file.
CREATE TABLE _ig_credential_import_rows (
  user_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL
) WITHOUT ROWID;
INSERT INTO _ig_credential_import_rows (user_id, password_hash) VALUES
  ${values};
CREATE TABLE _ig_credential_import_assertions (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO _ig_credential_import_assertions (ok)
SELECT CASE WHEN (
  SELECT count(*)
  FROM users AS users
  JOIN _ig_credential_import_rows AS imported ON imported.user_id = users.id
) = ${count} THEN 1 ELSE 0 END;
INSERT INTO user_credentials (user_id, password_hash, updated_at)
SELECT user_id, password_hash, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM _ig_credential_import_rows
WHERE 1
ON CONFLICT(user_id) DO UPDATE SET
  password_hash = excluded.password_hash,
  updated_at = excluded.updated_at;
INSERT INTO _ig_credential_import_assertions (ok)
SELECT CASE WHEN (
  SELECT count(*)
  FROM user_credentials AS credentials
  JOIN _ig_credential_import_rows AS imported
    ON imported.user_id = credentials.user_id
   AND imported.password_hash = credentials.password_hash
) = ${count} THEN 1 ELSE 0 END;
DROP TABLE _ig_credential_import_assertions;
DROP TABLE _ig_credential_import_rows;
`;
  return Object.freeze({ rowCount: count, sql });
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
