import { Badge, Card, Checkbox, Group, Select, SimpleGrid, Stack, Text } from "@mantine/core";
import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EquippedSlot, GameData } from "@guild/shared/calculator/types";
import { useEquipmentCalcStore, useActiveLoadout } from "../../stores/equipmentCalcStore";
import { buildEquippedMap, calculateLoadoutResult } from "./calculation";

type Props = { gameData: GameData };

export function ComparisonTab({ gameData }: Props) {
  const { t, i18n } = useTranslation("equipCalc");
  const useEn = i18n.language.startsWith("en");
  const pool = useEquipmentCalcStore((s) => s.pool);
  const equipItem = useEquipmentCalcStore((s) => s.equipItem);
  const activeLoadout = useActiveLoadout();

  const [selectedSlot, setSelectedSlot] = useState<EquippedSlot | null>(null);
  const [freezeDingyin, setFreezeDingyin] = useState(false);
  const [assumeMaxChengyin, setAssumeMaxChengyin] = useState(false);

  const deferredSlot = useDeferredValue(selectedSlot);
  const deferredFreezeDingyin = useDeferredValue(freezeDingyin);
  const deferredAssumeMaxChengyin = useDeferredValue(assumeMaxChengyin);

  const slotOptions = gameData.slots.map((s) => ({
    label: useEn ? s.nameEn : s.name,
    value: s.id === "1" ? "weapon1" : { "5": "head", "6": "chest", "3": "ring", "4": "pendant", "7": "legs", "8": "hands" }[s.id] ?? s.id,
  }));

  const poolMap = useMemo(() => new Map(pool.map((e) => [e.id, e])), [pool]);

  const baseRate = useMemo(() => {
    if (!activeLoadout) return 0;
    return calculateLoadoutResult(buildEquippedMap(activeLoadout, pool), activeLoadout, gameData).graduationRate;
  }, [activeLoadout, pool, gameData]);

  const candidates = useMemo(() => {
    if (!activeLoadout || !deferredSlot) return [];
    const slotId = deferredSlot.startsWith("weapon") ? "1" : ({ head: "5", chest: "6", ring: "3", pendant: "4", legs: "7", hands: "8" } as Record<string, string>)[deferredSlot] ?? "";

    return pool
      .filter((e) => e.slotId === slotId)
      .filter((e) => !e.availableClasses?.length || e.availableClasses.includes(activeLoadout.classId))
      .map((candidate) => {
        let equip = candidate;
        if (deferredAssumeMaxChengyin && candidate.isChengyin) {
          equip = { ...candidate, subStats: candidate.subStats.map((s) => ({ type: s.type, value: gameData.maxValues[s.type] ?? s.value })) };
        }
        if (deferredFreezeDingyin) {
          const currentId = activeLoadout.equippedItems[deferredSlot];
          const current = currentId ? poolMap.get(currentId) : undefined;
          if (current) equip = { ...equip, dingyinStat: current.dingyinStat };
        }
        const equipped = buildEquippedMap(activeLoadout, pool, { slot: deferredSlot, equipment: equip });
        const rate = calculateLoadoutResult(equipped, activeLoadout, gameData).graduationRate;
        return { equipment: candidate, rate, delta: rate - baseRate };
      })
      .sort((a, b) => b.delta - a.delta);
  }, [activeLoadout, deferredSlot, pool, poolMap, gameData, baseRate, deferredFreezeDingyin, deferredAssumeMaxChengyin]);

  const isStale = deferredSlot !== selectedSlot || deferredFreezeDingyin !== freezeDingyin || deferredAssumeMaxChengyin !== assumeMaxChengyin;

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

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs" style={{ opacity: isStale ? 0.6 : 1, transition: "opacity 150ms" }}>
        {candidates.map(({ equipment, rate, delta }) => (
          <Card key={equipment.id} withBorder p="xs" onClick={() => equipItem(equipment.id)} style={{ cursor: "pointer" }}>
            <Group justify="space-between">
              <Text size="sm" fw={500} truncate>{equipment.name}</Text>
              <Badge size="sm" color={delta > 0 ? "green" : delta < 0 ? "red" : "gray"}>
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
