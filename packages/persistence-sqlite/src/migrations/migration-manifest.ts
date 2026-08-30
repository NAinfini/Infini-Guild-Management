import manifest from "./generated/manifest.json" with { type: "json" };

export const APP_MIGRATION_LEDGER_MARKER = "-- app-migration-ledger";
export const APP_MIGRATION_MANIFEST: unknown = manifest;

export function canonicalMigrationPayload(sql: string): string {
  const markerIndex = sql.indexOf(APP_MIGRATION_LEDGER_MARKER);
  if (markerIndex < 0 || sql.indexOf(APP_MIGRATION_LEDGER_MARKER, markerIndex + 1) >= 0) {
    throw new TypeError("Application migration must contain exactly one ledger marker");
  }
  return sql.slice(0, markerIndex).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
