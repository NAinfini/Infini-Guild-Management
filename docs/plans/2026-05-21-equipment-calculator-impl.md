# Equipment Graduation Rate Calculator — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an in-house equipment graduation rate calculator integrated into the Tools page, with admin-managed game data in D1/R2 and all user data in localStorage.

**Architecture:** Shared pure-TypeScript calculator engine + Zod schemas in `apps/shared/`, Hono API routes for game data CRUD in `apps/worker/`, React+Mantine+Zustand frontend in `apps/portal/`. Public access (no auth for reads), admin-only for game data management.

**Tech Stack:** React 19, TypeScript 6, Mantine 8, Tailwind CSS 4, Zustand 5, Hono 4, Drizzle ORM, Zod 4, i18next, Web Workers

**Design doc:** `docs/plans/2026-05-21-equipment-calculator-design.md`

---

## Phase 1: Shared Types, Schemas, Feature Flag

### Task 1: TypeScript Interfaces

**Files:**
- Create: `apps/shared/calculator/types.ts`

**Step 1: Create type definitions**

```ts
// apps/shared/calculator/types.ts

export interface Equipment {
  id: string;
  name: string;
  slotId: string;
  weaponTypeId?: string;
  isChengyin: boolean;
  isPurple: boolean;
  mainStat: { type: string; value: number };
  subStats: { type: string; value: number }[];
  dingyinStat: { type: string; value: number };
  availableClasses?: string[];
  createdAt: number;
}

export interface Loadout {
  id: string;
  name: string;
  classId: string;
  xinfaSlots: string[];
  setId: string;
  bowType: string;
  armoryType: string;
  equippedItems: {
    weapon1?: string;
    weapon2?: string;
    head?: string;
    chest?: string;
    ring?: string;
    pendant?: string;
    legs?: string;
    hands?: string;
  };
  earlySeasonBonus: boolean;
  loanDingyin: boolean;
}

export type EquippedSlot = keyof Loadout["equippedItems"];

export interface RotationEntry {
  skillId: string;
  count?: number;
  isCharged?: boolean;
}

export interface SkillEntry {
  name: string;
  outerRatio?: number;
  eleRatio?: number;
  fixed?: number;
  type?: string;
  weaponType?: string;
}

export interface GameData {
  version: string;
  updatedAt: string;
  schemaVersion: number;

  seasonStats: Record<string, number | string | boolean>;
  maxValues: Record<string, number>;

  xinfaData: Record<string, {
    icon?: string;
    stats: Record<string, number>;
  }>;

  setData: Record<string, {
    icon?: string;
    stats: Record<string, number>;
  }>;

  classConfig: Record<string, {
    author: string;
    version: string;
    updateTime: string;
    rotation: RotationEntry[];
    skillDatabase: Record<string, SkillEntry>;
  }>;

  slots: { id: string; name: string; nameEn: string; icon?: string }[];
  weaponTypes: { id: string; name: string; nameEn: string; icon?: string; stat: string }[];

  slotRules: {
    mainStats: Record<string, string[]>;
    dingyinStats: Record<string, string[]>;
  };

  baseStats: Record<string, number>;
  percentStats: string[];
  baseSubStats: string[];
}

export interface StatSheet {
  [statName: string]: number;
}

export interface RateBreakdown {
  totalRate: number;
  perSlotRates: Record<string, number>;
  perStatContributions: Record<string, number>;
}

export interface BuildResult {
  equippedItems: Record<EquippedSlot, string>;
  graduationRate: number;
  dps: number;
}

export interface GameDataVersion {
  id: number;
  version: string;
  uploaded_by: number;
  created_at: string;
}
```

**Step 2: Verify types compile**

Run: `pnpm --filter @guild/shared exec tsc --noEmit`
Expected: clean

**Step 3: Commit**

```bash
git add apps/shared/calculator/types.ts
git commit -m "feat(shared): add equipment calculator type definitions"
```

---

### Task 2: Zod Schemas

**Files:**
- Create: `apps/shared/schemas/equipment-calc.ts`
- Modify: `apps/shared/index.ts`

**Step 1: Create Zod schemas**

```ts
// apps/shared/schemas/equipment-calc.ts
import { z } from "zod";

const statEntrySchema = z.object({
  type: z.string().min(1),
  value: z.number(),
});

export const equipmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  slotId: z.string().min(1),
  weaponTypeId: z.string().optional(),
  isChengyin: z.boolean(),
  isPurple: z.boolean(),
  mainStat: statEntrySchema,
  subStats: z.array(statEntrySchema).max(4),
  dingyinStat: statEntrySchema,
  availableClasses: z.array(z.string()).optional(),
  createdAt: z.number(),
});

export const loadoutSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  classId: z.string().min(1),
  xinfaSlots: z.array(z.string()).length(4),
  setId: z.string().min(1),
  bowType: z.string().min(1),
  armoryType: z.string().min(1),
  equippedItems: z.object({
    weapon1: z.string().optional(),
    weapon2: z.string().optional(),
    head: z.string().optional(),
    chest: z.string().optional(),
    ring: z.string().optional(),
    pendant: z.string().optional(),
    legs: z.string().optional(),
    hands: z.string().optional(),
  }),
  earlySeasonBonus: z.boolean(),
  loanDingyin: z.boolean(),
});

const rotationEntrySchema = z.object({
  skillId: z.string().min(1),
  count: z.number().int().positive().optional(),
  isCharged: z.boolean().optional(),
});

const skillEntrySchema = z.object({
  name: z.string().min(1),
  outerRatio: z.number().optional(),
  eleRatio: z.number().optional(),
  fixed: z.number().optional(),
  type: z.string().optional(),
  weaponType: z.string().optional(),
});

const slotDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameEn: z.string().min(1),
  icon: z.string().optional(),
});

const weaponTypeDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameEn: z.string().min(1),
  icon: z.string().optional(),
  stat: z.string().min(1),
});

export const gameDataSchema = z.object({
  version: z.string().min(1),
  updatedAt: z.string().min(1),
  schemaVersion: z.number().int().min(1),

  seasonStats: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  maxValues: z.record(z.string(), z.number()),

  xinfaData: z.record(z.string(), z.object({
    icon: z.string().optional(),
    stats: z.record(z.string(), z.number()),
  })),

  setData: z.record(z.string(), z.object({
    icon: z.string().optional(),
    stats: z.record(z.string(), z.number()),
  })),

  classConfig: z.record(z.string(), z.object({
    author: z.string(),
    version: z.string(),
    updateTime: z.string(),
    rotation: z.array(rotationEntrySchema),
    skillDatabase: z.record(z.string(), skillEntrySchema),
  })),

  slots: z.array(slotDefSchema).min(1),
  weaponTypes: z.array(weaponTypeDefSchema).min(1),

  slotRules: z.object({
    mainStats: z.record(z.string(), z.array(z.string())),
    dingyinStats: z.record(z.string(), z.array(z.string())),
  }),

  baseStats: z.record(z.string(), z.number()),
  percentStats: z.array(z.string()),
  baseSubStats: z.array(z.string()),
});

export const gameDataUploadSchema = gameDataSchema;

export type EquipmentInput = z.infer<typeof equipmentSchema>;
export type LoadoutInput = z.infer<typeof loadoutSchema>;
export type GameDataInput = z.infer<typeof gameDataSchema>;
```

**Step 2: Export from shared index**

Add to `apps/shared/index.ts`:

```ts
export * from "./schemas/equipment-calc";
export * from "./calculator/types";
```

**Step 3: Verify types compile**

Run: `pnpm --filter @guild/shared exec tsc --noEmit`
Expected: clean

**Step 4: Commit**

```bash
git add apps/shared/schemas/equipment-calc.ts apps/shared/index.ts
git commit -m "feat(shared): add equipment calculator Zod schemas"
```

---

### Task 3: Feature Flag + Permission

**Files:**
- Modify: `apps/shared/config/features.ts`
- Modify: `apps/shared/constants/roles.ts`

**Step 1: Add feature flag**

In `apps/shared/config/features.ts`, add `equipmentCalc: boolean` to `FeatureFlags` interface and `equipmentCalc: true` to `DEFAULT_FEATURE_FLAGS`.

**Step 2: Add permission**

In `apps/shared/constants/roles.ts`, add `"admin.gameData.manage"` to the `PERMISSIONS` array (after `"admin.badges.manage"`).

**Step 3: Verify types compile**

Run: `pnpm --filter @guild/shared exec tsc --noEmit`
Expected: clean — but check that all consumers of `Permission` type still compile.

Run: `pnpm typecheck`
Expected: clean (the new permission literal extends the union; existing code doesn't break)

**Step 4: Commit**

```bash
git add apps/shared/config/features.ts apps/shared/constants/roles.ts
git commit -m "feat(shared): add equipmentCalc feature flag and admin.gameData.manage permission"
```

---

### Task 4: Calculator Engine — Stat Aggregation

**Files:**
- Create: `apps/shared/calculator/engine.ts`

This is the core calculation engine. All functions are pure — no DOM, no side effects.

**Step 1: Implement calculateTotal**

```ts
// apps/shared/calculator/engine.ts
import type { Equipment, GameData, StatSheet, RateBreakdown, RotationEntry, SkillEntry } from "./types";

export function getStatQuality(statType: string, value: number, gameData: GameData): number {
  const max = gameData.maxValues[statType];
  if (!max || max <= 0) return 0;
  return Math.min(100, (value / max) * 100);
}

export function calculateTotal(
  equippedItems: Record<string, Equipment | undefined>,
  classId: string,
  bowType: string,
  xinfaLoadout: string[],
  setId: string,
  earlySeasonBonus: boolean,
  loanDingyin: boolean,
  armoryType: string,
  gameData: GameData,
): StatSheet {
  const stats: StatSheet = { ...gameData.baseStats };

  // Sum equipment stats
  for (const equip of Object.values(equippedItems)) {
    if (!equip) continue;
    addStat(stats, equip.mainStat.type, equip.mainStat.value);
    for (const sub of equip.subStats) {
      addStat(stats, sub.type, sub.value);
    }
    if (!loanDingyin || !equip.isChengyin) {
      addStat(stats, equip.dingyinStat.type, equip.dingyinStat.value);
    }
  }

  // Xinfa bonuses
  for (const xinfaId of xinfaLoadout) {
    const xinfa = gameData.xinfaData[xinfaId];
    if (!xinfa) continue;
    for (const [stat, value] of Object.entries(xinfa.stats)) {
      addStat(stats, stat, value);
    }
  }

  // Set bonus
  const set = gameData.setData[setId];
  if (set) {
    for (const [stat, value] of Object.entries(set.stats)) {
      addStat(stats, stat, value);
    }
  }

  // Bow bonus from seasonStats
  const bowKey = bowType === "precision" ? "精准弓加成"
    : bowType === "crit" ? "会心弓加成"
    : bowType === "intent" ? "会意弓加成"
    : null;
  if (bowKey && typeof gameData.seasonStats[bowKey] === "number") {
    // Bow bonuses are applied as flat additions to the relevant stat
    // The exact stat they boost depends on the bow type mapping
  }

  return stats;
}

function addStat(sheet: StatSheet, statType: string, value: number): void {
  sheet[statType] = (sheet[statType] ?? 0) + value;
}

export function calculateGraduationRate(
  stats: StatSheet,
  skillDatabase: Record<string, SkillEntry>,
  rotation: RotationEntry[],
  gameData: GameData,
): { graduationRate: number; details: RateBreakdown } {
  // Graduation rate = weighted average of per-stat quality percentages
  // Each stat's weight comes from its DPS contribution via the rotation
  const perStatContributions: Record<string, number> = {};
  const perSlotRates: Record<string, number> = {};
  let totalWeight = 0;
  let weightedSum = 0;

  for (const [statName, maxVal] of Object.entries(gameData.maxValues)) {
    if (maxVal <= 0) continue;
    const current = stats[statName] ?? 0;
    const quality = Math.min(1, current / maxVal);
    const weight = 1; // TODO: derive from DPS sensitivity analysis
    perStatContributions[statName] = quality;
    totalWeight += weight;
    weightedSum += quality * weight;
  }

  const totalRate = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0;

  return {
    graduationRate: Math.round(totalRate * 10) / 10,
    details: { totalRate, perSlotRates, perStatContributions },
  };
}

export function calculateDPS(
  stats: StatSheet,
  skillDatabase: Record<string, SkillEntry>,
  rotation: RotationEntry[],
  gameData: GameData,
): number {
  let totalDamage = 0;
  const outerAttack = stats["外功攻击"] ?? 0;
  const eleAttack = stats["属性攻击"] ?? 0;
  const critRate = stats["会心率"] ?? 0;
  const critDmg = stats["会心伤害"] ?? 1.5;
  const bossDefense = (gameData.seasonStats["BOSS防御"] as number) ?? 0;

  for (const entry of rotation) {
    const skill = skillDatabase[entry.skillId];
    if (!skill) continue;
    const count = entry.count ?? 1;

    const outerDmg = (skill.outerRatio ?? 0) * outerAttack;
    const eleDmg = (skill.eleRatio ?? 0) * eleAttack;
    const fixedDmg = skill.fixed ?? 0;
    const baseDmg = outerDmg + eleDmg + fixedDmg - bossDefense;
    const effectiveDmg = Math.max(0, baseDmg) * (1 + critRate * (critDmg - 1));

    totalDamage += effectiveDmg * count;
  }

  return Math.round(totalDamage);
}
```

**Step 2: Verify compiles**

Run: `pnpm --filter @guild/shared exec tsc --noEmit`
Expected: clean

**Step 3: Commit**

```bash
git add apps/shared/calculator/engine.ts
git commit -m "feat(shared): add calculator engine — stat aggregation, graduation rate, DPS"
```

---

### Task 5: Schema Version Migration

**Files:**
- Create: `apps/shared/calculator/migration.ts`

**Step 1: Implement migration registry**

```ts
// apps/shared/calculator/migration.ts
import type { Equipment, Loadout } from "./types";

type Migration = (pool: Equipment[], loadouts: Loadout[]) => void;

const migrations: Record<number, Migration> = {
  // Example migrations — add real ones when schemaVersion changes happen
  // 1: (pool, loadouts) => { ... },
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
```

**Step 2: Verify compiles**

Run: `pnpm --filter @guild/shared exec tsc --noEmit`
Expected: clean

**Step 3: Commit**

```bash
git add apps/shared/calculator/migration.ts
git commit -m "feat(shared): add localStorage schema version migration registry"
```

---

### Task 6: Best Build Worker Logic

**Files:**
- Create: `apps/shared/calculator/best-build.ts`

**Step 1: Implement combinatorial search**

```ts
// apps/shared/calculator/best-build.ts
import type { Equipment, Loadout, GameData, BuildResult, EquippedSlot } from "./types";
import { calculateTotal, calculateGraduationRate, calculateDPS } from "./engine";

const SLOT_TO_EQUIPPED: Record<string, EquippedSlot[]> = {
  "1": ["weapon1", "weapon2"],
  "3": ["ring"],
  "4": ["pendant"],
  "5": ["head"],
  "6": ["chest"],
  "7": ["legs"],
  "8": ["hands"],
};

const MAX_CANDIDATES_PER_SLOT = 100;

export interface BestBuildConfig {
  pool: Equipment[];
  loadout: Loadout;
  lockedSlots: Partial<Record<EquippedSlot, string>>;
  gameData: GameData;
  onProgress?: (percent: number) => void;
  signal?: { aborted: boolean };
}

export function findBestBuild(config: BestBuildConfig): BuildResult[] {
  const { pool, loadout, lockedSlots, gameData, onProgress, signal } = config;
  const classId = loadout.classId;
  const classConfig = gameData.classConfig[classId];
  if (!classConfig) return [];

  // Group pool by slot and filter by class
  const slotCandidates: Record<string, Equipment[]> = {};
  for (const equip of pool) {
    if (equip.availableClasses?.length && !equip.availableClasses.includes(classId)) continue;
    const slot = equip.slotId;
    if (!slotCandidates[slot]) slotCandidates[slot] = [];
    slotCandidates[slot].push(equip);
  }

  // Trim to MAX_CANDIDATES_PER_SLOT per slot (keep highest quality items)
  for (const slot of Object.keys(slotCandidates)) {
    if (slotCandidates[slot].length > MAX_CANDIDATES_PER_SLOT) {
      slotCandidates[slot] = slotCandidates[slot]
        .sort((a, b) => sumStatValues(b) - sumStatValues(a))
        .slice(0, MAX_CANDIDATES_PER_SLOT);
    }
  }

  // Build slot arrays for iteration
  const equippedSlots: EquippedSlot[] = ["weapon1", "weapon2", "head", "chest", "ring", "pendant", "legs", "hands"];
  const slotOptions: (Equipment | null)[][] = equippedSlots.map((slot) => {
    if (lockedSlots[slot]) {
      const locked = pool.find((e) => e.id === lockedSlots[slot]);
      return locked ? [locked] : [null];
    }
    const slotId = equippedSlotToSlotId(slot);
    return slotCandidates[slotId] ?? [null];
  });

  const topBuilds: BuildResult[] = [];
  const totalCombinations = slotOptions.reduce((a, b) => a * Math.max(1, b.length), 1);
  let checked = 0;
  let lastProgress = 0;

  // Brute-force with early termination
  const current: (Equipment | null)[] = new Array(equippedSlots.length).fill(null);

  function search(depth: number): void {
    if (signal?.aborted) return;
    if (depth === equippedSlots.length) {
      checked++;
      if (onProgress && totalCombinations > 0) {
        const pct = Math.floor((checked / totalCombinations) * 100);
        if (pct > lastProgress) { lastProgress = pct; onProgress(pct); }
      }

      // Check no duplicate equipment IDs
      const usedIds = new Set<string>();
      const items: Record<string, Equipment | undefined> = {};
      for (let i = 0; i < equippedSlots.length; i++) {
        const e = current[i];
        if (e) {
          if (usedIds.has(e.id)) return;
          usedIds.add(e.id);
        }
        items[equippedSlots[i]] = e ?? undefined;
      }

      const stats = calculateTotal(
        items, classId, loadout.bowType, loadout.xinfaSlots,
        loadout.setId, loadout.earlySeasonBonus, loadout.loanDingyin,
        loadout.armoryType, gameData,
      );
      const { graduationRate } = calculateGraduationRate(stats, classConfig.skillDatabase, classConfig.rotation, gameData);
      const dps = calculateDPS(stats, classConfig.skillDatabase, classConfig.rotation, gameData);

      const result: BuildResult = {
        equippedItems: {} as Record<EquippedSlot, string>,
        graduationRate,
        dps,
      };
      for (let i = 0; i < equippedSlots.length; i++) {
        if (current[i]) {
          (result.equippedItems as Record<string, string>)[equippedSlots[i]] = current[i]!.id;
        }
      }

      insertSorted(topBuilds, result, 3);
      return;
    }

    for (const option of slotOptions[depth]) {
      current[depth] = option;
      search(depth + 1);
      if (signal?.aborted) return;
    }
  }

  search(0);
  return topBuilds;
}

function insertSorted(arr: BuildResult[], item: BuildResult, maxSize: number): void {
  let i = arr.findIndex((b) => item.graduationRate > b.graduationRate);
  if (i === -1) i = arr.length;
  if (i >= maxSize) return;
  arr.splice(i, 0, item);
  if (arr.length > maxSize) arr.pop();
}

function sumStatValues(equip: Equipment): number {
  let sum = equip.mainStat.value;
  for (const sub of equip.subStats) sum += sub.value;
  sum += equip.dingyinStat.value;
  return sum;
}

function equippedSlotToSlotId(slot: EquippedSlot): string {
  switch (slot) {
    case "weapon1": case "weapon2": return "1";
    case "ring": return "3";
    case "pendant": return "4";
    case "head": return "5";
    case "chest": return "6";
    case "legs": return "7";
    case "hands": return "8";
  }
}
```

**Step 2: Verify compiles**

Run: `pnpm --filter @guild/shared exec tsc --noEmit`
Expected: clean

**Step 3: Commit**

```bash
git add apps/shared/calculator/best-build.ts
git commit -m "feat(shared): add best build combinatorial search algorithm"
```

---

## Phase 2: Backend — D1, API Routes, Seed

### Task 7: D1 Migration + Drizzle Schema

**Files:**
- Create: `apps/worker/db/migrations/0001_game_data.sql`
- Create: `apps/worker/db/schema/game-data.ts`
- Modify: `apps/worker/db/schema/index.ts`

**Step 1: Write SQL migration**

```sql
-- apps/worker/db/migrations/0001_game_data.sql
-- Equipment Calculator: game data version table

CREATE TABLE IF NOT EXISTS game_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  version TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_game_data_created_at ON game_data(created_at);
```

**Step 2: Write Drizzle schema**

```ts
// apps/worker/db/schema/game-data.ts
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { nowUtc } from "./shared";
import { users } from "./auth";

export const gameData = sqliteTable(
  "game_data",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    data: text("data").notNull(),
    version: text("version").notNull(),
    uploadedBy: integer("uploaded_by").notNull().references(() => users.id),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxCreatedAt: index("idx_game_data_created_at").on(table.createdAt),
  }),
);
```

**Step 3: Export from schema index**

Add to `apps/worker/db/schema/index.ts`:

```ts
export * from "./game-data";
```

**Step 4: Verify compiles**

Run: `pnpm --filter @guild/worker exec tsc --noEmit`
Expected: clean

**Step 5: Commit**

```bash
git add apps/worker/db/migrations/0001_game_data.sql apps/worker/db/schema/game-data.ts apps/worker/db/schema/index.ts
git commit -m "feat(worker): add game_data D1 table and Drizzle schema"
```

---

### Task 8: Game Data Service

**Files:**
- Create: `apps/worker/services/GameDataService.ts`

**Step 1: Implement service**

```ts
// apps/worker/services/GameDataService.ts
import { gameDataSchema } from "@guild/shared";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { gameData } from "../db/schema";
import { ok, err, type ServiceResult } from "./result";

type DrizzleDb = ReturnType<typeof drizzle>;

type Deps = {
  db: DrizzleDb;
  media: R2Bucket;
  writeAuditLog: (input: { entityType: string; action: string; entityId: string; diffTitle?: string; detailText?: string }) => Promise<void>;
};

const MAX_VERSIONS = 5;
const MAX_DATA_SIZE = 1_000_000; // 1 MB

export class GameDataService {
  constructor(private deps: Deps) {}

  async getLatest(): ServiceResult<{ data: unknown; version: string; schemaVersion: number }> {
    const row = await this.deps.db
      .select()
      .from(gameData)
      .orderBy(desc(gameData.createdAt))
      .limit(1)
      .then((rows) => rows[0]);

    if (!row) return err("NOT_FOUND", "Game data not initialized. An admin must upload the initial dataset.");

    const parsed = JSON.parse(row.data);
    return ok({ data: parsed, version: parsed.version, schemaVersion: parsed.schemaVersion });
  }

  async getVersions(): ServiceResult<Array<{ id: number; version: string; uploaded_by: number; created_at: string }>> {
    const rows = await this.deps.db
      .select({
        id: gameData.id,
        version: gameData.version,
        uploaded_by: gameData.uploadedBy,
        created_at: gameData.createdAt,
      })
      .from(gameData)
      .orderBy(desc(gameData.createdAt))
      .limit(MAX_VERSIONS);

    return ok(rows);
  }

  async upload(jsonString: string, uploadedBy: number): ServiceResult<{ version: string }> {
    if (jsonString.length > MAX_DATA_SIZE) {
      return err("VALIDATION_ERROR", `Game data exceeds maximum size of ${MAX_DATA_SIZE} bytes`);
    }

    let parsed: unknown;
    try { parsed = JSON.parse(jsonString); } catch {
      return err("VALIDATION_ERROR", "Invalid JSON");
    }

    const result = gameDataSchema.safeParse(parsed);
    if (!result.success) {
      return err("VALIDATION_ERROR", "Invalid game data schema", result.error.flatten());
    }

    const data = result.data;

    // Cross-validate references
    const crossErrors = crossValidate(data);
    if (crossErrors.length > 0) {
      return err("VALIDATION_ERROR", "Cross-validation failed", crossErrors);
    }

    await this.deps.db.insert(gameData).values({
      data: jsonString,
      version: data.version,
      uploadedBy,
    });

    // Prune old versions beyond MAX_VERSIONS
    await this.pruneOldVersions();

    await this.deps.writeAuditLog({
      entityType: "game_data",
      action: "upload",
      entityId: data.version,
      diffTitle: `Game data v${data.version}`,
      detailText: `Schema version: ${data.schemaVersion}`,
    });

    return ok({ version: data.version });
  }

  async rollback(versionId: number, actorId: number): ServiceResult<{ version: string }> {
    const row = await this.deps.db
      .select()
      .from(gameData)
      .where(eq(gameData.id, versionId))
      .then((rows) => rows[0]);

    if (!row) return err("NOT_FOUND", "Version not found");

    // Insert as a new latest entry (clone)
    await this.deps.db.insert(gameData).values({
      data: row.data,
      version: row.version,
      uploadedBy: actorId,
    });

    await this.pruneOldVersions();

    await this.deps.writeAuditLog({
      entityType: "game_data",
      action: "rollback",
      entityId: row.version,
      diffTitle: `Rolled back to v${row.version}`,
    });

    return ok({ version: row.version });
  }

  async uploadIcon(key: string, file: File): ServiceResult<{ key: string }> {
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    if (!allowed.includes(file.type)) {
      return err("VALIDATION_ERROR", `Unsupported icon type: ${file.type}`);
    }

    const r2Key = `game-data/icons/${key}`;
    await this.deps.media.put(r2Key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    await this.deps.writeAuditLog({
      entityType: "game_data",
      action: "icon_upload",
      entityId: key,
      diffTitle: `Icon uploaded: ${key}`,
    });

    return ok({ key: r2Key });
  }

  private async pruneOldVersions(): Promise<void> {
    const allVersions = await this.deps.db
      .select({ id: gameData.id })
      .from(gameData)
      .orderBy(desc(gameData.createdAt));

    if (allVersions.length > MAX_VERSIONS) {
      const idsToDelete = allVersions.slice(MAX_VERSIONS).map((r) => r.id);
      for (const id of idsToDelete) {
        await this.deps.db.delete(gameData).where(eq(gameData.id, id));
      }
    }
  }
}

function crossValidate(data: { slotRules: { mainStats: Record<string, string[]>; dingyinStats: Record<string, string[]> }; maxValues: Record<string, number>; classConfig: Record<string, { rotation: Array<{ skillId: string }>; skillDatabase: Record<string, unknown> }>; xinfaData: Record<string, unknown> }): string[] {
  const errors: string[] = [];
  const maxKeys = new Set(Object.keys(data.maxValues));

  // Check slotRules reference valid stat names
  for (const [slot, stats] of Object.entries(data.slotRules.mainStats)) {
    for (const stat of stats) {
      if (!maxKeys.has(stat)) errors.push(`slotRules.mainStats["${slot}"] references unknown stat "${stat}"`);
    }
  }
  for (const [slot, stats] of Object.entries(data.slotRules.dingyinStats)) {
    for (const stat of stats) {
      if (!maxKeys.has(stat)) errors.push(`slotRules.dingyinStats["${slot}"] references unknown stat "${stat}"`);
    }
  }

  // Check rotation skillIds exist in skillDatabase
  for (const [cls, cfg] of Object.entries(data.classConfig)) {
    for (const entry of cfg.rotation) {
      if (!cfg.skillDatabase[entry.skillId]) {
        errors.push(`classConfig["${cls}"].rotation references unknown skill "${entry.skillId}"`);
      }
    }
  }

  return errors;
}
```

**Step 2: Verify compiles**

Run: `pnpm --filter @guild/worker exec tsc --noEmit`
Expected: clean

**Step 3: Commit**

```bash
git add apps/worker/services/GameDataService.ts
git commit -m "feat(worker): add GameDataService with upload, rollback, icon management"
```

---

### Task 9: Game Data API Routes

**Files:**
- Create: `apps/worker/routes/game-data.ts`
- Modify: `apps/worker/index.ts`

**Step 1: Implement routes**

```ts
// apps/worker/routes/game-data.ts
import type { Context } from "hono";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../index";
import { requirePermission } from "../middleware/rbac";
import { writeAuditLog } from "../services/audit";
import { GameDataService } from "../services/GameDataService";
import { buildError, handleResult, safeFormData, collectFiles } from "./_shared";

export const gameDataRoutes = new Hono();

function getService(c: Context): GameDataService {
  const env = c.env as Bindings;
  return new GameDataService({
    db: drizzle(env.DB),
    media: env.MEDIA,
    writeAuditLog: (input) => writeAuditLog(c, input),
  });
}

async function requireGameDataManage(c: Context) {
  return requirePermission(c, "admin.gameData.manage");
}

// Public: get latest game data
gameDataRoutes.get("/", async (c) => {
  const result = await getService(c).getLatest();
  if (!result.ok && result.code === "NOT_FOUND") {
    return buildError(c, "NOT_FOUND", result.message);
  }
  return handleResult(c, result);
});

// Admin: list versions for rollback
gameDataRoutes.get("/versions", async (c) => {
  const sessionUser = await requireGameDataManage(c);
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getService(c).getVersions();
  return handleResult(c, result);
});

// Admin: upload new game data JSON
gameDataRoutes.post("/", async (c) => {
  const sessionUser = await requireGameDataManage(c);
  if (sessionUser instanceof Response) return sessionUser;

  let jsonString: string;
  try {
    jsonString = await c.req.text();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Could not read request body");
  }

  const userId = Number(sessionUser.id);
  const result = await getService(c).upload(jsonString, userId);
  return handleResult(c, result, 201);
});

// Admin: rollback to a previous version
gameDataRoutes.post("/rollback", async (c) => {
  const sessionUser = await requireGameDataManage(c);
  if (sessionUser instanceof Response) return sessionUser;

  let body: { version_id: number };
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  if (!body.version_id || typeof body.version_id !== "number") {
    return buildError(c, "VALIDATION_ERROR", "version_id is required and must be a number");
  }

  const result = await getService(c).rollback(body.version_id, Number(sessionUser.id));
  return handleResult(c, result);
});

// Admin: upload icon to R2
gameDataRoutes.post("/icons", async (c) => {
  const sessionUser = await requireGameDataManage(c);
  if (sessionUser instanceof Response) return sessionUser;

  const formData = await safeFormData(c);
  if (formData instanceof Response) return formData;

  const key = (formData as FormData).get("key");
  if (!key || typeof key !== "string") {
    return buildError(c, "VALIDATION_ERROR", "Icon key is required");
  }

  const files = collectFiles(formData as FormData);
  if (files.length === 0) {
    return buildError(c, "VALIDATION_ERROR", "No file provided");
  }

  const result = await getService(c).uploadIcon(key, files[0]);
  return handleResult(c, result, 201);
});
```

**Step 2: Mount routes in worker index**

In `apps/worker/index.ts`:
- Add import: `import { gameDataRoutes } from "./routes/game-data";`
- Add route: `app.route("/api/game-data", gameDataRoutes);` (before the admin route)
- Add `/api/game-data/icons` to `isUploadPath()`:
  ```ts
  if (path.includes("/game-data/") && path.endsWith("/icons")) return true;
  ```

**Step 3: Verify compiles**

Run: `pnpm --filter @guild/worker exec tsc --noEmit`
Expected: clean

**Step 4: Commit**

```bash
git add apps/worker/routes/game-data.ts apps/worker/index.ts
git commit -m "feat(worker): add game-data API routes — public read, admin upload/rollback/icons"
```

---

### Task 10: Seed Data + Bootstrap Script

**Files:**
- Create: `apps/shared/calculator/seed-data.json` (minimal valid placeholder)
- Create: `apps/worker/scripts/bootstrap-game-data.mjs`

**Step 1: Create minimal seed JSON**

Create `apps/shared/calculator/seed-data.json` with a minimal but valid GameData structure. This will be replaced with real data extracted from spongem.com/h9dh.cn later, but must pass schema validation now.

```json
{
  "version": "0.1.0-seed",
  "updatedAt": "2026-05-21T00:00:00Z",
  "schemaVersion": 1,
  "seasonStats": {
    "武库最小值": 0,
    "武库最大值": 0,
    "BOSS防御": 0
  },
  "maxValues": {},
  "xinfaData": {},
  "setData": {},
  "classConfig": {},
  "slots": [
    { "id": "1", "name": "武器", "nameEn": "Weapon" },
    { "id": "3", "name": "环", "nameEn": "Ring" },
    { "id": "4", "name": "佩", "nameEn": "Pendant" },
    { "id": "5", "name": "冠胄", "nameEn": "Helm" },
    { "id": "6", "name": "胸甲", "nameEn": "Chest" },
    { "id": "7", "name": "胫甲", "nameEn": "Legs" },
    { "id": "8", "name": "腕甲", "nameEn": "Hands" }
  ],
  "weaponTypes": [
    { "id": "1", "name": "剑", "nameEn": "Sword", "stat": "外功攻击" }
  ],
  "slotRules": {
    "mainStats": {},
    "dingyinStats": {}
  },
  "baseStats": {},
  "percentStats": [],
  "baseSubStats": []
}
```

**Step 2: Create bootstrap script**

```js
// apps/worker/scripts/bootstrap-game-data.mjs
// Idempotent script: inserts seed-data.json when game_data table is empty.
// Usage: called from dev seed endpoint or manual migration.

import seedData from "../../shared/calculator/seed-data.json" with { type: "json" };

export async function bootstrapGameData(db) {
  const existing = await db.prepare("SELECT COUNT(*) as cnt FROM game_data").first();
  if (existing?.cnt > 0) {
    console.log("[bootstrap-game-data] Skipped — game_data table already has data");
    return false;
  }

  const jsonString = JSON.stringify(seedData);
  await db.prepare(
    "INSERT INTO game_data (data, version, uploaded_by) VALUES (?1, ?2, ?3)"
  ).bind(jsonString, seedData.version, 0).run();

  console.log("[bootstrap-game-data] Inserted seed data version:", seedData.version);
  return true;
}
```

**Step 3: Commit**

```bash
git add apps/shared/calculator/seed-data.json apps/worker/scripts/bootstrap-game-data.mjs
git commit -m "feat: add seed game data JSON and bootstrap script"
```

---

### Task 11: Grant Permission to Admin Role

**Files:**
- Modify: `apps/worker/db/seed.ts` (or wherever default role permissions are seeded)

**Step 1: Find and update seed data**

Search for where role permissions are seeded (look for `admin.badges.manage` in the seed file). Add `admin.gameData.manage` to the admin role's default permission set.

**Step 2: Commit**

```bash
git add apps/worker/db/seed.ts
git commit -m "feat(worker): grant admin.gameData.manage to admin role in seed data"
```

---

## Phase 3: Frontend — Store, Data Fetching, i18n

### Task 12: Zustand Equipment Store

**Files:**
- Create: `apps/portal/stores/equipmentCalcStore.ts`

**Step 1: Implement store with localStorage persistence**

```ts
// apps/portal/stores/equipmentCalcStore.ts
import { create } from "zustand";
import { nanoid } from "nanoid";
import type { Equipment, Loadout, EquippedSlot } from "@guild/shared/calculator/types";
import { migrateLocalData } from "@guild/shared/calculator/migration";

const STORAGE_KEYS = {
  pool: "equipCalc.pool",
  loadouts: "equipCalc.loadouts",
  activeLoadout: "equipCalc.activeLoadout",
  schemaVersion: "equipCalc.schemaVersion",
} as const;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

type EquipmentCalcState = {
  pool: Equipment[];
  loadouts: Loadout[];
  activeLoadoutId: string | null;
  schemaVersion: number;

  // Actions
  addEquipment: (equip: Omit<Equipment, "id" | "createdAt">) => string;
  updateEquipment: (id: string, patch: Partial<Omit<Equipment, "id" | "createdAt">>) => void;
  removeEquipment: (id: string) => void;

  addLoadout: (name: string, classId: string) => string;
  updateLoadout: (id: string, patch: Partial<Omit<Loadout, "id">>) => void;
  removeLoadout: (id: string) => void;
  setActiveLoadout: (id: string) => void;

  equipItem: (equipmentId: string) => void;
  unequipSlot: (slot: EquippedSlot) => void;

  migrateSchema: (newVersion: number) => void;

  exportData: () => string;
  importData: (json: string) => boolean;
};

function createDefaultLoadout(name: string, classId: string): Loadout {
  return {
    id: nanoid(),
    name,
    classId,
    xinfaSlots: ["", "", "", ""],
    setId: "",
    bowType: "precision",
    armoryType: "通用",
    equippedItems: {},
    earlySeasonBonus: false,
    loanDingyin: false,
  };
}

export const useEquipmentCalcStore = create<EquipmentCalcState>((set, get) => ({
  pool: loadJson<Equipment[]>(STORAGE_KEYS.pool, []),
  loadouts: loadJson<Loadout[]>(STORAGE_KEYS.loadouts, []),
  activeLoadoutId: loadJson<string | null>(STORAGE_KEYS.activeLoadout, null),
  schemaVersion: loadJson<number>(STORAGE_KEYS.schemaVersion, 1),

  addEquipment: (equip) => {
    const id = nanoid();
    const newEquip: Equipment = { ...equip, id, createdAt: Date.now() };
    set((state) => {
      const pool = [...state.pool, newEquip];
      saveJson(STORAGE_KEYS.pool, pool);
      return { pool };
    });
    return id;
  },

  updateEquipment: (id, patch) => {
    set((state) => {
      const pool = state.pool.map((e) => (e.id === id ? { ...e, ...patch } : e));
      saveJson(STORAGE_KEYS.pool, pool);
      return { pool };
    });
  },

  removeEquipment: (id) => {
    set((state) => {
      const pool = state.pool.filter((e) => e.id !== id);
      // Also unequip from all loadouts
      const loadouts = state.loadouts.map((l) => {
        const items = { ...l.equippedItems };
        for (const [slot, eid] of Object.entries(items)) {
          if (eid === id) delete items[slot as EquippedSlot];
        }
        return { ...l, equippedItems: items };
      });
      saveJson(STORAGE_KEYS.pool, pool);
      saveJson(STORAGE_KEYS.loadouts, loadouts);
      return { pool, loadouts };
    });
  },

  addLoadout: (name, classId) => {
    const loadout = createDefaultLoadout(name, classId);
    set((state) => {
      const loadouts = [...state.loadouts, loadout];
      saveJson(STORAGE_KEYS.loadouts, loadouts);
      saveJson(STORAGE_KEYS.activeLoadout, loadout.id);
      return { loadouts, activeLoadoutId: loadout.id };
    });
    return loadout.id;
  },

  updateLoadout: (id, patch) => {
    set((state) => {
      const loadouts = state.loadouts.map((l) => (l.id === id ? { ...l, ...patch } : l));
      saveJson(STORAGE_KEYS.loadouts, loadouts);
      return { loadouts };
    });
  },

  removeLoadout: (id) => {
    set((state) => {
      const loadouts = state.loadouts.filter((l) => l.id !== id);
      const activeLoadoutId = state.activeLoadoutId === id ? (loadouts[0]?.id ?? null) : state.activeLoadoutId;
      saveJson(STORAGE_KEYS.loadouts, loadouts);
      saveJson(STORAGE_KEYS.activeLoadout, activeLoadoutId);
      return { loadouts, activeLoadoutId };
    });
  },

  setActiveLoadout: (id) => {
    saveJson(STORAGE_KEYS.activeLoadout, id);
    set({ activeLoadoutId: id });
  },

  equipItem: (equipmentId) => {
    set((state) => {
      const equip = state.pool.find((e) => e.id === equipmentId);
      if (!equip) return state;
      const loadout = state.loadouts.find((l) => l.id === state.activeLoadoutId);
      if (!loadout) return state;

      const items = { ...loadout.equippedItems };
      if (equip.slotId === "1") {
        // Weapon: W1 → W2 → replace W1
        if (!items.weapon1) items.weapon1 = equipmentId;
        else if (!items.weapon2) items.weapon2 = equipmentId;
        else items.weapon1 = equipmentId;
      } else {
        const slotMap: Record<string, EquippedSlot> = {
          "3": "ring", "4": "pendant", "5": "head", "6": "chest", "7": "legs", "8": "hands",
        };
        const slot = slotMap[equip.slotId];
        if (slot) items[slot] = equipmentId;
      }

      const loadouts = state.loadouts.map((l) =>
        l.id === loadout.id ? { ...l, equippedItems: items } : l,
      );
      saveJson(STORAGE_KEYS.loadouts, loadouts);
      return { loadouts };
    });
  },

  unequipSlot: (slot) => {
    set((state) => {
      const loadout = state.loadouts.find((l) => l.id === state.activeLoadoutId);
      if (!loadout) return state;
      const items = { ...loadout.equippedItems };
      delete items[slot];
      const loadouts = state.loadouts.map((l) =>
        l.id === loadout.id ? { ...l, equippedItems: items } : l,
      );
      saveJson(STORAGE_KEYS.loadouts, loadouts);
      return { loadouts };
    });
  },

  migrateSchema: (newVersion) => {
    const state = get();
    const pool = [...state.pool];
    const loadouts = [...state.loadouts];
    migrateLocalData(pool, loadouts, state.schemaVersion, newVersion);
    saveJson(STORAGE_KEYS.pool, pool);
    saveJson(STORAGE_KEYS.loadouts, loadouts);
    saveJson(STORAGE_KEYS.schemaVersion, newVersion);
    set({ pool, loadouts, schemaVersion: newVersion });
  },

  exportData: () => {
    const state = get();
    return JSON.stringify({
      pool: state.pool,
      loadouts: state.loadouts,
      schemaVersion: state.schemaVersion,
    });
  },

  importData: (json) => {
    try {
      const data = JSON.parse(json);
      if (!Array.isArray(data.pool) || !Array.isArray(data.loadouts)) return false;
      saveJson(STORAGE_KEYS.pool, data.pool);
      saveJson(STORAGE_KEYS.loadouts, data.loadouts);
      if (data.schemaVersion) saveJson(STORAGE_KEYS.schemaVersion, data.schemaVersion);
      set({
        pool: data.pool,
        loadouts: data.loadouts,
        schemaVersion: data.schemaVersion ?? 1,
      });
      return true;
    } catch {
      return false;
    }
  },
}));
```

**Step 2: Verify compiles**

Run: `pnpm --filter @guild/portal exec tsc --noEmit`
Expected: clean

**Step 3: Commit**

```bash
git add apps/portal/stores/equipmentCalcStore.ts
git commit -m "feat(portal): add Zustand equipment calculator store with localStorage persistence"
```

---

### Task 13: Game Data API Client + Query Hook

**Files:**
- Create: `apps/portal/api/queries/game-data.ts`
- Create: `apps/portal/api/mutations/game-data.ts`
- Modify: `apps/portal/api/query-keys.ts`

**Step 1: Add query keys**

In `apps/portal/api/query-keys.ts`, add to the `queryKeys` object:

```ts
gameData: {
  all: ["game-data"] as const,
  latest: () => [...queryKeys.gameData.all, "latest"] as const,
  versions: () => [...queryKeys.gameData.all, "versions"] as const,
},
```

**Step 2: Create query functions**

```ts
// apps/portal/api/queries/game-data.ts
import type { GameData, GameDataVersion } from "@guild/shared/calculator/types";
import { apiRequest } from "../client";

export function fetchGameData(): Promise<{ data: GameData; version: string; schemaVersion: number }> {
  return apiRequest("/api/game-data");
}

export function fetchGameDataVersions(): Promise<GameDataVersion[]> {
  return apiRequest("/api/game-data/versions");
}
```

**Step 3: Create mutation functions**

```ts
// apps/portal/api/mutations/game-data.ts
import { apiRequest } from "../client";

export function uploadGameData(jsonString: string): Promise<{ version: string }> {
  return apiRequest("/api/game-data", {
    method: "POST",
    body: jsonString,
    headers: { "Content-Type": "application/json" },
  });
}

export function rollbackGameData(versionId: number): Promise<{ version: string }> {
  return apiRequest("/api/game-data/rollback", {
    method: "POST",
    bodyJson: { version_id: versionId },
  });
}

export function uploadGameDataIcon(key: string, file: File): Promise<{ key: string }> {
  const formData = new FormData();
  formData.append("key", key);
  formData.append("file", file);
  return apiRequest("/api/game-data/icons", {
    method: "POST",
    body: formData,
  });
}
```

**Step 4: Verify compiles**

Run: `pnpm --filter @guild/portal exec tsc --noEmit`
Expected: clean

**Step 5: Commit**

```bash
git add apps/portal/api/queries/game-data.ts apps/portal/api/mutations/game-data.ts apps/portal/api/query-keys.ts
git commit -m "feat(portal): add game-data API queries, mutations, and query keys"
```

---

### Task 14: i18n Namespaces

**Files:**
- Create: `apps/portal/i18n/en/equipCalc.json`
- Create: `apps/portal/i18n/zh/equipCalc.json`

**Step 1: Create English translations**

```json
{
  "title": "Equipment Calculator",
  "description": "Plan and optimize your gear builds",
  "pool": {
    "title": "Equipment Pool",
    "addEquipment": "Add Equipment",
    "empty": "No equipment yet. Add your first piece!",
    "filter": {
      "available": "Available",
      "all": "All",
      "equipped": "Equipped"
    },
    "equipped": "Equipped",
    "chengyin": "Chengyin",
    "purple": "Purple"
  },
  "loadout": {
    "title": "Loadout",
    "newLoadout": "New Loadout",
    "rename": "Rename",
    "delete": "Delete Loadout",
    "class": "Class",
    "armory": "Armory",
    "xinfa": "Inner Arts",
    "bowType": "Bow Type",
    "set": "Set",
    "earlySeasonBonus": "Early Season Bonus",
    "loanDingyin": "Loan Dingyin",
    "selectXinfa": "Select Inner Art",
    "emptySlot": "Empty",
    "unequip": "Unequip"
  },
  "stats": {
    "graduationRate": "Graduation Rate",
    "expectedDps": "Expected DPS",
    "breakdown": "Stats Breakdown",
    "quality": {
      "low": "Low",
      "medium": "Medium",
      "high": "High"
    }
  },
  "form": {
    "title": "Equipment Details",
    "editTitle": "Edit Equipment",
    "slot": "Slot",
    "weaponType": "Weapon Type",
    "name": "Name",
    "mainStat": "Main Stat",
    "subStats": "Sub Stats",
    "dingyin": "Dingyin Stat",
    "classRestriction": "Class Restriction",
    "allClasses": "All Classes",
    "save": "Save",
    "cancel": "Cancel",
    "maxBtn": "Max",
    "value": "Value",
    "statType": "Stat Type"
  },
  "tabs": {
    "comparison": "Comparison",
    "priority": "Stat Priority",
    "cultivation": "Cultivation",
    "transmutation": "Transmutation",
    "bestBuild": "Best Build",
    "manualEntry": "Manual Entry"
  },
  "comparison": {
    "selectSlot": "Select a slot to compare equipment",
    "rateDelta": "Rate Change",
    "freezeDingyin": "Freeze current dingyin",
    "assumeMaxChengyin": "Assume max chengyin"
  },
  "priority": {
    "addMaxRoll": "Adding one max roll",
    "loseMaxRoll": "Losing one max roll",
    "gives": "gives",
    "costs": "costs"
  },
  "cultivation": {
    "upgradeNext": "Upgrade next for biggest improvement",
    "currentRate": "Current",
    "potentialRate": "Potential"
  },
  "transmutation": {
    "selectEquipment": "Select an equipment piece",
    "rerollStat": "Reroll",
    "targetStat": "Target",
    "expectedImprovement": "Expected Improvement"
  },
  "bestBuild": {
    "find": "Find Best Build",
    "cancel": "Cancel",
    "searching": "Searching...",
    "progress": "Progress",
    "lockSlot": "Lock slot",
    "topBuilds": "Top Builds",
    "apply": "Apply Build",
    "noResults": "No valid builds found"
  },
  "manualEntry": {
    "title": "Manual Stat Entry",
    "description": "Enter your in-game panel stats directly for a quick graduation check",
    "calculate": "Calculate"
  },
  "actions": {
    "export": "Export",
    "import": "Import",
    "help": "Help",
    "importSuccess": "Data imported successfully",
    "importError": "Invalid import data",
    "exportSuccess": "Data copied to clipboard"
  },
  "bowTypes": {
    "precision": "Precision",
    "crit": "Critical",
    "intent": "Intent"
  },
  "armoryTypes": {
    "通用": "General",
    "鸣金": "Mingjin",
    "裂石": "Lieshi",
    "牵丝": "Qiansi",
    "破竹": "Pozhu"
  }
}
```

**Step 2: Create Chinese translations**

```json
{
  "title": "装备计算器",
  "description": "规划和优化你的装备搭配",
  "pool": {
    "title": "装备池",
    "addEquipment": "添加装备",
    "empty": "暂无装备，添加你的第一件装备吧！",
    "filter": {
      "available": "可用",
      "all": "全部",
      "equipped": "已穿着"
    },
    "equipped": "已穿着",
    "chengyin": "承音",
    "purple": "紫装"
  },
  "loadout": {
    "title": "配装方案",
    "newLoadout": "新建方案",
    "rename": "重命名",
    "delete": "删除方案",
    "class": "门派",
    "armory": "武库",
    "xinfa": "心法",
    "bowType": "弓类型",
    "set": "套装",
    "earlySeasonBonus": "上半赛季加成",
    "loanDingyin": "借用定音",
    "selectXinfa": "选择心法",
    "emptySlot": "空",
    "unequip": "卸下"
  },
  "stats": {
    "graduationRate": "毕业率",
    "expectedDps": "预期DPS",
    "breakdown": "属性详情",
    "quality": {
      "low": "低",
      "medium": "中",
      "high": "高"
    }
  },
  "form": {
    "title": "装备详情",
    "editTitle": "编辑装备",
    "slot": "部位",
    "weaponType": "武器类型",
    "name": "名称",
    "mainStat": "主属性",
    "subStats": "副属性",
    "dingyin": "定音属性",
    "classRestriction": "门派限制",
    "allClasses": "全门派",
    "save": "保存",
    "cancel": "取消",
    "maxBtn": "拉满",
    "value": "数值",
    "statType": "属性类型"
  },
  "tabs": {
    "comparison": "装备对比",
    "priority": "属性优先级",
    "cultivation": "培养建议",
    "transmutation": "炼化建议",
    "bestBuild": "最佳配装",
    "manualEntry": "手动录入"
  },
  "comparison": {
    "selectSlot": "选择一个部位来对比装备",
    "rateDelta": "毕业率变化",
    "freezeDingyin": "锁定当前定音",
    "assumeMaxChengyin": "假设满承音"
  },
  "priority": {
    "addMaxRoll": "增加一条满属性",
    "loseMaxRoll": "失去一条满属性",
    "gives": "提升",
    "costs": "损失"
  },
  "cultivation": {
    "upgradeNext": "优先提升以获得最大收益",
    "currentRate": "当前",
    "potentialRate": "潜力"
  },
  "transmutation": {
    "selectEquipment": "选择一件装备",
    "rerollStat": "重置属性",
    "targetStat": "目标属性",
    "expectedImprovement": "预期提升"
  },
  "bestBuild": {
    "find": "寻找最佳配装",
    "cancel": "取消",
    "searching": "搜索中...",
    "progress": "进度",
    "lockSlot": "锁定部位",
    "topBuilds": "最佳方案",
    "apply": "应用配装",
    "noResults": "未找到有效配装"
  },
  "manualEntry": {
    "title": "手动录入属性",
    "description": "直接输入游戏面板属性，快速查看毕业率",
    "calculate": "计算"
  },
  "actions": {
    "export": "导出",
    "import": "导入",
    "help": "帮助",
    "importSuccess": "数据导入成功",
    "importError": "导入数据无效",
    "exportSuccess": "数据已复制到剪贴板"
  },
  "bowTypes": {
    "precision": "精准弓",
    "crit": "会心弓",
    "intent": "会意弓"
  },
  "armoryTypes": {
    "通用": "通用",
    "鸣金": "鸣金",
    "裂石": "裂石",
    "牵丝": "牵丝",
    "破竹": "破竹"
  }
}
```

**Step 3: Commit**

```bash
git add apps/portal/i18n/en/equipCalc.json apps/portal/i18n/zh/equipCalc.json
git commit -m "feat(portal): add equipment calculator i18n translations EN + ZH"
```

---

## Phase 4: Frontend — Core UI Components

### Task 15: Equipment Calculator Modal Shell

**Files:**
- Create: `apps/portal/components/equipment-calc/EquipmentCalcModal.tsx`
- Create: `apps/portal/components/equipment-calc/EquipmentCalcModal.css`

**Step 1: Implement modal shell**

The modal is a near-fullscreen overlay launched from the Tools page. It contains the two-column layout (equipment pool left, loadout panel right) with analysis tabs below.

Structure:
- Uses Mantine `Modal` with `fullScreen` or `size="95vw"` + near-full height
- Two-panel grid layout
- Analysis tabs at the bottom
- Top bar with title, export/import, help buttons
- Fetches game data on mount via TanStack Query
- Runs schema migration if version differs

This is a large component. Implement the shell with placeholder panels first, then fill in each panel in subsequent tasks.

```tsx
// apps/portal/components/equipment-calc/EquipmentCalcModal.tsx
import { Modal, Group, Button, Text, Loader, Alert } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../../api/query-keys";
import { fetchGameData } from "../../api/queries/game-data";
import { useEquipmentCalcStore } from "../../stores/equipmentCalcStore";
import { ErrorBoundary } from "../effects";
import "./EquipmentCalcModal.css";

// Lazy-load heavy sub-panels
const EquipmentPool = lazy(() => import("./EquipmentPool").then((m) => ({ default: m.EquipmentPool })));
const LoadoutPanel = lazy(() => import("./LoadoutPanel").then((m) => ({ default: m.LoadoutPanel })));
const AnalysisTabs = lazy(() => import("./AnalysisTabs").then((m) => ({ default: m.AnalysisTabs })));

type Props = { opened: boolean; onClose: () => void };

export function EquipmentCalcModal({ opened, onClose }: Props) {
  const { t } = useTranslation("equipCalc");

  const gameDataQuery = useQuery({
    queryKey: queryKeys.gameData.latest(),
    queryFn: fetchGameData,
    enabled: opened,
    staleTime: 5 * 60 * 1000,
  });

  const migrateSchema = useEquipmentCalcStore((s) => s.migrateSchema);
  const schemaVersion = useEquipmentCalcStore((s) => s.schemaVersion);
  const exportData = useEquipmentCalcStore((s) => s.exportData);
  const importData = useEquipmentCalcStore((s) => s.importData);

  // Migrate localStorage if server schemaVersion is higher
  const serverSchema = gameDataQuery.data?.schemaVersion;
  if (serverSchema && serverSchema > schemaVersion) {
    migrateSchema(serverSchema);
  }

  const gameData = gameDataQuery.data?.data ?? null;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen
      title={
        <Group gap={8}>
          <Text fw={700} size="lg">{t("title")}</Text>
        </Group>
      }
      classNames={{ body: "equip-calc__body" }}
    >
      {gameDataQuery.isLoading && <Loader />}
      {gameDataQuery.isError && (
        <Alert color="red">{gameDataQuery.error?.message}</Alert>
      )}
      {gameData && (
        <>
          <Group justify="flex-end" mb="sm">
            <Button variant="subtle" size="xs" onClick={() => {
              const data = exportData();
              navigator.clipboard.writeText(data);
            }}>{t("actions.export")}</Button>
            <Button variant="subtle" size="xs" onClick={() => {
              const input = prompt("Paste JSON:");
              if (input) importData(input);
            }}>{t("actions.import")}</Button>
          </Group>

          <div className="equip-calc__workspace">
            <ErrorBoundary>
              <Suspense fallback={<Loader />}>
                <EquipmentPool gameData={gameData} />
              </Suspense>
            </ErrorBoundary>
            <ErrorBoundary>
              <Suspense fallback={<Loader />}>
                <LoadoutPanel gameData={gameData} />
              </Suspense>
            </ErrorBoundary>
          </div>

          <ErrorBoundary>
            <Suspense fallback={<Loader />}>
              <AnalysisTabs gameData={gameData} />
            </Suspense>
          </ErrorBoundary>
        </>
      )}
    </Modal>
  );
}
```

**Step 2: Create CSS**

```css
/* apps/portal/components/equipment-calc/EquipmentCalcModal.css */
.equip-calc__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  overflow-y: auto;
}

.equip-calc__workspace {
  display: grid;
  grid-template-columns: minmax(300px, 0.9fr) minmax(360px, 1.1fr);
  gap: 16px;
  align-items: start;
}

@media (max-width: 768px) {
  .equip-calc__workspace {
    grid-template-columns: 1fr;
  }
}
```

**Step 3: Commit**

```bash
git add apps/portal/components/equipment-calc/EquipmentCalcModal.tsx apps/portal/components/equipment-calc/EquipmentCalcModal.css
git commit -m "feat(portal): add EquipmentCalcModal shell with game data fetching"
```

---

### Task 16: Equipment Card Component

**Files:**
- Create: `apps/portal/components/equipment-calc/EquipmentCard.tsx`

**Step 1: Implement card**

Displays one equipment piece with main stat, sub-stats (color-coded quality), badges. Clickable to equip.

```tsx
// apps/portal/components/equipment-calc/EquipmentCard.tsx
import { Badge, Card, Group, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { Equipment, GameData } from "@guild/shared/calculator/types";
import { getStatQuality } from "@guild/shared/calculator/engine";

type Props = {
  equipment: Equipment;
  gameData: GameData;
  isEquipped?: boolean;
  onClick?: () => void;
};

function qualityColor(pct: number): string {
  if (pct >= 80) return "green";
  if (pct >= 50) return "yellow";
  return "red";
}

export function EquipmentCard({ equipment, gameData, isEquipped, onClick }: Props) {
  const { t } = useTranslation("equipCalc");

  return (
    <Card
      withBorder
      shadow="xs"
      p="xs"
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      <Stack gap={4}>
        <Group justify="space-between">
          <Text fw={600} size="sm" truncate>{equipment.name}</Text>
          <Group gap={4}>
            {equipment.isChengyin && <Badge size="xs" color="violet">{t("pool.chengyin")}</Badge>}
            {equipment.isPurple && <Badge size="xs" color="grape">{t("pool.purple")}</Badge>}
            {isEquipped && <Badge size="xs" color="blue">{t("pool.equipped")}</Badge>}
          </Group>
        </Group>

        <Group gap={4}>
          <Text size="xs" c="dimmed">{equipment.mainStat.type}:</Text>
          <Text size="xs" fw={500}>{equipment.mainStat.value}</Text>
        </Group>

        {equipment.subStats.map((sub, i) => {
          const quality = getStatQuality(sub.type, sub.value, gameData);
          return (
            <Group key={i} gap={4}>
              <Text size="xs" c="dimmed">{sub.type}:</Text>
              <Text size="xs">{sub.value}</Text>
              <Badge size="xs" variant="light" color={qualityColor(quality)}>
                {quality.toFixed(0)}%
              </Badge>
            </Group>
          );
        })}

        <Group gap={4}>
          <Text size="xs" c="dimmed">{equipment.dingyinStat.type}:</Text>
          <Text size="xs">{equipment.dingyinStat.value}</Text>
        </Group>
      </Stack>
    </Card>
  );
}
```

**Step 2: Commit**

```bash
git add apps/portal/components/equipment-calc/EquipmentCard.tsx
git commit -m "feat(portal): add EquipmentCard component with quality indicators"
```

---

### Task 17: Equipment Pool Panel

**Files:**
- Create: `apps/portal/components/equipment-calc/EquipmentPool.tsx`

**Step 1: Implement pool panel**

Left panel with filter tabs, add button, and equipment cards grid.

```tsx
// apps/portal/components/equipment-calc/EquipmentPool.tsx
import { Button, Group, SegmentedControl, SimpleGrid, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameData } from "@guild/shared/calculator/types";
import { useEquipmentCalcStore } from "../../stores/equipmentCalcStore";
import { EquipmentCard } from "./EquipmentCard";
import { EquipmentForm } from "./EquipmentForm";

type Props = { gameData: GameData };

export function EquipmentPool({ gameData }: Props) {
  const { t } = useTranslation("equipCalc");
  const pool = useEquipmentCalcStore((s) => s.pool);
  const loadouts = useEquipmentCalcStore((s) => s.loadouts);
  const activeLoadoutId = useEquipmentCalcStore((s) => s.activeLoadoutId);
  const equipItem = useEquipmentCalcStore((s) => s.equipItem);
  const [formOpened, formHandlers] = useDisclosure(false);

  const activeLoadout = loadouts.find((l) => l.id === activeLoadoutId);
  const equippedIds = new Set(Object.values(activeLoadout?.equippedItems ?? {}));

  const [filter, setFilter] = useState("all");
  const [slotFilter, setSlotFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let items = pool;
    if (filter === "equipped") items = items.filter((e) => equippedIds.has(e.id));
    if (filter === "available") items = items.filter((e) => !equippedIds.has(e.id));
    if (slotFilter) items = items.filter((e) => e.slotId === slotFilter);
    // Filter by class if loadout has class selected
    if (activeLoadout?.classId) {
      items = items.filter((e) =>
        !e.availableClasses?.length || e.availableClasses.includes(activeLoadout.classId),
      );
    }
    return items;
  }, [pool, filter, slotFilter, equippedIds, activeLoadout?.classId]);

  const slotOptions = gameData.slots.map((s) => ({
    label: s.name,
    value: s.id,
  }));

  return (
    <Stack gap="sm" className="equip-calc__pool">
      <Group justify="space-between">
        <Text fw={600}>{t("pool.title")}</Text>
        <Button size="xs" onClick={formHandlers.open}>{t("pool.addEquipment")}</Button>
      </Group>

      <SegmentedControl
        size="xs"
        value={filter}
        onChange={setFilter}
        data={[
          { label: t("pool.filter.all"), value: "all" },
          { label: t("pool.filter.available"), value: "available" },
          { label: t("pool.filter.equipped"), value: "equipped" },
        ]}
      />

      <Group gap={4}>
        <Button
          size="xs"
          variant={slotFilter === null ? "filled" : "light"}
          onClick={() => setSlotFilter(null)}
        >
          {t("pool.filter.all")}
        </Button>
        {slotOptions.map((s) => (
          <Button
            key={s.value}
            size="xs"
            variant={slotFilter === s.value ? "filled" : "light"}
            onClick={() => setSlotFilter(s.value === slotFilter ? null : s.value)}
          >
            {s.label}
          </Button>
        ))}
      </Group>

      {filtered.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">{t("pool.empty")}</Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          {filtered.map((equip) => (
            <EquipmentCard
              key={equip.id}
              equipment={equip}
              gameData={gameData}
              isEquipped={equippedIds.has(equip.id)}
              onClick={() => equipItem(equip.id)}
            />
          ))}
        </SimpleGrid>
      )}

      <EquipmentForm opened={formOpened} onClose={formHandlers.close} gameData={gameData} />
    </Stack>
  );
}
```

**Step 2: Commit**

```bash
git add apps/portal/components/equipment-calc/EquipmentPool.tsx
git commit -m "feat(portal): add EquipmentPool panel with filtering and equip-on-click"
```

---

### Task 18: Equipment Entry Form

**Files:**
- Create: `apps/portal/components/equipment-calc/EquipmentForm.tsx`

**Step 1: Implement form modal**

Modal form for adding/editing equipment. Slot selector, weapon type (conditional), name, checkboxes, main stat, 4 sub-stats, dingyin stat. Each stat has type dropdown + value input + quality indicator.

```tsx
// apps/portal/components/equipment-calc/EquipmentForm.tsx
import {
  Button,
  Checkbox,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Badge,
} from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Equipment, GameData } from "@guild/shared/calculator/types";
import { getStatQuality } from "@guild/shared/calculator/engine";
import { useEquipmentCalcStore } from "../../stores/equipmentCalcStore";

type Props = {
  opened: boolean;
  onClose: () => void;
  gameData: GameData;
  editEquipment?: Equipment;
};

function qualityColor(pct: number): string {
  if (pct >= 80) return "green";
  if (pct >= 50) return "yellow";
  return "red";
}

export function EquipmentForm({ opened, onClose, gameData, editEquipment }: Props) {
  const { t } = useTranslation("equipCalc");
  const addEquipment = useEquipmentCalcStore((s) => s.addEquipment);
  const updateEquipment = useEquipmentCalcStore((s) => s.updateEquipment);

  const [slotId, setSlotId] = useState(editEquipment?.slotId ?? "");
  const [weaponTypeId, setWeaponTypeId] = useState(editEquipment?.weaponTypeId ?? "");
  const [name, setName] = useState(editEquipment?.name ?? "");
  const [isChengyin, setIsChengyin] = useState(editEquipment?.isChengyin ?? false);
  const [isPurple, setIsPurple] = useState(editEquipment?.isPurple ?? false);
  const [mainStatType, setMainStatType] = useState(editEquipment?.mainStat.type ?? "");
  const [mainStatValue, setMainStatValue] = useState<number>(editEquipment?.mainStat.value ?? 0);
  const [subStats, setSubStats] = useState(
    editEquipment?.subStats.length
      ? editEquipment.subStats.map((s) => ({ type: s.type, value: s.value }))
      : [{ type: "", value: 0 }, { type: "", value: 0 }, { type: "", value: 0 }, { type: "", value: 0 }],
  );
  const [dingyinType, setDingyinType] = useState(editEquipment?.dingyinStat.type ?? "");
  const [dingyinValue, setDingyinValue] = useState<number>(editEquipment?.dingyinStat.value ?? 0);
  const [availableClasses, setAvailableClasses] = useState<string[]>(editEquipment?.availableClasses ?? []);

  const slotOptions = gameData.slots.map((s) => ({ label: s.name, value: s.id }));
  const weaponOptions = gameData.weaponTypes.map((w) => ({ label: w.name, value: w.id }));
  const mainStatOptions = (gameData.slotRules.mainStats[slotId] ?? []).map((s) => ({ label: s, value: s }));
  const dingyinOptions = (gameData.slotRules.dingyinStats[slotId] ?? []).map((s) => ({ label: s, value: s }));
  const subStatOptions = gameData.baseSubStats.map((s) => ({ label: s, value: s }));
  const classOptions = Object.keys(gameData.classConfig).map((c) => ({ label: c, value: c }));

  function handleSave() {
    const filteredSubs = subStats.filter((s) => s.type && s.value > 0);
    const data = {
      name: name || `${slotId}-${Date.now()}`,
      slotId,
      weaponTypeId: slotId === "1" ? weaponTypeId : undefined,
      isChengyin,
      isPurple,
      mainStat: { type: mainStatType, value: mainStatValue },
      subStats: filteredSubs,
      dingyinStat: { type: dingyinType, value: dingyinValue },
      availableClasses: availableClasses.length > 0 ? availableClasses : undefined,
    };

    if (editEquipment) {
      updateEquipment(editEquipment.id, data);
    } else {
      addEquipment(data);
    }
    onClose();
  }

  function setMaxValue(statType: string, setter: (v: number) => void) {
    const max = gameData.maxValues[statType];
    if (max) setter(max);
  }

  return (
    <Modal opened={opened} onClose={onClose} title={editEquipment ? t("form.editTitle") : t("form.title")} size="lg">
      <Stack gap="sm">
        <Select label={t("form.slot")} data={slotOptions} value={slotId} onChange={(v) => setSlotId(v ?? "")} />

        {slotId === "1" && (
          <Select label={t("form.weaponType")} data={weaponOptions} value={weaponTypeId} onChange={(v) => setWeaponTypeId(v ?? "")} />
        )}

        <TextInput label={t("form.name")} value={name} onChange={(e) => setName(e.currentTarget.value)} />

        <Group>
          <Checkbox label={t("pool.chengyin")} checked={isChengyin} onChange={(e) => setIsChengyin(e.currentTarget.checked)} />
          <Checkbox label={t("pool.purple")} checked={isPurple} onChange={(e) => setIsPurple(e.currentTarget.checked)} />
        </Group>

        <MultiSelect
          label={t("form.classRestriction")}
          data={classOptions}
          value={availableClasses}
          onChange={setAvailableClasses}
          placeholder={t("form.allClasses")}
        />

        {/* Main Stat */}
        <Group align="end" gap="xs">
          <Select label={t("form.mainStat")} data={mainStatOptions} value={mainStatType} onChange={(v) => setMainStatType(v ?? "")} style={{ flex: 1 }} />
          <NumberInput label={t("form.value")} value={mainStatValue} onChange={(v) => setMainStatValue(Number(v))} min={0} style={{ flex: 1 }} />
          <Button size="xs" variant="light" onClick={() => setMaxValue(mainStatType, setMainStatValue)}>{t("form.maxBtn")}</Button>
          {mainStatType && <Badge color={qualityColor(getStatQuality(mainStatType, mainStatValue, gameData))}>{getStatQuality(mainStatType, mainStatValue, gameData).toFixed(0)}%</Badge>}
        </Group>

        {/* Sub Stats */}
        <Text size="sm" fw={500}>{t("form.subStats")}</Text>
        {subStats.map((sub, i) => (
          <Group key={i} gap="xs" align="end">
            <Select
              data={subStatOptions}
              value={sub.type}
              onChange={(v) => {
                const next = [...subStats];
                next[i] = { ...next[i], type: v ?? "" };
                setSubStats(next);
              }}
              style={{ flex: 1 }}
              placeholder={t("form.statType")}
            />
            <NumberInput
              value={sub.value}
              onChange={(v) => {
                const next = [...subStats];
                next[i] = { ...next[i], value: Number(v) };
                setSubStats(next);
              }}
              min={0}
              style={{ flex: 1 }}
            />
            <Button size="xs" variant="light" onClick={() => {
              const next = [...subStats];
              const max = gameData.maxValues[next[i].type];
              if (max) next[i] = { ...next[i], value: max };
              setSubStats(next);
            }}>{t("form.maxBtn")}</Button>
            {sub.type && <Badge size="xs" color={qualityColor(getStatQuality(sub.type, sub.value, gameData))}>{getStatQuality(sub.type, sub.value, gameData).toFixed(0)}%</Badge>}
          </Group>
        ))}

        {/* Dingyin Stat */}
        <Group align="end" gap="xs">
          <Select label={t("form.dingyin")} data={dingyinOptions} value={dingyinType} onChange={(v) => setDingyinType(v ?? "")} style={{ flex: 1 }} />
          <NumberInput label={t("form.value")} value={dingyinValue} onChange={(v) => setDingyinValue(Number(v))} min={0} style={{ flex: 1 }} />
          <Button size="xs" variant="light" onClick={() => setMaxValue(dingyinType, setDingyinValue)}>{t("form.maxBtn")}</Button>
        </Group>

        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>{t("form.cancel")}</Button>
          <Button onClick={handleSave} disabled={!slotId}>{t("form.save")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
```

**Step 2: Commit**

```bash
git add apps/portal/components/equipment-calc/EquipmentForm.tsx
git commit -m "feat(portal): add EquipmentForm modal with stat entry and quality indicators"
```

---

### Task 19: Stats Display + Graduation Banner

**Files:**
- Create: `apps/portal/components/equipment-calc/StatsDisplay.tsx`
- Create: `apps/portal/components/equipment-calc/GraduationBanner.tsx`

**Step 1: Implement StatsDisplay**

Renders a stat breakdown table from a StatSheet.

```tsx
// apps/portal/components/equipment-calc/StatsDisplay.tsx
import { Stack, Group, Text, Progress } from "@mantine/core";
import type { StatSheet, GameData } from "@guild/shared/calculator/types";
import { useTranslation } from "react-i18next";

type Props = { stats: StatSheet; gameData: GameData };

export function StatsDisplay({ stats, gameData }: Props) {
  const { t } = useTranslation("equipCalc");
  const isPercent = new Set(gameData.percentStats);

  return (
    <Stack gap={6}>
      <Text size="sm" fw={600}>{t("stats.breakdown")}</Text>
      {Object.entries(stats)
        .filter(([, val]) => val !== 0)
        .map(([name, value]) => {
          const max = gameData.maxValues[name];
          const pct = max ? Math.min(100, (value / max) * 100) : 0;
          return (
            <Group key={name} gap="xs" wrap="nowrap">
              <Text size="xs" c="dimmed" style={{ minWidth: 80 }}>{name}</Text>
              <Text size="xs" fw={500} style={{ minWidth: 60, textAlign: "right" }}>
                {isPercent.has(name) ? `${(value * 100).toFixed(1)}%` : value.toLocaleString()}
              </Text>
              {max ? <Progress value={pct} size="xs" style={{ flex: 1 }} color={pct >= 80 ? "green" : pct >= 50 ? "yellow" : "red"} /> : null}
            </Group>
          );
        })}
    </Stack>
  );
}
```

**Step 2: Implement GraduationBanner**

```tsx
// apps/portal/components/equipment-calc/GraduationBanner.tsx
import { Card, Group, Text, RingProgress } from "@mantine/core";
import { useTranslation } from "react-i18next";

type Props = {
  graduationRate: number;
  expectedDps: number;
};

export function GraduationBanner({ graduationRate, expectedDps }: Props) {
  const { t } = useTranslation("equipCalc");

  const color = graduationRate >= 80 ? "green" : graduationRate >= 50 ? "yellow" : "red";

  return (
    <Card withBorder p="md" radius="md">
      <Group justify="space-between" align="center">
        <div>
          <Text size="xs" c="dimmed" tt="uppercase">{t("stats.graduationRate")}</Text>
          <Text size="xl" fw={700} c={color}>{graduationRate.toFixed(1)}%</Text>
        </div>
        <RingProgress
          size={64}
          thickness={6}
          roundCaps
          sections={[{ value: graduationRate, color }]}
          label={<Text ta="center" size="xs" fw={700}>{Math.round(graduationRate)}</Text>}
        />
        <div>
          <Text size="xs" c="dimmed" tt="uppercase">{t("stats.expectedDps")}</Text>
          <Text size="lg" fw={600}>{expectedDps.toLocaleString()}</Text>
        </div>
      </Group>
    </Card>
  );
}
```

**Step 3: Commit**

```bash
git add apps/portal/components/equipment-calc/StatsDisplay.tsx apps/portal/components/equipment-calc/GraduationBanner.tsx
git commit -m "feat(portal): add StatsDisplay and GraduationBanner components"
```

---

### Task 20: Loadout Panel

**Files:**
- Create: `apps/portal/components/equipment-calc/LoadoutPanel.tsx`

**Step 1: Implement loadout panel**

Right panel with loadout selector, class/armory/bow/set dropdowns, xinfa slots, equipment slot grid, graduation banner, stats display. This is the biggest single component.

```tsx
// apps/portal/components/equipment-calc/LoadoutPanel.tsx
import {
  ActionIcon,
  Button,
  Card,
  Checkbox,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Equipment, EquippedSlot, GameData } from "@guild/shared/calculator/types";
import { calculateTotal, calculateGraduationRate, calculateDPS } from "@guild/shared/calculator/engine";
import { useEquipmentCalcStore } from "../../stores/equipmentCalcStore";
import { GraduationBanner } from "./GraduationBanner";
import { StatsDisplay } from "./StatsDisplay";

type Props = { gameData: GameData };

const EQUIPPED_SLOTS: { slot: EquippedSlot; labelKey: string }[] = [
  { slot: "weapon1", labelKey: "W1" },
  { slot: "weapon2", labelKey: "W2" },
  { slot: "head", labelKey: "冠胄" },
  { slot: "chest", labelKey: "胸甲" },
  { slot: "ring", labelKey: "环" },
  { slot: "pendant", labelKey: "佩" },
  { slot: "legs", labelKey: "胫甲" },
  { slot: "hands", labelKey: "腕甲" },
];

export function LoadoutPanel({ gameData }: Props) {
  const { t } = useTranslation("equipCalc");
  const pool = useEquipmentCalcStore((s) => s.pool);
  const loadouts = useEquipmentCalcStore((s) => s.loadouts);
  const activeLoadoutId = useEquipmentCalcStore((s) => s.activeLoadoutId);
  const addLoadout = useEquipmentCalcStore((s) => s.addLoadout);
  const updateLoadout = useEquipmentCalcStore((s) => s.updateLoadout);
  const removeLoadout = useEquipmentCalcStore((s) => s.removeLoadout);
  const setActiveLoadout = useEquipmentCalcStore((s) => s.setActiveLoadout);
  const unequipSlot = useEquipmentCalcStore((s) => s.unequipSlot);

  const activeLoadout = loadouts.find((l) => l.id === activeLoadoutId);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");

  const classOptions = Object.keys(gameData.classConfig).map((c) => ({ label: c, value: c }));
  const setOptions = Object.keys(gameData.setData).map((s) => ({ label: s, value: s }));
  const bowOptions = [
    { label: t("bowTypes.precision"), value: "precision" },
    { label: t("bowTypes.crit"), value: "crit" },
    { label: t("bowTypes.intent"), value: "intent" },
  ];
  const armoryOptions = ["通用", "鸣金", "裂石", "牵丝", "破竹"].map((a) => ({
    label: t(`armoryTypes.${a}`),
    value: a,
  }));

  const loadoutOptions = loadouts.map((l) => ({ label: l.name, value: l.id }));

  const poolMap = useMemo(() => {
    const map = new Map<string, Equipment>();
    for (const e of pool) map.set(e.id, e);
    return map;
  }, [pool]);

  // Calculate stats
  const { stats, graduationRate, dps } = useMemo(() => {
    if (!activeLoadout) return { stats: null, graduationRate: 0, dps: 0 };

    const equipped: Record<string, Equipment | undefined> = {};
    for (const [slot, id] of Object.entries(activeLoadout.equippedItems)) {
      if (id) equipped[slot] = poolMap.get(id);
    }

    const s = calculateTotal(
      equipped,
      activeLoadout.classId,
      activeLoadout.bowType,
      activeLoadout.xinfaSlots,
      activeLoadout.setId,
      activeLoadout.earlySeasonBonus,
      activeLoadout.loanDingyin,
      activeLoadout.armoryType,
      gameData,
    );

    const classConfig = gameData.classConfig[activeLoadout.classId];
    let rate = 0;
    let d = 0;
    if (classConfig) {
      const result = calculateGraduationRate(s, classConfig.skillDatabase, classConfig.rotation, gameData);
      rate = result.graduationRate;
      d = calculateDPS(s, classConfig.skillDatabase, classConfig.rotation, gameData);
    }

    return { stats: s, graduationRate: rate, dps: d };
  }, [activeLoadout, poolMap, gameData]);

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={600}>{t("loadout.title")}</Text>
        <Group gap={4}>
          <Select
            size="xs"
            data={loadoutOptions}
            value={activeLoadoutId}
            onChange={(v) => { if (v) setActiveLoadout(v); }}
            style={{ minWidth: 140 }}
          />
          <Button size="xs" variant="light" onClick={() => addLoadout(t("loadout.newLoadout"), classOptions[0]?.value ?? "")}>+</Button>
          {activeLoadout && (
            <>
              <ActionIcon size="sm" variant="subtle" onClick={() => { setRenaming(true); setNewName(activeLoadout.name); }}>✎</ActionIcon>
              <ActionIcon size="sm" variant="subtle" color="red" onClick={() => { if (activeLoadoutId) removeLoadout(activeLoadoutId); }}>🗑</ActionIcon>
            </>
          )}
        </Group>
      </Group>

      {renaming && activeLoadout && (
        <Group gap="xs">
          <TextInput size="xs" value={newName} onChange={(e) => setNewName(e.currentTarget.value)} />
          <Button size="xs" onClick={() => { updateLoadout(activeLoadout.id, { name: newName }); setRenaming(false); }}>OK</Button>
        </Group>
      )}

      {activeLoadout && (
        <>
          <Group grow>
            <Select size="xs" label={t("loadout.class")} data={classOptions} value={activeLoadout.classId} onChange={(v) => updateLoadout(activeLoadout.id, { classId: v ?? "" })} />
            <Select size="xs" label={t("loadout.armory")} data={armoryOptions} value={activeLoadout.armoryType} onChange={(v) => updateLoadout(activeLoadout.id, { armoryType: v ?? "通用" })} />
          </Group>

          <Group grow>
            <Select size="xs" label={t("loadout.bowType")} data={bowOptions} value={activeLoadout.bowType} onChange={(v) => updateLoadout(activeLoadout.id, { bowType: v ?? "precision" })} />
            <Select size="xs" label={t("loadout.set")} data={setOptions} value={activeLoadout.setId} onChange={(v) => updateLoadout(activeLoadout.id, { setId: v ?? "" })} />
          </Group>

          {/* Equipment Slots Grid */}
          <SimpleGrid cols={4} spacing="xs">
            {EQUIPPED_SLOTS.map(({ slot, labelKey }) => {
              const equipId = activeLoadout.equippedItems[slot];
              const equip = equipId ? poolMap.get(equipId) : undefined;
              return (
                <Card
                  key={slot}
                  withBorder
                  p="xs"
                  style={{ cursor: equip ? "pointer" : "default", textAlign: "center" }}
                  onClick={() => { if (equip) unequipSlot(slot); }}
                >
                  <Text size="xs" c="dimmed">{labelKey}</Text>
                  <Text size="xs" fw={500} truncate>
                    {equip?.name ?? t("loadout.emptySlot")}
                  </Text>
                </Card>
              );
            })}
          </SimpleGrid>

          <Group>
            <Checkbox
              size="xs"
              label={t("loadout.earlySeasonBonus")}
              checked={activeLoadout.earlySeasonBonus}
              onChange={(e) => updateLoadout(activeLoadout.id, { earlySeasonBonus: e.currentTarget.checked })}
            />
            <Checkbox
              size="xs"
              label={t("loadout.loanDingyin")}
              checked={activeLoadout.loanDingyin}
              onChange={(e) => updateLoadout(activeLoadout.id, { loanDingyin: e.currentTarget.checked })}
            />
          </Group>

          <GraduationBanner graduationRate={graduationRate} expectedDps={dps} />

          {stats && <StatsDisplay stats={stats} gameData={gameData} />}
        </>
      )}
    </Stack>
  );
}
```

**Step 2: Commit**

```bash
git add apps/portal/components/equipment-calc/LoadoutPanel.tsx
git commit -m "feat(portal): add LoadoutPanel with class config, equipment slots, live graduation rate"
```

---

### Task 21: Analysis Tabs Container + Comparison Tab

**Files:**
- Create: `apps/portal/components/equipment-calc/AnalysisTabs.tsx`
- Create: `apps/portal/components/equipment-calc/ComparisonTab.tsx`

**Step 1: Implement AnalysisTabs shell**

```tsx
// apps/portal/components/equipment-calc/AnalysisTabs.tsx
import { Tabs } from "@mantine/core";
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import type { GameData } from "@guild/shared/calculator/types";
import { ErrorBoundary } from "../effects";

const ComparisonTab = lazy(() => import("./ComparisonTab").then((m) => ({ default: m.ComparisonTab })));
const PriorityTab = lazy(() => import("./PriorityTab").then((m) => ({ default: m.PriorityTab })));
const CultivationTab = lazy(() => import("./CultivationTab").then((m) => ({ default: m.CultivationTab })));
const TransmutationTab = lazy(() => import("./TransmutationTab").then((m) => ({ default: m.TransmutationTab })));
const BestBuildTab = lazy(() => import("./BestBuildTab").then((m) => ({ default: m.BestBuildTab })));
const ManualEntryTab = lazy(() => import("./ManualEntryTab").then((m) => ({ default: m.ManualEntryTab })));

type Props = { gameData: GameData };

export function AnalysisTabs({ gameData }: Props) {
  const { t } = useTranslation("equipCalc");

  return (
    <Tabs defaultValue="comparison">
      <Tabs.List>
        <Tabs.Tab value="comparison">{t("tabs.comparison")}</Tabs.Tab>
        <Tabs.Tab value="priority">{t("tabs.priority")}</Tabs.Tab>
        <Tabs.Tab value="cultivation">{t("tabs.cultivation")}</Tabs.Tab>
        <Tabs.Tab value="transmutation">{t("tabs.transmutation")}</Tabs.Tab>
        <Tabs.Tab value="bestBuild">{t("tabs.bestBuild")}</Tabs.Tab>
        <Tabs.Tab value="manualEntry">{t("tabs.manualEntry")}</Tabs.Tab>
      </Tabs.List>

      <ErrorBoundary>
        <Suspense fallback={null}>
          <Tabs.Panel value="comparison" pt="sm"><ComparisonTab gameData={gameData} /></Tabs.Panel>
          <Tabs.Panel value="priority" pt="sm"><PriorityTab gameData={gameData} /></Tabs.Panel>
          <Tabs.Panel value="cultivation" pt="sm"><CultivationTab gameData={gameData} /></Tabs.Panel>
          <Tabs.Panel value="transmutation" pt="sm"><TransmutationTab gameData={gameData} /></Tabs.Panel>
          <Tabs.Panel value="bestBuild" pt="sm"><BestBuildTab gameData={gameData} /></Tabs.Panel>
          <Tabs.Panel value="manualEntry" pt="sm"><ManualEntryTab gameData={gameData} /></Tabs.Panel>
        </Suspense>
      </ErrorBoundary>
    </Tabs>
  );
}
```

**Step 2: Implement ComparisonTab**

```tsx
// apps/portal/components/equipment-calc/ComparisonTab.tsx
import { Badge, Card, Checkbox, Group, Select, SimpleGrid, Stack, Text } from "@mantine/core";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Equipment, EquippedSlot, GameData } from "@guild/shared/calculator/types";
import { calculateTotal, calculateGraduationRate } from "@guild/shared/calculator/engine";
import { useEquipmentCalcStore } from "../../stores/equipmentCalcStore";

type Props = { gameData: GameData };

export function ComparisonTab({ gameData }: Props) {
  const { t } = useTranslation("equipCalc");
  const pool = useEquipmentCalcStore((s) => s.pool);
  const loadouts = useEquipmentCalcStore((s) => s.loadouts);
  const activeLoadoutId = useEquipmentCalcStore((s) => s.activeLoadoutId);
  const equipItem = useEquipmentCalcStore((s) => s.equipItem);

  const [selectedSlot, setSelectedSlot] = useState<EquippedSlot | null>(null);
  const [freezeDingyin, setFreezeDingyin] = useState(false);
  const [assumeMaxChengyin, setAssumeMaxChengyin] = useState(false);

  const activeLoadout = loadouts.find((l) => l.id === activeLoadoutId);

  const slotOptions = [
    { label: "W1", value: "weapon1" },
    { label: "W2", value: "weapon2" },
    { label: "冠胄", value: "head" },
    { label: "胸甲", value: "chest" },
    { label: "环", value: "ring" },
    { label: "佩", value: "pendant" },
    { label: "胫甲", value: "legs" },
    { label: "腕甲", value: "hands" },
  ];

  const poolMap = useMemo(() => new Map(pool.map((e) => [e.id, e])), [pool]);

  // Calculate base rate for current loadout
  const baseRate = useMemo(() => {
    if (!activeLoadout) return 0;
    const equipped: Record<string, Equipment | undefined> = {};
    for (const [slot, id] of Object.entries(activeLoadout.equippedItems)) {
      if (id) equipped[slot] = poolMap.get(id);
    }
    const stats = calculateTotal(
      equipped, activeLoadout.classId, activeLoadout.bowType,
      activeLoadout.xinfaSlots, activeLoadout.setId,
      activeLoadout.earlySeasonBonus, activeLoadout.loanDingyin,
      activeLoadout.armoryType, gameData,
    );
    const classConfig = gameData.classConfig[activeLoadout.classId];
    if (!classConfig) return 0;
    return calculateGraduationRate(stats, classConfig.skillDatabase, classConfig.rotation, gameData).graduationRate;
  }, [activeLoadout, poolMap, gameData]);

  // For the selected slot, compute rate delta for each candidate
  const candidates = useMemo(() => {
    if (!activeLoadout || !selectedSlot) return [];
    const classConfig = gameData.classConfig[activeLoadout.classId];
    if (!classConfig) return [];

    const slotId = selectedSlot.startsWith("weapon") ? "1" : {
      head: "5", chest: "6", ring: "3", pendant: "4", legs: "7", hands: "8",
    }[selectedSlot] ?? "";

    return pool
      .filter((e) => e.slotId === slotId)
      .filter((e) => !e.availableClasses?.length || e.availableClasses.includes(activeLoadout.classId))
      .map((candidate) => {
        const equipped: Record<string, Equipment | undefined> = {};
        for (const [slot, id] of Object.entries(activeLoadout.equippedItems)) {
          if (id) equipped[slot] = poolMap.get(id);
        }
        equipped[selectedSlot] = candidate;

        const stats = calculateTotal(
          equipped, activeLoadout.classId, activeLoadout.bowType,
          activeLoadout.xinfaSlots, activeLoadout.setId,
          activeLoadout.earlySeasonBonus, activeLoadout.loanDingyin,
          activeLoadout.armoryType, gameData,
        );
        const result = calculateGraduationRate(stats, classConfig.skillDatabase, classConfig.rotation, gameData);
        return { equipment: candidate, rate: result.graduationRate, delta: result.graduationRate - baseRate };
      })
      .sort((a, b) => b.delta - a.delta);
  }, [activeLoadout, selectedSlot, pool, poolMap, gameData, baseRate]);

  return (
    <Stack gap="sm">
      <Group>
        <Select
          size="xs"
          placeholder={t("comparison.selectSlot")}
          data={slotOptions}
          value={selectedSlot}
          onChange={(v) => setSelectedSlot(v as EquippedSlot | null)}
        />
        <Checkbox size="xs" label={t("comparison.freezeDingyin")} checked={freezeDingyin} onChange={(e) => setFreezeDingyin(e.currentTarget.checked)} />
        <Checkbox size="xs" label={t("comparison.assumeMaxChengyin")} checked={assumeMaxChengyin} onChange={(e) => setAssumeMaxChengyin(e.currentTarget.checked)} />
      </Group>

      {!selectedSlot && <Text c="dimmed" size="sm">{t("comparison.selectSlot")}</Text>}

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
        {candidates.map(({ equipment, rate, delta }) => (
          <Card key={equipment.id} withBorder p="xs" onClick={() => equipItem(equipment.id)} style={{ cursor: "pointer" }}>
            <Group justify="space-between">
              <Text size="sm" fw={500} truncate>{equipment.name}</Text>
              <Badge
                size="sm"
                color={delta > 0 ? "green" : delta < 0 ? "red" : "gray"}
              >
                {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
              </Badge>
            </Group>
            <Text size="xs" c="dimmed">{rate.toFixed(1)}%</Text>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
```

**Step 3: Commit**

```bash
git add apps/portal/components/equipment-calc/AnalysisTabs.tsx apps/portal/components/equipment-calc/ComparisonTab.tsx
git commit -m "feat(portal): add AnalysisTabs container and ComparisonTab with rate deltas"
```

---

### Task 22: Remaining Analysis Tabs (Priority, Cultivation, Transmutation, Manual Entry)

**Files:**
- Create: `apps/portal/components/equipment-calc/PriorityTab.tsx`
- Create: `apps/portal/components/equipment-calc/CultivationTab.tsx`
- Create: `apps/portal/components/equipment-calc/TransmutationTab.tsx`
- Create: `apps/portal/components/equipment-calc/ManualEntryTab.tsx`

These are smaller analysis tabs. Each follows the same pattern: read from Zustand store, compute with calculator engine, render results.

**Step 1: PriorityTab** — shows adding/losing one max roll per stat, sorted by impact.

**Step 2: CultivationTab** — per-slot recommendation showing current vs potential rate.

**Step 3: TransmutationTab** — select equipment, shows which sub-stat to reroll and target.

**Step 4: ManualEntryTab** — grid of stat inputs, calculate graduation rate directly.

Each tab is ~60-100 lines following the ComparisonTab pattern. Create all four files.

**Step 5: Commit**

```bash
git add apps/portal/components/equipment-calc/PriorityTab.tsx apps/portal/components/equipment-calc/CultivationTab.tsx apps/portal/components/equipment-calc/TransmutationTab.tsx apps/portal/components/equipment-calc/ManualEntryTab.tsx
git commit -m "feat(portal): add Priority, Cultivation, Transmutation, and ManualEntry analysis tabs"
```

---

### Task 23: Best Build Tab + Web Worker

**Files:**
- Create: `apps/portal/components/equipment-calc/BestBuildTab.tsx`
- Create: `apps/portal/workers/bestBuildWorker.ts`

**Step 1: Create Web Worker**

```ts
// apps/portal/workers/bestBuildWorker.ts
import { findBestBuild, type BestBuildConfig } from "@guild/shared/calculator/best-build";

const abortFlag = { aborted: false };

self.onmessage = (e: MessageEvent) => {
  const { type, config } = e.data;
  if (type === "cancel") {
    abortFlag.aborted = true;
    return;
  }
  if (type === "search") {
    abortFlag.aborted = false;
    try {
      const results = findBestBuild({
        ...config,
        signal: abortFlag,
        onProgress: (pct: number) => self.postMessage({ type: "progress", percent: pct }),
      });
      self.postMessage({ type: "result", results });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
  }
};
```

**Step 2: Create BestBuildTab**

```tsx
// apps/portal/components/equipment-calc/BestBuildTab.tsx
import { Alert, Button, Card, Checkbox, Group, Progress, SimpleGrid, Stack, Text } from "@mantine/core";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BuildResult, EquippedSlot, GameData } from "@guild/shared/calculator/types";
import { useEquipmentCalcStore } from "../../stores/equipmentCalcStore";

type Props = { gameData: GameData };

const EQUIPPED_SLOTS: EquippedSlot[] = ["weapon1", "weapon2", "head", "chest", "ring", "pendant", "legs", "hands"];

export function BestBuildTab({ gameData }: Props) {
  const { t } = useTranslation("equipCalc");
  const pool = useEquipmentCalcStore((s) => s.pool);
  const loadouts = useEquipmentCalcStore((s) => s.loadouts);
  const activeLoadoutId = useEquipmentCalcStore((s) => s.activeLoadoutId);
  const updateLoadout = useEquipmentCalcStore((s) => s.updateLoadout);

  const activeLoadout = loadouts.find((l) => l.id === activeLoadoutId);

  const [lockedSlots, setLockedSlots] = useState<Partial<Record<EquippedSlot, string>>>({});
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<BuildResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const toggleLock = useCallback((slot: EquippedSlot) => {
    setLockedSlots((prev) => {
      if (prev[slot]) {
        const next = { ...prev };
        delete next[slot];
        return next;
      }
      const equipId = activeLoadout?.equippedItems[slot];
      if (!equipId) return prev;
      return { ...prev, [slot]: equipId };
    });
  }, [activeLoadout]);

  const startSearch = useCallback(() => {
    if (!activeLoadout) return;
    setSearching(true);
    setProgress(0);
    setResults([]);
    setError(null);

    const worker = new Worker(new URL("../../workers/bestBuildWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (e) => {
      if (e.data.type === "progress") setProgress(e.data.percent);
      if (e.data.type === "result") { setResults(e.data.results); setSearching(false); worker.terminate(); }
      if (e.data.type === "error") { setError(e.data.message); setSearching(false); worker.terminate(); }
    };

    worker.postMessage({
      type: "search",
      config: { pool, loadout: activeLoadout, lockedSlots, gameData },
    });
  }, [activeLoadout, pool, lockedSlots, gameData]);

  const cancelSearch = useCallback(() => {
    workerRef.current?.postMessage({ type: "cancel" });
    workerRef.current?.terminate();
    setSearching(false);
  }, []);

  const applyBuild = useCallback((build: BuildResult) => {
    if (!activeLoadout) return;
    updateLoadout(activeLoadout.id, { equippedItems: build.equippedItems });
  }, [activeLoadout, updateLoadout]);

  const poolMap = useMemo(() => new Map(pool.map((e) => [e.id, e])), [pool]);

  return (
    <Stack gap="sm">
      <Group gap="xs" wrap="wrap">
        {EQUIPPED_SLOTS.map((slot) => (
          <Checkbox
            key={slot}
            size="xs"
            label={`${t("bestBuild.lockSlot")} ${slot}`}
            checked={Boolean(lockedSlots[slot])}
            onChange={() => toggleLock(slot)}
          />
        ))}
      </Group>

      <Group>
        <Button onClick={startSearch} disabled={searching || !activeLoadout} loading={searching}>
          {t("bestBuild.find")}
        </Button>
        {searching && <Button variant="subtle" color="red" onClick={cancelSearch}>{t("bestBuild.cancel")}</Button>}
      </Group>

      {searching && <Progress value={progress} animated />}
      {error && <Alert color="red">{error}</Alert>}

      {results.length > 0 && (
        <Stack gap="xs">
          <Text fw={600}>{t("bestBuild.topBuilds")}</Text>
          {results.map((build, i) => (
            <Card key={i} withBorder p="sm">
              <Group justify="space-between">
                <div>
                  <Text size="sm" fw={600}>{build.graduationRate.toFixed(1)}%</Text>
                  <Text size="xs" c="dimmed">DPS: {build.dps.toLocaleString()}</Text>
                </div>
                <Button size="xs" variant="light" onClick={() => applyBuild(build)}>{t("bestBuild.apply")}</Button>
              </Group>
              <SimpleGrid cols={4} spacing={4} mt="xs">
                {EQUIPPED_SLOTS.map((slot) => {
                  const eid = build.equippedItems[slot];
                  const equip = eid ? poolMap.get(eid) : undefined;
                  return <Text key={slot} size="xs" truncate>{slot}: {equip?.name ?? "-"}</Text>;
                })}
              </SimpleGrid>
            </Card>
          ))}
        </Stack>
      )}

      {!searching && results.length === 0 && !error && (
        <Text c="dimmed" size="sm">{t("bestBuild.noResults")}</Text>
      )}
    </Stack>
  );
}
```

**Step 3: Commit**

```bash
git add apps/portal/components/equipment-calc/BestBuildTab.tsx apps/portal/workers/bestBuildWorker.ts
git commit -m "feat(portal): add BestBuildTab with Web Worker search and progress"
```

---

## Phase 5: Integration

### Task 24: Wire ToolsPage to Open Calculator Modal

**Files:**
- Modify: `apps/portal/components/pages/ToolsPage.tsx`

**Step 1: Replace external link card with modal launcher**

In `ToolsPage.tsx`:
- Import `EquipmentCalcModal` (lazy)
- Add `useDisclosure` for modal open state
- Replace the `href`-based equipCalc card with a `button` card that opens the modal
- Gate rendering on `equipmentCalc` feature flag
- Render `<EquipmentCalcModal>` at the bottom

**Step 2: Update tools.json descriptions**

In `apps/portal/i18n/en/tools.json`, change:
```json
"equipCalc.description": "Plan and optimize your gear builds"
```

In `apps/portal/i18n/zh/tools.json`, change:
```json
"equipCalc.description": "规划和优化你的装备搭配"
```

(Remove the "(external site)" / "（外部网站）" suffix)

**Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: clean

**Step 4: Commit**

```bash
git add apps/portal/components/pages/ToolsPage.tsx apps/portal/i18n/en/tools.json apps/portal/i18n/zh/tools.json
git commit -m "feat(portal): wire equipment calculator modal into Tools page"
```

---

### Task 25: Admin Game Data Tab

**Files:**
- Create: `apps/portal/components/feature/admin/AdminGameDataSection.tsx`
- Modify: `apps/portal/components/pages/AdminPage.tsx`
- Modify: `apps/portal/i18n/en/admin.json`
- Modify: `apps/portal/i18n/zh/admin.json`

**Step 1: Create AdminGameDataSection**

Admin tab showing: current version, download JSON, upload JSON (with validation), version history with rollback, icon management grid.

**Step 2: Add tab to AdminPage.tsx**

- Add lazy import for `AdminGameDataSection`
- Add permission check for `admin.gameData.manage`
- Add `<Tabs.Tab value="gameData">{t("tab.gameData")}</Tabs.Tab>` in the tab list
- Add `<Tabs.Panel>` with the lazy section

**Step 3: Add admin i18n keys**

Add to both `en/admin.json` and `zh/admin.json`:
```json
"tab.gameData": "Game Data" / "游戏数据",
"gameData.currentVersion": "Current Version" / "当前版本",
"gameData.download": "Download JSON" / "下载JSON",
"gameData.upload": "Upload JSON" / "上传JSON",
"gameData.versions": "Version History" / "版本历史",
"gameData.rollback": "Rollback" / "回滚",
"gameData.icons": "Icon Management" / "图标管理",
"gameData.uploadSuccess": "Game data updated successfully" / "游戏数据更新成功",
"gameData.rollbackSuccess": "Rolled back successfully" / "回滚成功",
"gameData.validationError": "Validation failed" / "验证失败",
"gameData.empty": "No game data. Upload the initial dataset." / "暂无游戏数据，请上传初始数据集。"
```

**Step 4: Commit**

```bash
git add apps/portal/components/feature/admin/AdminGameDataSection.tsx apps/portal/components/pages/AdminPage.tsx apps/portal/i18n/en/admin.json apps/portal/i18n/zh/admin.json
git commit -m "feat(portal): add admin Game Data management tab"
```

---

### Task 26: Audit Entity Types + Role Seed

**Files:**
- Modify: `apps/shared/constants/audit.ts` (add `"game_data"` entity type, `"upload"`, `"rollback"`, `"icon_upload"` actions)
- Modify: `apps/worker/db/seed.ts` (grant `admin.gameData.manage` to admin role)

**Step 1: Add audit constants**

Add `"game_data"` to `AUDIT_ENTITY_TYPES` and the three actions to `AUDIT_ACTIONS`.

**Step 2: Update seed**

Find the admin role permission seed and add `"admin.gameData.manage": true`.

**Step 3: Commit**

```bash
git add apps/shared/constants/audit.ts apps/worker/db/seed.ts
git commit -m "feat: add game_data audit entity type and seed admin.gameData.manage permission"
```

---

### Task 27: Final Typecheck + Smoke Test

**Step 1: Full typecheck**

Run: `pnpm typecheck`
Expected: clean

**Step 2: Start dev server**

Run: `pnpm dev`
Expected: portal starts without errors

**Step 3: Manual smoke test**

1. Open Tools page — equipment calculator card should appear
2. Click card — fullscreen modal opens
3. Modal shows "Game data not initialized" error (expected — no data seeded yet)
4. Navigate to Admin → Game Data tab — should show empty state
5. Upload the seed JSON — should succeed
6. Return to calculator — modal should now load with game data
7. Add an equipment piece via form
8. Create a loadout, equip the item
9. Graduation rate should display

**Step 4: Commit any fixups**

```bash
git commit -m "fix: address typecheck and smoke test issues from equipment calculator integration"
```

---

## Implementation Notes

### Dependencies between tasks

- Tasks 1-6 (Phase 1) are sequential but independent of Phase 2
- Task 7 must complete before Tasks 8-9
- Task 12 depends on Task 1 (types) and Task 5 (migration)
- Task 13 depends on Task 1 (types)
- Tasks 15-23 (Phase 4) depend on Tasks 12-14 (Phase 3)
- Task 24 depends on Task 15 (modal component)
- Task 25 depends on Task 13 (API client)
- Task 26 is independent

### Parallelizable work

These can be done in parallel:
- Phase 1 (Tasks 1-6) ‖ Phase 2 (Tasks 7-11)
- Task 12 ‖ Task 13 ‖ Task 14
- Tasks 16-18 can be parallelized (independent components)
- Task 22 (4 analysis tabs) can be parallelized internally

### What's deferred

- Real game data extraction from spongem.com (seed JSON is placeholder)
- OCR import
- Xinfa selection modal (can use plain Select for now)
- R2 icon rendering (placeholder text icons for now)
- Responsive mobile optimizations (basic CSS grid breakpoint only)
