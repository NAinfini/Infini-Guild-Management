import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Progress,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import type { BuildResult, EquippedSlot, GameData } from "@guild/shared/calculator/types";
import type { BestBuildConfig } from "@guild/shared/calculator/best-build";
import { useEquipmentCalcStore, useActiveLoadout } from "@portal/stores/equipmentCalcStore";

const EQUIPPED_SLOTS: EquippedSlot[] = [
  "weapon1",
  "weapon2",
  "head",
  "chest",
  "ring",
  "pendant",
  "legs",
  "hands",
];

function slotDisplayName(
  slot: EquippedSlot,
  gameData: GameData,
  lang: string,
): string {
  const useEn = lang.startsWith("en");
  const slotIdMap: Record<EquippedSlot, string> = {
    weapon1: "1",
    weapon2: "1",
    head: "5",
    chest: "6",
    ring: "3",
    pendant: "4",
    legs: "7",
    hands: "8",
  };
  const slotDef = gameData.slots.find((s) => s.id === slotIdMap[slot]);
  const baseName = slotDef ? (useEn ? slotDef.nameEn : slotDef.name) : slot;
  if (slot === "weapon1") return `${baseName} 1`;
  if (slot === "weapon2") return `${baseName} 2`;
  return baseName;
}

type WorkerMessage =
  | { type: "progress"; percent: number }
  | { type: "result"; results: BuildResult[] }
  | { type: "error"; message: string };

export function BestBuildTab({ gameData }: { gameData: GameData }) {
  const { t, i18n } = useTranslation("equipCalc");
  const pool = useEquipmentCalcStore((s) => s.pool);
  const updateLoadout = useEquipmentCalcStore((s) => s.updateLoadout);
  const loadout = useActiveLoadout();

  const [lockedSlots, setLockedSlots] = useState<Set<EquippedSlot>>(new Set());
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<BuildResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const toggleLock = useCallback((slot: EquippedSlot) => {
    setLockedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot);
      else next.add(slot);
      return next;
    });
  }, []);

  const startSearch = useCallback(() => {
    if (!loadout) return;

    // Terminate any existing worker
    workerRef.current?.terminate();

    setSearching(true);
    setProgress(0);
    setResults([]);
    setError(null);

    const worker = new Worker(
      new URL("../../workers/bestBuildWorker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      switch (msg.type) {
        case "progress":
          setProgress(msg.percent);
          break;
        case "result":
          setResults(msg.results);
          setSearching(false);
          break;
        case "error":
          setError(msg.message);
          setSearching(false);
          break;
      }
    };

    worker.onerror = (ev) => {
      setError(ev.message || "Worker error");
      setSearching(false);
    };

    const locked: Partial<Record<EquippedSlot, string>> = {};
    for (const slot of lockedSlots) {
      const equipId = loadout.equippedItems[slot];
      if (equipId) locked[slot] = equipId;
    }

    const config: Omit<BestBuildConfig, "onProgress" | "signal"> = {
      pool,
      loadout,
      lockedSlots: locked,
      gameData,
    };

    worker.postMessage({ type: "search", config });
  }, [loadout, lockedSlots, pool, gameData]);

  const cancelSearch = useCallback(() => {
    workerRef.current?.postMessage({ type: "cancel" });
    workerRef.current?.terminate();
    workerRef.current = null;
    setSearching(false);
  }, []);

  const applyBuild = useCallback(
    (build: BuildResult) => {
      if (!loadout) return;
      updateLoadout(loadout.id, { equippedItems: build.equippedItems });
    },
    [loadout, updateLoadout],
  );

  const equipNameById = useCallback(
    (id: string) => pool.find((e) => e.id === id)?.name ?? id,
    [pool],
  );

  if (!loadout) return <Text c="dimmed" size="sm" ta="center" py="xl">{t("loadout.required")}</Text>;

  return (
    <Stack gap="md">
      {/* Slot lock checkboxes */}
      <div>
        <Text fw={600} size="sm" mb={4}>
          {t("bestBuild.lockSlot")}
        </Text>
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
          {EQUIPPED_SLOTS.map((slot) => {
            const hasEquip = !!loadout.equippedItems[slot];
            return (
              <Checkbox
                key={slot}
                label={slotDisplayName(slot, gameData, i18n.language)}
                checked={lockedSlots.has(slot)}
                onChange={() => toggleLock(slot)}
                disabled={!hasEquip || searching}
              />
            );
          })}
        </SimpleGrid>
      </div>

      {/* Search / Cancel buttons */}
      <Group gap="sm">
        {searching ? (
          <Button color="red" onClick={cancelSearch}>
            {t("bestBuild.cancel")}
          </Button>
        ) : (
          <Button onClick={startSearch}>
            {t("bestBuild.find")}
          </Button>
        )}
      </Group>

      {/* Progress bar */}
      {searching && (
        <div>
          <Text size="xs" c="dimmed" mb={4}>
            {t("bestBuild.progress")}: {progress}%
          </Text>
          <Progress value={progress} size="sm" animated />
        </div>
      )}

      {/* Error */}
      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      {/* Results */}
      {!searching && results.length === 0 && !error && progress > 0 && (
        <Text c="dimmed" ta="center" py="md">
          {t("bestBuild.noResults")}
        </Text>
      )}

      {results.length > 0 && (
        <div>
          <Text fw={600} size="sm" mb="xs">
            {t("bestBuild.topBuilds")}
          </Text>
          <Stack gap="sm">
            {results.map((build, idx) => (
              <Card key={`${build.graduationRate}-${build.dps}-${idx}`} withBorder padding="sm">
                <Group justify="space-between" mb="xs">
                  <Group gap="xs">
                    <Badge variant="light" color="blue" size="lg">
                      #{idx + 1}
                    </Badge>
                    <Text fw={600} size="sm">
                      {t("stats.graduationRate")}: {build.graduationRate.toFixed(1)}%
                    </Text>
                    <Text size="sm" c="dimmed">
                      DPS: {Math.round(build.dps).toLocaleString()}
                    </Text>
                  </Group>
                  <Button size="xs" variant="light" onClick={() => applyBuild(build)}>
                    {t("bestBuild.apply")}
                  </Button>
                </Group>
                <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
                  {EQUIPPED_SLOTS.map((slot) => {
                    const equipId = build.equippedItems[slot];
                    if (!equipId) return null;
                    return (
                      <Text key={slot} size="xs">
                        <Text span fw={600} size="xs">
                          {slotDisplayName(slot, gameData, i18n.language)}:
                        </Text>{" "}
                        {equipNameById(equipId)}
                      </Text>
                    );
                  })}
                </SimpleGrid>
              </Card>
            ))}
          </Stack>
        </div>
      )}
    </Stack>
  );
}
