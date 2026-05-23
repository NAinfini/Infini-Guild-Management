import { Badge, Card, Group, Stack, Text, Title } from "@mantine/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { GameData } from "@guild/shared/calculator/types";
import { useEquipmentCalcStore, useActiveLoadout } from "../../stores/equipmentCalcStore";
import { buildEquippedMap, calculateLoadoutResult, calculateRateWithStatAdjustment } from "./calculation";

type Props = { gameData: GameData };

export function PriorityTab({ gameData }: Props) {
  const { t } = useTranslation("equipCalc");
  const pool = useEquipmentCalcStore((s) => s.pool);
  const activeLoadout = useActiveLoadout();

  const { addResults, loseResults } = useMemo(() => {
    if (!activeLoadout) return { baseRate: 0, addResults: [], loseResults: [] };

    const equipped = buildEquippedMap(activeLoadout, pool);
    const base = calculateLoadoutResult(equipped, activeLoadout, gameData).graduationRate;

    const addResults: { stat: string; delta: number }[] = [];
    const loseResults: { stat: string; delta: number }[] = [];

    for (const stat of gameData.baseSubStats) {
      const maxRoll = gameData.maxValues[stat] ?? 0;
      if (maxRoll <= 0) continue;

      const addDelta = calculateRateWithStatAdjustment(equipped, activeLoadout, stat, maxRoll, gameData) - base;
      addResults.push({ stat, delta: addDelta });

      const loseDelta = calculateRateWithStatAdjustment(equipped, activeLoadout, stat, -maxRoll, gameData) - base;
      loseResults.push({ stat, delta: loseDelta });
    }

    addResults.sort((a, b) => b.delta - a.delta);
    loseResults.sort((a, b) => a.delta - b.delta);

    return { baseRate: base, addResults, loseResults };
  }, [activeLoadout, pool, gameData]);

  if (!activeLoadout) return <Text c="dimmed" size="sm" ta="center" py="xl">{t("loadout.required")}</Text>;

  return (
    <Stack gap="md">
      <div>
        <Title order={5} mb="xs">{t("priority.addMaxRoll")}</Title>
        {addResults.map(({ stat, delta }) => (
          <Card key={stat} withBorder p="xs" mb={4}>
            <Group justify="space-between">
              <Text size="sm">{t(`statNames.${stat}`, { defaultValue: stat })}</Text>
              <Badge size="sm" color={delta > 0 ? "green" : "gray"}>
                +{delta.toFixed(2)}% {t("priority.gives")}
              </Badge>
            </Group>
          </Card>
        ))}
      </div>

      <div>
        <Title order={5} mb="xs">{t("priority.loseMaxRoll")}</Title>
        {loseResults.map(({ stat, delta }) => (
          <Card key={stat} withBorder p="xs" mb={4}>
            <Group justify="space-between">
              <Text size="sm">{t(`statNames.${stat}`, { defaultValue: stat })}</Text>
              <Badge size="sm" color={delta < 0 ? "red" : "gray"}>
                {delta.toFixed(2)}% {t("priority.costs")}
              </Badge>
            </Group>
          </Card>
        ))}
      </div>
    </Stack>
  );
}
