import { Alert, Button, Group, Loader, Modal, Stack, Text, Textarea, Tooltip } from "@mantine/core";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@portal/api/query-keys";
import { fetchGameData, fetchGameDataRotation } from "@portal/services/GameDataService";
import { useEquipmentCalcStore, useActiveLoadout } from "@portal/stores/equipmentCalcStore";
import type { GameData, EquippedSlot } from "@guild/shared/calculator/types";
import type { GameDataBaseInput } from "@guild/shared/schemas/equipment-calc";
import {
  SwordIcon,
  CrownIcon,
  ShieldIcon,
  RingsIcon,
  PendantIcon,
  BootIcon,
  GauntletIcon,
  ChartBarIcon,
  AdjustmentsIcon,
} from "@portal/components/icons";
import { IconBackpack, IconFileExport, IconFileImport } from "@tabler/icons-react";
import { calculateTotal, calculateGraduationRate, capRates } from "@guild/shared/calculator/engine";
import type { CappedStats } from "@guild/shared/calculator/types";
import { GraduationBanner } from "./GraduationBanner";
import { StatsDisplay } from "./StatsDisplay";
import "./EquipmentCalcModal.css";

const LazyEquipmentPool = lazy(() =>
  import("./EquipmentPool").then((mod) => ({ default: mod.EquipmentPool })),
);
const LazyLoadoutPanel = lazy(() =>
  import("./LoadoutPanel").then((mod) => ({ default: mod.LoadoutPanel })),
);
const LazyAnalysisTabs = lazy(() =>
  import("./AnalysisTabs").then((mod) => ({ default: mod.AnalysisTabs })),
);

type EquipmentCalcModalProps = {
  opened: boolean;
  onClose: () => void;
};

type PanelId = "pool" | "config" | "analysis";

type SlotIconComponent = typeof SwordIcon;

const SLOT_ICONS: Record<EquippedSlot, SlotIconComponent> = {
  weapon1: SwordIcon,
  weapon2: SwordIcon,
  head: CrownIcon,
  chest: ShieldIcon,
  ring: RingsIcon,
  pendant: PendantIcon,
  legs: BootIcon,
  hands: GauntletIcon,
};

const ARMORY_TYPES = ["通用", "鸣金", "裂石", "牵丝", "破竹"] as const;

function getClassArmoryType(classId: string): string {
  const armoryType = classId.substring(0, 2);
  return ARMORY_TYPES.includes(armoryType as (typeof ARMORY_TYPES)[number]) ? armoryType : "通用";
}

function getDefaultXinfaSlots(classId: string, gameData: GameDataBaseInput): string[] {
  const defaults = gameData.xinfaRules[classId]?.default ?? [];
  return [...defaults, "", "", "", ""].slice(0, 4);
}

export function EquipmentCalcModal({ opened, onClose }: EquipmentCalcModalProps) {
  const { t } = useTranslation("equipCalc");
  const migrateSchema = useEquipmentCalcStore((s) => s.migrateSchema);
  const localSchemaVersion = useEquipmentCalcStore((s) => s.schemaVersion);
  const exportData = useEquipmentCalcStore((s) => s.exportData);
  const importData = useEquipmentCalcStore((s) => s.importData);
  const pool = useEquipmentCalcStore((s) => s.pool);
  const loadouts = useEquipmentCalcStore((s) => s.loadouts);
  const activeLoadoutId = useEquipmentCalcStore((s) => s.activeLoadoutId);
  const unequipSlot = useEquipmentCalcStore((s) => s.unequipSlot);
  const addLoadout = useEquipmentCalcStore((s) => s.addLoadout);
  const setActiveLoadout = useEquipmentCalcStore((s) => s.setActiveLoadout);

  const [activePanel, setActivePanel] = useState<PanelId | null>("pool");
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const {
    data: rawGameData,
    isError,
  } = useQuery({
    queryKey: queryKeys.gameData.latest(),
    queryFn: fetchGameData,
    enabled: opened,
  });

  const baseGameData = rawGameData?.data;
  const serverSchemaVersion = rawGameData?.schemaVersion;
  const dataVersion = rawGameData?.version ?? baseGameData?.version;

  useEffect(() => {
    if (serverSchemaVersion != null && serverSchemaVersion > localSchemaVersion) {
      migrateSchema(serverSchemaVersion);
    }
  }, [serverSchemaVersion, localSchemaVersion, migrateSchema]);

  useEffect(() => {
    if (!opened || !baseGameData) return;

    const hasActiveLoadout = activeLoadoutId == null ||
      loadouts.some((loadout) => loadout.id === activeLoadoutId);
    if (loadouts.length > 0 && !hasActiveLoadout) {
      setActiveLoadout(loadouts[0]!.id);
      return;
    }
    if (loadouts.length > 0) return;

    const defaultClass = baseGameData.classes[0] ?? "";
    if (!defaultClass) return;

    addLoadout(t("loadout.defaultName"), defaultClass, {
      armoryType: getClassArmoryType(defaultClass),
      setId: baseGameData.defaultSets[defaultClass] ?? "",
      xinfaSlots: getDefaultXinfaSlots(defaultClass, baseGameData),
    });
  }, [activeLoadoutId, addLoadout, baseGameData, loadouts, opened, setActiveLoadout, t]);

  const togglePanel = useCallback((id: PanelId) => {
    setActivePanel((cur) => (cur === id ? null : id));
  }, []);

  const activeLoadout = useActiveLoadout();
  const activeClassId = activeLoadout?.classId;

  // Rotations are ~58% of the game data and only one class is ever calculated,
  // so they are fetched per class instead of with the base payload. No
  // placeholder from the previous class: showing the old rotation's numbers
  // under a new class would be wrong rather than merely stale.
  const {
    data: rotationData,
    isError: rotationError,
  } = useQuery({
    queryKey: queryKeys.gameData.rotation(activeClassId ?? ""),
    queryFn: () => fetchGameDataRotation(activeClassId!),
    enabled: opened && !!activeClassId,
  });

  // The calculator engine takes a whole GameData, so the one fetched rotation is
  // merged back in. `rotations` stays empty until it arrives; the engine returns
  // a 0% graduation rate in that case, so `rotationPending` below hides the rate
  // display rather than presenting that 0 as a result.
  const gameData: GameData | undefined = useMemo(() => {
    if (!baseGameData) return undefined;
    const rotations = activeClassId && rotationData ? { [activeClassId]: rotationData.rotation } : {};
    return { ...baseGameData, rotations };
  }, [baseGameData, activeClassId, rotationData]);

  const rotationPending = !!activeClassId && !rotationData && !rotationError;

  const poolMap = useMemo(() => new Map(pool.map((e) => [e.id, e])), [pool]);

  const equippedMap = useMemo(() => {
    if (!activeLoadout) return {};
    const map: Record<string, import("@guild/shared/calculator/types").Equipment | undefined> = {};
    for (const [slot, id] of Object.entries(activeLoadout.equippedItems)) {
      if (id) map[slot] = poolMap.get(id);
    }
    return map;
  }, [activeLoadout, poolMap]);

  const { stats, graduationRate, expectedDps, excelRate, capped } = useMemo(() => {
    if (!activeLoadout || !gameData) {
      return {
        stats: {} as Record<string, number>,
        graduationRate: 0,
        expectedDps: 0,
        excelRate: 0,
        capped: { actualPrecision: 0, actualCrit: 0, actualIntent: 0, precisionOverflow: 0, critOverflow: 0, intentOverflow: 0 } as CappedStats,
      };
    }
    const totalStats = calculateTotal(
      equippedMap,
      activeLoadout.classId,
      activeLoadout.bowType,
      activeLoadout.xinfaSlots,
      activeLoadout.setId,
      activeLoadout.earlySeasonBonus,
      activeLoadout.loanDingyin,
      activeLoadout.loanDingyinStats,
      activeLoadout.armoryType,
      gameData,
    );
    const result = calculateGraduationRate(totalStats, activeLoadout.classId, activeLoadout.xinfaSlots, activeLoadout.setId, gameData);
    const cappedStats = capRates(totalStats);
    return {
      stats: totalStats,
      graduationRate: result.graduationRate,
      expectedDps: result.expectedDps,
      excelRate: result.excelRate,
      capped: cappedStats,
    };
  }, [activeLoadout, equippedMap, gameData]);

  function handleExport() {
    const json = exportData();
    navigator.clipboard.writeText(json).catch(() => {});
  }

  function handleImport() {
    setImportJson("");
    setImportError(null);
    setImportOpen(true);
  }

  function handleSubmitImport() {
    const success = importData(importJson);
    if (success) {
      setImportOpen(false);
      setImportJson("");
      setImportError(null);
      return;
    }
    setImportError(t("actions.importError", { defaultValue: "Invalid import data" }));
  }

  const suspenseFallback = (
    <Stack align="center" justify="center" p="xl">
      <Loader size="sm" />
    </Stack>
  );
  const loadErrorTitle = t("errors.loadTitle", { defaultValue: "Unable to load calculator data" });
  const loadErrorBody = t("errors.loadBody", {
    defaultValue: "The stored calculator data is out of date. The server will use the bundled reference data.",
  });
  const rotationErrorBody = t("errors.rotationBody", { className: activeClassId ?? "" });

  const activityItems: { id: PanelId; icon: React.ReactNode; label: string }[] = [
    { id: "pool", icon: <IconBackpack size={20} />, label: t("panels.pool") },
    { id: "config", icon: <AdjustmentsIcon size={20} />, label: t("panels.config") },
    { id: "analysis", icon: <ChartBarIcon size={20} />, label: t("panels.analysis") },
  ];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="85vw"
      title={t("title")}
      styles={{
        content: { height: "85vh", maxHeight: "85vh", display: "flex", flexDirection: "column" },
        body: { flex: 1, padding: 0, overflow: "hidden" },
      }}
      centered
    >
      {!gameData && !isError && (
        <Stack align="center" justify="center" h="100%">
          <Loader size="lg" />
        </Stack>
      )}

      {isError && (
        <Alert color="red" title={loadErrorTitle} m="md">
          {loadErrorBody}
        </Alert>
      )}

      {gameData && (
        <div className="ecm">
          {/* Top bar */}
          <div className="ecm__topbar">
            <Group gap="xs" px="md" py={4}>
              <Button variant="subtle" size="xs" leftSection={<IconFileExport size={14} />} onClick={handleExport}>
                {t("actions.export")}
              </Button>
              <Button variant="subtle" size="xs" leftSection={<IconFileImport size={14} />} onClick={handleImport}>
                {t("actions.import")}
              </Button>
            </Group>
            {dataVersion ? (
              <Group gap={6} px="md" py={4} className="ecm__data-version">
                <Text size="xs" c="dimmed" fw={700}>{t("dataVersion")}</Text>
                <Text size="xs" c="dimmed" title={dataVersion}>{dataVersion}</Text>
              </Group>
            ) : null}
          </div>

          {/* Body: activity bar + side panel + main */}
          <div className="ecm__body">
            {/* Activity bar */}
            <div className="ecm__activity-bar">
              {activityItems.map(({ id, icon, label }) => {
                const isActive = activePanel === id;
                return (
                  <Tooltip key={id} label={label} position="right" withArrow>
                    <button
                      type="button"
                      className={`ecm__activity-btn${isActive ? " ecm__activity-btn--active" : ""}`}
                      onClick={() => togglePanel(id)}
                      aria-label={label}
                    >
                      {icon}
                    </button>
                  </Tooltip>
                );
              })}
            </div>

            {/* Side panel */}
            <div className={`ecm__side-panel${activePanel == null ? " ecm__side-panel--collapsed" : ""}`}>
              {activePanel === "pool" && (
                <Suspense fallback={suspenseFallback}>
                  <LazyEquipmentPool gameData={gameData} />
                </Suspense>
              )}
              {activePanel === "config" && (
                <Suspense fallback={suspenseFallback}>
                  <LazyLoadoutPanel gameData={gameData} />
                </Suspense>
              )}
              {activePanel === "analysis" && (
                // Every analysis tab compares graduation rates, so none of them
                // mean anything until the active class's rotation is in hand.
                rotationPending ? suspenseFallback : rotationError ? (
                  <Alert color="red" title={loadErrorTitle} m="md">{rotationErrorBody}</Alert>
                ) : (
                  <Suspense fallback={suspenseFallback}>
                    <LazyAnalysisTabs gameData={gameData} />
                  </Suspense>
                )
              )}
            </div>

            {/* Main area */}
            <div className="ecm__main">
              <div className="ecm__workspace">
                <section className="ecm__workspace__board">
                  <div className="ecm__section-header">
                    <Text size="xs" fw={700} c="dimmed" tt="uppercase">{t("workspace.equipment")}</Text>
                  </div>
                  <div className="ecm__paperdoll">
                    <div className="ecm__paperdoll-row">
                      {(["weapon1", "weapon2", "head", "chest"] as EquippedSlot[]).map((slot) => {
                        const equipId = activeLoadout?.equippedItems[slot];
                        const equip = equipId ? poolMap.get(equipId) : undefined;
                        const SlotIcon = SLOT_ICONS[slot];
                        const filled = !!equip;
                        return (
                          <button key={slot} type="button" className={`ecm__equip-slot${filled ? " ecm__equip-slot--filled" : ""}`}
                            onClick={() => equipId && unequipSlot(slot)}
                            title={filled ? t("loadout.unequip") : t(`loadout.slots.${slot}`)}>
                            <div className="ecm__equip-slot__icon-wrap"><SlotIcon size={20} /></div>
                            <span className="ecm__equip-slot__label">{equip ? equip.name : t(`loadout.slots.${slot}`)}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="ecm__paperdoll-row">
                      {(["ring", "pendant", "legs", "hands"] as EquippedSlot[]).map((slot) => {
                        const equipId = activeLoadout?.equippedItems[slot];
                        const equip = equipId ? poolMap.get(equipId) : undefined;
                        const SlotIcon = SLOT_ICONS[slot];
                        const filled = !!equip;
                        return (
                          <button key={slot} type="button" className={`ecm__equip-slot${filled ? " ecm__equip-slot--filled" : ""}`}
                            onClick={() => equipId && unequipSlot(slot)}
                            title={filled ? t("loadout.unequip") : t(`loadout.slots.${slot}`)}>
                            <div className="ecm__equip-slot__icon-wrap"><SlotIcon size={20} /></div>
                            <span className="ecm__equip-slot__label">{equip ? equip.name : t(`loadout.slots.${slot}`)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>

                <aside className="ecm__workspace__insights">
                  <div className="ecm__section-header">
                    <Text size="xs" fw={700} c="dimmed" tt="uppercase">{t("workspace.statsOverview")}</Text>
                  </div>
                  {rotationError ? (
                    <Alert color="red" title={loadErrorTitle}>{rotationErrorBody}</Alert>
                  ) : (
                    // A 0% rate and a not-yet-loaded rotation look identical, so
                    // the banner waits instead of publishing a meaningless zero.
                    <GraduationBanner
                      graduationRate={rotationPending ? null : graduationRate}
                      expectedDps={rotationPending ? null : expectedDps}
                      excelRate={rotationPending ? null : excelRate}
                    />
                  )}
                  {gameData && <StatsDisplay stats={stats} gameData={gameData} capped={capped} />}
                </aside>
              </div>
            </div>
          </div>
        </div>
      )}

      <Modal
        opened={importOpen}
        onClose={() => {
          setImportOpen(false);
          setImportError(null);
        }}
        title={t("importModal.title", { defaultValue: "Import data" })}
        size="md"
        classNames={{ content: "ecm__form-modal", header: "ecm__form-modal-header", body: "ecm__form-modal-body", title: "ecm__form-modal-title" }}
        centered
      >
        <Stack gap="xs" className="ecm__form-stack">
          <div>{t("importModal.description", { defaultValue: "Paste exported calculator JSON here." })}</div>
          <Textarea
            size="xs"
            minRows={8}
            autosize
            value={importJson}
            onChange={(event) => {
              setImportJson(event.currentTarget.value);
              if (importError) setImportError(null);
            }}
            placeholder={t("importModal.placeholder", { defaultValue: "Paste JSON" })}
          />
          {importError && <Alert color="red" title={t("importModal.errorTitle", { defaultValue: "Import failed" })}>{importError}</Alert>}
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setImportOpen(false)}>
              {t("actions.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button size="xs" onClick={handleSubmitImport}>
              {t("importModal.confirm", { defaultValue: "Import" })}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Modal>
  );
}
