import { Badge, Card, Group, Stack, Text } from "@mantine/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Equipment, EquippedSlot, GameData } from "@guild/shared/calculator/types";
import { useEquipmentCalcStore, useActiveLoadout } from "../../stores/equipmentCalcStore";
import { buildEquippedMap, calculateLoadoutResult } from "./calculation";

type Props = { gameData: GameData };

const EQUIPPED_SLOTS: { slot: EquippedSlot; slotId: string }[] = [
  { slot: "weapon1", slotId: "1" }, { slot: "weapon2", slotId: "1" },
  { slot: "head", slotId: "5" }, { slot: "chest", slotId: "6" },
  { slot: "ring", slotId: "3" }, { slot: "pendant", slotId: "4" },
  { slot: "legs", slotId: "7" }, { slot: "hands", slotId: "8" },
];

export function CultivationTab({ gameData }: Props) {
  const { t, i18n } = useTranslation("equipCalc");
  const useEn = i18n.language.startsWith("en");
  const pool = useEquipmentCalcStore((s) => s.pool);
  const activeLoadout = useActiveLoadout();
  const poolMap = useMemo(() => new Map(pool.map((e) => [e.id, e])), [pool]);

  const slotAnalysis = useMemo(() => {
    if (!activeLoadout) return [];

    const baseEquipped = buildEquippedMap(activeLoadout, pool);
    const currentRate = calculateLoadoutResult(baseEquipped, activeLoadout, gameData).graduationRate;

    return EQUIPPED_SLOTS.map(({ slot, slotId }) => {
      const currentEquipId = activeLoadout.equippedItems[slot];
      const bestCandidate = pool
        .filter((e) => e.slotId === slotId)
        .filter((e) => !e.availableClasses?.length || e.availableClasses.includes(activeLoadout.classId))
        .reduce<{ equip: Equipment | null; rate: number }>((best, candidate) => {
          const testEquipped = buildEquippedMap(activeLoadout, pool, { slot, equipment: candidate });
          const rate = calculateLoadoutResult(testEquipped, activeLoadout, gameData).graduationRate;
          return rate > best.rate ? { equip: candidate, rate } : best;
        }, { equip: null, rate: 0 });

      const slotMeta = gameData.slots.find((s) => s.id === slotId);
      return {
        slot,
        label: slotMeta ? (useEn ? slotMeta.nameEn : slotMeta.name) : slot,
        currentRate,
        potentialRate: bestCandidate.rate,
        improvement: bestCandidate.rate - currentRate,
        bestEquipName: bestCandidate.equip?.name,
        currentEquipName: currentEquipId ? poolMap.get(currentEquipId)?.name : undefined,
      };
    })
    .sort((a, b) => b.improvement - a.improvement);
  }, [activeLoadout, pool, poolMap, gameData]);

  if (!activeLoadout) return <Text c="dimmed" size="sm" ta="center" py="xl">{t("loadout.required")}</Text>;

  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">{t("cultivation.upgradeNext")}</Text>
      {slotAnalysis.map(({ slot, label, currentRate, potentialRate, improvement, bestEquipName, currentEquipName }) => (
        <Card key={slot} withBorder p="xs">
          <Group justify="space-between">
            <div>
              <Text size="sm" fw={500}>{label}</Text>
              <Text size="xs" c="dimmed">
                {currentEquipName ?? t("loadout.emptySlot")} → {bestEquipName ?? "—"}
              </Text>
            </div>
            <div style={{ textAlign: "right" }}>
              <Text size="xs">{t("cultivation.currentRate")}: {currentRate.toFixed(1)}%</Text>
              <Text size="xs">{t("cultivation.potentialRate")}: {potentialRate.toFixed(1)}%</Text>
              <Badge size="sm" color={improvement > 0 ? "green" : "gray"}>
                {improvement > 0 ? "+" : ""}{improvement.toFixed(2)}%
              </Badge>
            </div>
          </Group>
        </Card>
      ))}
    </Stack>
  );
}
