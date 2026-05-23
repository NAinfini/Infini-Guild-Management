import { Button, NumberInput, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameData } from "@guild/shared/calculator/types";
import { useActiveLoadout } from "../../stores/equipmentCalcStore";
import { calculateManualEntryResult } from "./calculation";

type Props = { gameData: GameData };

export function ManualEntryTab({ gameData }: Props) {
  const { t } = useTranslation("equipCalc");
  const activeLoadout = useActiveLoadout();

  const [statValues, setStatValues] = useState<Record<string, number>>({});
  const [result, setResult] = useState<number | null>(null);

  const updateStat = useCallback((stat: string, value: number | string) => {
    setStatValues((prev) => ({ ...prev, [stat]: typeof value === "string" ? 0 : value }));
  }, []);

  const handleCalculate = useCallback(() => {
    if (!activeLoadout) return;
    const { graduationRate } = calculateManualEntryResult(statValues, activeLoadout, gameData);
    setResult(graduationRate);
  }, [statValues, gameData, activeLoadout]);

  return (
    <Stack gap="sm">
      <div>
        <Title order={5}>{t("manualEntry.title")}</Title>
        <Text size="xs" c="dimmed">{t("manualEntry.description")}</Text>
      </div>

      <SimpleGrid cols={2} spacing="xs">
        {gameData.baseSubStats.map((stat) => (
          <NumberInput
            key={stat}
            label={t(`statNames.${stat}`, { defaultValue: stat })}
            size="xs"
            min={0}
            max={gameData.maxValues[stat] ?? 99999}
            value={statValues[stat] ?? 0}
            onChange={(v) => updateStat(stat, v)}
            hideControls
          />
        ))}
      </SimpleGrid>

      <Button size="xs" onClick={handleCalculate}>{t("manualEntry.calculate")}</Button>

      {result !== null && (
        <Text size="lg" fw={700}>
          {t("stats.graduationRate")}: {result.toFixed(1)}%
        </Text>
      )}
    </Stack>
  );
}
