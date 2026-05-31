import type { Equipment, Loadout } from "./types";

type Migration = (pool: Equipment[], loadouts: Loadout[]) => void;

const migrations: Record<number, Migration> = {
  // Add real migrations when schemaVersion changes happen.
  // Key = version being migrated FROM.
  // Example:
  // 1: (pool, _loadouts) => {
  //   for (const equip of pool) { /* rename stat */ }
  // },
};

export function migrateLocalData(
  pool: Equipment[],
  loadouts: Loadout[],
  fromVersion: number,
  toVersion: number,
): void {
  for (let v = fromVersion; v < toVersion; v++) {
    const migrate = migrations[v];
    if (migrate) migrate(pool, loadouts);
  }
}
