import { Badge, Card, Group, Select, Stack, Text } from "@mantine/core";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Equipment, GameData } from "@guild/shared/calculator/types";
import { useEquipmentCalcStore, useActiveLoadout } from "../../stores/equipmentCalcStore";
import { buildEquippedMap, calculateLoadoutResult } from "./calculation";

type Props = { gameData: GameData };

export function TransmutationTab({ gameData }: Props) {
  const { t } = useTranslation("equipCalc");
  const pool = useEquipmentCalcStore((s) => s.pool);
  const activeLoadout = useActiveLoadout();

  const [selectedEquipId, setSelectedEquipId] = useState<string | null>(null);

  const poolMap = useMemo(() => new Map(pool.map((e) => [e.id, e])), [pool]);
  const selectedEquip = selectedEquipId ? poolMap.get(selectedEquipId) : undefined;

  const equipOptions = pool.map((e) => ({ label: e.name || e.id, value: e.id }));

  const rerollOptions = useMemo(() => {
    if (!activeLoadout || !selectedEquip) return [];

    const baseEquipped = buildEquippedMap(activeLoadout, pool);
    const baseRate = calculateLoadoutResult(baseEquipped, activeLoadout, gameData).graduationRate;

    // Find which slot this equipment occupies
    const occupiedSlot = Object.entries(activeLoadout.equippedItems).find(([, id]) => id === selectedEquipId)?.[0];
    if (!occupiedSlot) return [];

    const existingStatTypes = new Set(selectedEquip.subStats.map((s) => s.type));
    const results: { fromStat: string; toStat: string; improvement: number }[] = [];

    for (let i = 0; i < selectedEquip.subStats.length; i++) {
      const currentSub = selectedEquip.subStats[i]!;
      const fromStat = currentSub.type;

      for (const targetStat of gameData.baseSubStats) {
        if (existingStatTypes.has(targetStat) && targetStat !== fromStat) continue;
        if (targetStat === fromStat) continue;

        const maxVal = gameData.maxValues[targetStat] ?? 0;
        if (maxVal <= 0) continue;

        const newSubStats = [...selectedEquip.subStats];
        newSubStats[i] = { type: targetStat, value: maxVal };
        const modifiedEquip: Equipment = { ...selectedEquip, subStats: newSubStats };

        const testEquipped = buildEquippedMap(activeLoadout, pool, { slot: occupiedSlot as keyof typeof activeLoadout.equippedItems, equipment: modifiedEquip });
        const newRate = calculateLoadoutResult(testEquipped, activeLoadout, gameData).graduationRate;
        results.push({ fromStat, toStat: targetStat, improvement: newRate - baseRate });
      }
    }

    return results.sort((a, b) => b.improvement - a.improvement);
  }, [activeLoadout, selectedEquip, selectedEquipId, pool, poolMap, gameData]);

  return (
    <Stack gap="sm">
      <Select
        size="xs"
        placeholder={t("transmutation.selectEquipment")}
        data={equipOptions}
        value={selectedEquipId}
        onChange={setSelectedEquipId}
        searchable
      />

      {!selectedEquip && <Text c="dimmed" size="sm">{t("transmutation.selectEquipment")}</Text>}

      {rerollOptions.map(({ fromStat, toStat, improvement }, i) => (
        <Card key={`${fromStat}-${toStat}-${i}`} withBorder p="xs">
          <Group justify="space-between">
            <div>
              <Text size="sm">
                {t("transmutation.rerollStat")}: {t(`statNames.${fromStat}`, { defaultValue: fromStat })} → {t("transmutation.targetStat")}: {t(`statNames.${toStat}`, { defaultValue: toStat })}
              </Text>
            </div>
            <Badge size="sm" color={improvement > 0 ? "green" : improvement < 0 ? "red" : "gray"}>
              {improvement > 0 ? "+" : ""}{improvement.toFixed(2)}%
            </Badge>
          </Group>
        </Card>
      ))}
    </Stack>
  );
}
