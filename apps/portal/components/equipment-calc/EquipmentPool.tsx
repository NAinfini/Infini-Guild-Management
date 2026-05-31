import { useMemo, useState } from "react";
import { Button, SegmentedControl, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { IconBackpack } from "@tabler/icons-react";
import type { GameData } from "@guild/shared/calculator/types";
import { useEquipmentCalcStore, useActiveLoadout } from "@portal/stores/equipmentCalcStore";
import { PlusIcon } from "@portal/components/icons";
import { EquipmentCard } from "./EquipmentCard";
import { EquipmentForm } from "./EquipmentForm";

type FilterMode = "all" | "available" | "equipped";

export function EquipmentPool({ gameData }: { gameData: GameData }) {
  const { t, i18n } = useTranslation("equipCalc");
  const useEn = i18n.language.startsWith("en");
  const [formOpened, formHandlers] = useDisclosure(false);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [slotFilter, setSlotFilter] = useState<string | null>(null);

  const pool = useEquipmentCalcStore((s) => s.pool);
  const equipItem = useEquipmentCalcStore((s) => s.equipItem);
  const activeLoadout = useActiveLoadout();

  const equippedIds = useMemo(() => {
    if (!activeLoadout) return new Set<string>();
    return new Set(Object.values(activeLoadout.equippedItems).filter(Boolean) as string[]);
  }, [activeLoadout]);

  const filtered = useMemo(() => {
    let items = pool;

    if (activeLoadout?.classId) {
      items = items.filter(
        (e) => !e.availableClasses || e.availableClasses.length === 0 || e.availableClasses.includes(activeLoadout.classId),
      );
    }

    if (filterMode === "equipped") {
      items = items.filter((e) => equippedIds.has(e.id));
    } else if (filterMode === "available") {
      items = items.filter((e) => !equippedIds.has(e.id));
    }

    if (slotFilter) {
      items = items.filter((e) => e.slotId === slotFilter);
    }

    return items;
  }, [pool, activeLoadout, filterMode, slotFilter, equippedIds]);

  return (
    <Stack gap="sm">
      {/* Header */}
      <div className="ecm__pool-header">
        <div className="ecm__pool-header__title-group">
          <IconBackpack size={18} className="ecm__pool-header__icon" />
          <Text fw={700} size="sm">{t("pool.title")}</Text>
          <Text size="xs" c="dimmed">({pool.length})</Text>
        </div>
        <Button size="compact-xs" leftSection={<PlusIcon size={12} />} onClick={formHandlers.open}>
          {t("pool.addEquipment")}
        </Button>
      </div>

      {/* Filter bar: all / available / equipped */}
      <SegmentedControl
        size="xs"
        fullWidth
        value={filterMode}
        onChange={(v) => setFilterMode(v as FilterMode)}
        data={[
          { label: t("pool.filter.all"), value: "all" },
          { label: t("pool.filter.available"), value: "available" },
          { label: t("pool.filter.equipped"), value: "equipped" },
        ]}
      />

      {/* Slot filter capsule buttons */}
      <div className="ecm__pool-filter-bar">
        <button
          type="button"
          className={`ecm__pool-filter-btn${slotFilter === null ? " ecm__pool-filter-btn--active" : ""}`}
          onClick={() => setSlotFilter(null)}
        >
          {t("pool.allSlots")}
        </button>
        {gameData.slots.map((slot) => (
          <button
            key={slot.id}
            type="button"
            className={`ecm__pool-filter-btn${slotFilter === slot.id ? " ecm__pool-filter-btn--active" : ""}`}
            onClick={() => setSlotFilter(slot.id)}
          >
            {useEn ? slot.nameEn : slot.name}
          </button>
        ))}
      </div>

      {/* Equipment cards */}
      {filtered.length > 0 ? (
        <div className="ecm__pool-cards">
          {filtered.map((equip) => (
            <EquipmentCard
              key={equip.id}
              equipment={equip}
              gameData={gameData}
              isEquipped={equippedIds.has(equip.id)}
              onClick={() => equipItem(equip.id)}
            />
          ))}
        </div>
      ) : (
        pool.length === 0 ? (
          <div className="ecm__pool-empty">
            <IconBackpack size={32} style={{ opacity: 0.25 }} />
            <Text c="dimmed" size="sm">{t("pool.addFirst")}</Text>
            <Button size="compact-xs" leftSection={<PlusIcon size={12} />} onClick={formHandlers.open}>
              {t("pool.addEquipment")}
            </Button>
          </div>
        ) : (
          <Text c="dimmed" ta="center" py="xl" size="sm">
            {t("pool.noMatch")}
          </Text>
        )
      )}

      <EquipmentForm opened={formOpened} onClose={formHandlers.close} gameData={gameData} />
    </Stack>
  );
}
