import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { Equipment, Loadout, EquippedSlot } from "@guild/shared/calculator/types";
import { migrateLocalData } from "@guild/shared/calculator/migration";

type LoadoutDefaults = Partial<Pick<Loadout, "xinfaSlots" | "setId" | "bowType" | "armoryType">>;

function getClassArmoryType(classId: string): string {
  const armoryType = classId.substring(0, 2);
  return ["鸣金", "裂石", "牵丝", "破竹"].includes(armoryType) ? armoryType : "通用";
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

  addLoadout: (name: string, classId: string, defaults?: LoadoutDefaults) => string;
  updateLoadout: (id: string, patch: Partial<Omit<Loadout, "id">>) => void;
  removeLoadout: (id: string) => void;
  setActiveLoadout: (id: string) => void;

  equipItem: (equipmentId: string) => void;
  unequipSlot: (slot: EquippedSlot) => void;

  migrateSchema: (newVersion: number) => void;

  exportData: () => string;
  importData: (json: string) => boolean;
};

function createDefaultLoadout(name: string, classId: string, defaults: LoadoutDefaults = {}): Loadout {
  return {
    id: nanoid(),
    name,
    classId,
    xinfaSlots: defaults.xinfaSlots ?? ["", "", "", ""],
    setId: defaults.setId ?? "",
    bowType: defaults.bowType ?? "precision",
    armoryType: defaults.armoryType ?? getClassArmoryType(classId),
    equippedItems: {},
    earlySeasonBonus: false,
    loanDingyin: false,
    loanDingyinStats: { outerPenetration: 0, elePenetration: 0, specificSkillBonus: 0 },
  };
}

export const useEquipmentCalcStore = create<EquipmentCalcState>()(
  persist(
    (set, get) => ({
      pool: [],
      loadouts: [],
      activeLoadoutId: null,
      schemaVersion: 1,

      addEquipment: (equip) => {
        const id = nanoid();
        const newEquip: Equipment = { ...equip, id, createdAt: Date.now() };
        set((state) => {
          const pool = [...state.pool, newEquip];
          return { pool };
        });
        return id;
      },

      updateEquipment: (id, patch) => {
        set((state) => {
          const pool = state.pool.map((e) => (e.id === id ? { ...e, ...patch } : e));
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
          return { pool, loadouts };
        });
      },

      addLoadout: (name, classId, defaults) => {
        const loadout = createDefaultLoadout(name, classId, defaults);
        set((state) => {
          const loadouts = [...state.loadouts, loadout];
          return { loadouts, activeLoadoutId: loadout.id };
        });
        return loadout.id;
      },

      updateLoadout: (id, patch) => {
        set((state) => {
          const loadouts = state.loadouts.map((l) => (l.id === id ? { ...l, ...patch } : l));
          return { loadouts };
        });
      },

      removeLoadout: (id) => {
        set((state) => {
          const loadouts = state.loadouts.filter((l) => l.id !== id);
          const activeLoadoutId = state.activeLoadoutId === id ? (loadouts[0]?.id ?? null) : state.activeLoadoutId;
          return { loadouts, activeLoadoutId };
        });
      },

      setActiveLoadout: (id) => {
        set({ activeLoadoutId: id });
      },

      equipItem: (equipmentId) => {
        set((state) => {
          const equip = state.pool.find((e) => e.id === equipmentId);
          if (!equip) return state;
          const loadout = state.loadouts.find((l) => l.id === state.activeLoadoutId);
          if (!loadout) return state;

          const items = { ...loadout.equippedItems };
          for (const [slot, id] of Object.entries(items)) {
            if (id === equipmentId) delete items[slot as EquippedSlot];
          }

          if (equip.slotId === "1") {
            // Weapon: W1 -> W2 -> replace W1
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
          return { loadouts };
        });
      },

      migrateSchema: (newVersion) => {
        const state = get();
        const pool = [...state.pool];
        const loadouts = [...state.loadouts];
        migrateLocalData(pool, loadouts, state.schemaVersion, newVersion);
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
    }),
    {
      name: "equipCalc",
      partialize: (state) => ({
        pool: state.pool,
        loadouts: state.loadouts,
        activeLoadoutId: state.activeLoadoutId,
        schemaVersion: state.schemaVersion,
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<EquipmentCalcState> | undefined;
        if (stored?.pool) {
          // New-format data exists, use it
          return { ...current, ...stored };
        }
        // Check for old-format keys
        try {
          const oldPool = localStorage.getItem("equipCalc.pool");
          if (oldPool) {
            const migrated = {
              pool: JSON.parse(oldPool) as Equipment[],
              loadouts: JSON.parse(localStorage.getItem("equipCalc.loadouts") ?? "[]") as Loadout[],
              activeLoadoutId: JSON.parse(localStorage.getItem("equipCalc.activeLoadout") ?? "null") as string | null,
              schemaVersion: JSON.parse(localStorage.getItem("equipCalc.schemaVersion") ?? "1") as number,
            };
            // Clean up old keys
            localStorage.removeItem("equipCalc.pool");
            localStorage.removeItem("equipCalc.loadouts");
            localStorage.removeItem("equipCalc.activeLoadout");
            localStorage.removeItem("equipCalc.schemaVersion");
            return { ...current, ...migrated };
          }
        } catch {
          // Old keys unreadable, fall through to defaults
        }
        return { ...current, ...stored };
      },
    },
  ),
);

export function useActiveLoadout(): Loadout | null {
  return useEquipmentCalcStore((s) => s.loadouts.find((l) => l.id === s.activeLoadoutId) ?? null);
}
