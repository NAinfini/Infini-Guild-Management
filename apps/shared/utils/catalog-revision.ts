/**
 * A catalog revision is intentionally derived from the complete ordered list.
 * The values are already visible to catalog editors; serializing them avoids a
 * second persisted state solely for optimistic concurrency on small catalogs.
 */
export type CatalogRevisionEntry = Readonly<{
  id: string;
  sort_order: number;
  updated_at: string;
}>;

export function catalogRevisionToken(entries: readonly CatalogRevisionEntry[]): string {
  return JSON.stringify(entries.map(({ id, sort_order, updated_at }) => [id, sort_order, updated_at]));
}
