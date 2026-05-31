// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useEquipmentCalcStore } from "./equipmentCalcStore";

describe("equipmentCalcStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useEquipmentCalcStore.setState({
      pool: [],
      loadouts: [],
      activeLoadoutId: null,
      schemaVersion: 1,
    });
  });

  it("defaults new loadouts to the class elemental armory", () => {
    const id = useEquipmentCalcStore.getState().addLoadout("牵丝 build", "牵丝玉");

    const loadout = useEquipmentCalcStore.getState().loadouts.find((item) => item.id === id);

    expect(loadout?.armoryType).toBe("牵丝");
  });

  it("does not equip the same weapon into both weapon slots", () => {
    const store = useEquipmentCalcStore.getState();
    const loadoutId = store.addLoadout("weapon test", "Mingjin test");
    const equipmentId = store.addEquipment({
      name: "Shared weapon",
      slotId: "1",
      isChengyin: false,
      isPurple: false,
      mainStat: { type: "max outer attack", value: 10 },
      subStats: [],
      dingyinStat: { type: "", value: 0 },
    });

    useEquipmentCalcStore.getState().equipItem(equipmentId);
    useEquipmentCalcStore.getState().equipItem(equipmentId);

    const loadout = useEquipmentCalcStore.getState().loadouts.find((item) => item.id === loadoutId);
    expect(loadout?.equippedItems.weapon1).toBe(equipmentId);
    expect(loadout?.equippedItems.weapon2).toBeUndefined();
  });
});
