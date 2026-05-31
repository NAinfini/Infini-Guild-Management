import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameData } from "@guild/shared/calculator/types";
import { useEquipmentCalcStore, useActiveLoadout } from "../../stores/equipmentCalcStore";
import { getUniqueClassOptions } from "./class-label";
import {
  PencilIcon,
  PlusIcon,
  TrashIcon,
  SwordIcon,
  TargetArrowIcon,
  ShieldIcon,
  SparklesIcon,
} from "@portal/components/icons";

type Props = { gameData: GameData };

const ARMORY_TYPES = ["通用", "鸣金", "裂石", "牵丝", "破竹"] as const;

const BOW_TYPES = ["precision", "crit", "intent"] as const;

function getClassArmoryType(classId: string): string {
  const armoryType = classId.substring(0, 2);
  return ARMORY_TYPES.includes(armoryType as (typeof ARMORY_TYPES)[number]) ? armoryType : "通用";
}

function getDefaultXinfaSlots(classId: string, gameData: GameData): string[] {
  const defaults = gameData.xinfaRules[classId]?.default ?? [];
  return [...defaults, "", "", "", ""].slice(0, 4);
}

export function LoadoutPanel({ gameData }: Props) {
  const { t } = useTranslation("equipCalc");

  const loadouts = useEquipmentCalcStore((s) => s.loadouts);
  const activeLoadoutId = useEquipmentCalcStore((s) => s.activeLoadoutId);
  const addLoadout = useEquipmentCalcStore((s) => s.addLoadout);
  const updateLoadout = useEquipmentCalcStore((s) => s.updateLoadout);
  const removeLoadout = useEquipmentCalcStore((s) => s.removeLoadout);
  const setActiveLoadout = useEquipmentCalcStore((s) => s.setActiveLoadout);

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [loanModalOpen, setLoanModalOpen] = useState(false);

  const activeLoadout = useActiveLoadout();

  const classOptions = useMemo(
    () => getUniqueClassOptions(gameData.classes, activeLoadout ? [activeLoadout.classId] : [], t),
    [activeLoadout, gameData.classes, t],
  );

  const armoryOptions = useMemo(
    () => ARMORY_TYPES.map((a) => ({ label: t(`armoryTypes.${a}`), value: a })),
    [t],
  );

  const bowOptions = useMemo(
    () => BOW_TYPES.map((b) => ({ label: t(`bowTypes.${b}`), value: b })),
    [t],
  );

  const setOptions = useMemo(
    () => Object.keys(gameData.setData).map((s) => ({ label: t(`setNames.${s}`, { defaultValue: s }), value: s })),
    [gameData.setData, t],
  );

  const loadoutSelectData = useMemo(
    () => loadouts.map((l) => ({ label: l.name, value: l.id })),
    [loadouts],
  );

  function handleAddLoadout() {
    const defaultClass = gameData.classes[0] ?? "";
    addLoadout(t("loadout.defaultName"), defaultClass, {
      armoryType: getClassArmoryType(defaultClass),
      setId: gameData.defaultSets[defaultClass] ?? "",
      xinfaSlots: getDefaultXinfaSlots(defaultClass, gameData),
    });
  }

  function handleStartRename() {
    if (!activeLoadout) return;
    setRenameValue(activeLoadout.name);
    setRenaming(true);
  }

  function handleConfirmRename() {
    if (!activeLoadout || !renameValue.trim()) return;
    updateLoadout(activeLoadout.id, { name: renameValue.trim() });
    setRenaming(false);
  }

  function handleDelete() {
    if (!activeLoadout) return;
    removeLoadout(activeLoadout.id);
  }

  return (
    <Stack gap="sm">
      {/* Header: loadout selector + actions */}
      <Group gap="xs">
        {renaming ? (
          <Group gap="xs" style={{ flex: 1 }}>
            <TextInput
              size="xs"
              value={renameValue}
              onChange={(e) => setRenameValue(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConfirmRename()}
              style={{ flex: 1 }}
            />
            <Button size="xs" onClick={handleConfirmRename}>OK</Button>
          </Group>
        ) : (
          <>
            <Text fw={600} size="sm">{t("loadout.title")}</Text>
            <Select
              size="xs"
              data={loadoutSelectData}
              value={activeLoadoutId}
              onChange={(v) => v && setActiveLoadout(v)}
              style={{ flex: 1 }}
              placeholder={t("loadout.selectPlaceholder")}
            />
          </>
        )}
        <ActionIcon size="sm" variant="subtle" onClick={handleAddLoadout} title={t("loadout.add")}>
          <PlusIcon size={14} />
        </ActionIcon>
        <ActionIcon size="sm" variant="subtle" onClick={handleStartRename} disabled={!activeLoadout} title={t("loadout.rename")}>
          <PencilIcon size={14} />
        </ActionIcon>
        <ActionIcon size="sm" variant="subtle" color="red" onClick={handleDelete} disabled={!activeLoadout} title={t("loadout.delete")}>
          <TrashIcon size={14} />
        </ActionIcon>
      </Group>

      {!activeLoadout && (
        <Text c="dimmed" size="sm" ta="center">{t("loadout.empty")}</Text>
      )}

      {activeLoadout && (
        <>
          {/* Class section */}
          <div className="ecm__config-section">
            <div className="ecm__config-section-label">
              <SwordIcon size={13} className="ecm__config-section-label__icon" />
              {t("loadout.class")}
            </div>
            <Select
              size="xs"
              data={classOptions}
              value={activeLoadout.classId}
              onChange={(v) => v && updateLoadout(activeLoadout.id, {
                classId: v,
                armoryType: getClassArmoryType(v),
                setId: gameData.defaultSets[v] ?? "",
                xinfaSlots: getDefaultXinfaSlots(v, gameData),
              })}
            />
          </div>

          <div className="ecm__config-divider" />

          {/* Combat config */}
          <div className="ecm__config-section">
            <div className="ecm__config-section-label">
              <TargetArrowIcon size={13} className="ecm__config-section-label__icon" />
              {t("panels.combat")}
            </div>
            <div className="ecm__config-row">
              <Select
                size="xs"
                label={t("loadout.armory")}
                data={armoryOptions}
                value={activeLoadout.armoryType}
                onChange={(v) => v && updateLoadout(activeLoadout.id, { armoryType: v })}
              />
              <Select
                size="xs"
                label={t("loadout.bowType")}
                data={bowOptions}
                value={activeLoadout.bowType}
                onChange={(v) => v && updateLoadout(activeLoadout.id, { bowType: v })}
              />
            </div>
          </div>

          <div className="ecm__config-divider" />

          {/* Set */}
          <div className="ecm__config-section">
            <div className="ecm__config-section-label">
              <ShieldIcon size={13} className="ecm__config-section-label__icon" />
              {t("loadout.set")}
            </div>
            <Select
              size="xs"
              data={setOptions}
              value={activeLoadout.setId}
              onChange={(v) => v != null && updateLoadout(activeLoadout.id, { setId: v })}
              clearable
            />
          </div>

          <div className="ecm__config-divider" />

          {/* Bonuses */}
          <div className="ecm__config-section">
            <div className="ecm__config-section-label">
              <SparklesIcon size={13} className="ecm__config-section-label__icon" />
              {t("panels.bonuses")}
            </div>
            <Stack gap="xs">
              <Checkbox
                size="xs"
                label={t("loadout.earlySeasonBonus")}
                checked={activeLoadout.earlySeasonBonus}
                onChange={(e) => updateLoadout(activeLoadout.id, { earlySeasonBonus: e.currentTarget.checked })}
              />
              <Group gap="xs" align="center">
                <Checkbox
                  size="xs"
                  label={t("loadout.loanDingyin")}
                  checked={activeLoadout.loanDingyin}
                  onChange={(e) => updateLoadout(activeLoadout.id, { loanDingyin: e.currentTarget.checked })}
                />
                {activeLoadout.loanDingyin && (
                  <Button size="compact-xs" variant="subtle" onClick={() => setLoanModalOpen(true)}>
                    {t("loadout.loanDingyinConfig")}
                  </Button>
                )}
              </Group>
            </Stack>
          </div>

          {/* Loan dingyin config modal */}
          <Modal
            opened={loanModalOpen}
            onClose={() => setLoanModalOpen(false)}
            title={t("loadout.loanDingyinConfig")}
            size="sm"
            classNames={{ content: "ecm__form-modal", header: "ecm__form-modal-header", body: "ecm__form-modal-body", title: "ecm__form-modal-title" }}
          >
            <Stack gap="xs" className="ecm__form-stack">
              <NumberInput
                size="xs"
                label={t("loadout.loanOuterPen")}
                value={activeLoadout.loanDingyinStats?.outerPenetration ?? 0}
                onChange={(v) => {
                  const val = typeof v === "number" ? v : 0;
                  updateLoadout(activeLoadout.id, {
                    loanDingyinStats: { ...(activeLoadout.loanDingyinStats ?? { outerPenetration: 0, elePenetration: 0, specificSkillBonus: 0 }), outerPenetration: val },
                  });
                }}
                step={0.1}
                decimalScale={1}
                min={0}
              />
              <NumberInput
                size="xs"
                label={t("loadout.loanElePen")}
                value={activeLoadout.loanDingyinStats?.elePenetration ?? 0}
                onChange={(v) => {
                  const val = typeof v === "number" ? v : 0;
                  updateLoadout(activeLoadout.id, {
                    loanDingyinStats: { ...(activeLoadout.loanDingyinStats ?? { outerPenetration: 0, elePenetration: 0, specificSkillBonus: 0 }), elePenetration: val },
                  });
                }}
                step={0.1}
                decimalScale={1}
                min={0}
              />
              <NumberInput
                size="xs"
                label={t("loadout.loanSpecificSkill")}
                value={activeLoadout.loanDingyinStats?.specificSkillBonus ?? 0}
                onChange={(v) => {
                  const val = typeof v === "number" ? v : 0;
                  updateLoadout(activeLoadout.id, {
                    loanDingyinStats: { ...(activeLoadout.loanDingyinStats ?? { outerPenetration: 0, elePenetration: 0, specificSkillBonus: 0 }), specificSkillBonus: val },
                  });
                }}
                step={0.1}
                decimalScale={1}
                min={0}
              />
              <Button size="xs" onClick={() => setLoanModalOpen(false)}>{t("form.save")}</Button>
            </Stack>
          </Modal>
        </>
      )}
    </Stack>
  );
}
