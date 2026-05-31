import {
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Equipment, GameData } from "@guild/shared/calculator/types";
import { getStatQuality } from "@guild/shared/calculator/engine";
import { useEquipmentCalcStore } from "@portal/stores/equipmentCalcStore";
import { getUniqueClassOptions } from "./class-label";

type Props = {
  opened: boolean;
  onClose: () => void;
  gameData: GameData;
  editEquipment?: Equipment;
};

function qualityColor(pct: number): string {
  if (pct >= 80) return "green";
  if (pct >= 50) return "yellow";
  return "red";
}

const EMPTY_SUB_STATS = [
  { type: "", value: 0 },
  { type: "", value: 0 },
  { type: "", value: 0 },
  { type: "", value: 0 },
];

export function EquipmentForm({ opened, onClose, gameData, editEquipment }: Props) {
  const { t, i18n } = useTranslation("equipCalc");
  const useEn = i18n.language.startsWith("en");
  const addEquipment = useEquipmentCalcStore((s) => s.addEquipment);
  const updateEquipment = useEquipmentCalcStore((s) => s.updateEquipment);

  const [slotId, setSlotId] = useState("");
  const [weaponTypeId, setWeaponTypeId] = useState("");
  const [name, setName] = useState("");
  const [isChengyin, setIsChengyin] = useState(false);
  const [isPurple, setIsPurple] = useState(false);
  const [mainStatType, setMainStatType] = useState("");
  const [mainStatValue, setMainStatValue] = useState<number>(0);
  const [subStats, setSubStats] = useState(EMPTY_SUB_STATS.map((s) => ({ ...s })));
  const [dingyinType, setDingyinType] = useState("");
  const [dingyinValue, setDingyinValue] = useState<number>(0);
  const [availableClasses, setAvailableClasses] = useState<string[]>([]);

  // Reset form state when modal opens or editEquipment changes
  useEffect(() => {
    if (!opened) return;
    if (editEquipment) {
      setSlotId(editEquipment.slotId);
      setWeaponTypeId(editEquipment.weaponTypeId ?? "");
      setName(editEquipment.name);
      setIsChengyin(editEquipment.isChengyin);
      setIsPurple(editEquipment.isPurple);
      setMainStatType(editEquipment.mainStat.type);
      setMainStatValue(editEquipment.mainStat.value);
      setSubStats(
        editEquipment.subStats.length > 0
          ? editEquipment.subStats.map((s) => ({ type: s.type, value: s.value }))
          : EMPTY_SUB_STATS.map((s) => ({ ...s })),
      );
      setDingyinType(editEquipment.dingyinStat.type);
      setDingyinValue(editEquipment.dingyinStat.value);
      setAvailableClasses(editEquipment.availableClasses ?? []);
    } else {
      setSlotId("");
      setWeaponTypeId("");
      setName("");
      setIsChengyin(false);
      setIsPurple(false);
      setMainStatType("");
      setMainStatValue(0);
      setSubStats(EMPTY_SUB_STATS.map((s) => ({ ...s })));
      setDingyinType("");
      setDingyinValue(0);
      setAvailableClasses([]);
    }
  }, [opened, editEquipment]);

  const slotOptions = gameData.slots.map((s) => ({ label: useEn ? s.nameEn : s.name, value: s.id }));
  const weaponOptions = gameData.weaponTypes.map((w) => ({ label: useEn ? w.nameEn : w.name, value: w.id }));
  const mainStatOptions = (gameData.slotRules.mainStats[slotId] ?? []).map((s) => ({ label: t(`statNames.${s}`, { defaultValue: s }), value: s }));
  const dingyinOptions = (gameData.slotRules.dingyinStats[slotId] ?? []).map((s) => ({ label: t(`statNames.${s}`, { defaultValue: s }), value: s }));
  const subStatOptions = gameData.baseSubStats.map((s) => ({ label: t(`statNames.${s}`, { defaultValue: s }), value: s }));
  const classOptions = getUniqueClassOptions(gameData.classes, availableClasses, t);

  function handleSave() {
    const filteredSubs = subStats.filter((s) => s.type && s.value > 0);
    const data = {
      name: name || `${slotId}-${Date.now()}`,
      slotId,
      weaponTypeId: slotId === "1" ? weaponTypeId : undefined,
      isChengyin,
      isPurple,
      mainStat: { type: mainStatType, value: mainStatValue },
      subStats: filteredSubs,
      dingyinStat: { type: dingyinType, value: dingyinValue },
      availableClasses: availableClasses.length > 0 ? availableClasses : undefined,
    };

    if (editEquipment) {
      updateEquipment(editEquipment.id, data);
    } else {
      addEquipment(data);
    }
    onClose();
  }

  function setMaxValue(statType: string, setter: (v: number) => void) {
    const max = gameData.maxValues[statType];
    if (max) setter(max);
  }

  const mainQuality = mainStatType ? getStatQuality(mainStatType, mainStatValue, gameData) : null;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editEquipment ? t("form.editTitle") : t("form.title")}
      size="lg"
      classNames={{ content: "ecm__form-modal", header: "ecm__form-modal-header", body: "ecm__form-modal-body", title: "ecm__form-modal-title" }}
      closeOnClickOutside={false}
      closeOnEscape
      centered
    >
      <Stack gap="xs" className="ecm__form-stack">
        <div className="ecm__form-row ecm__form-row--slot-name">
          <Select
            size="xs"
            label={t("form.slot")}
            data={slotOptions}
            value={slotId || null}
            onChange={(v) => setSlotId(v ?? "")}
          />
          <TextInput
            size="xs"
            label={t("form.name")}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Group gap="sm" className="ecm__form-checks">
            <Checkbox
              size="xs"
              label={t("pool.chengyin")}
              checked={isChengyin}
              onChange={(e) => setIsChengyin(e.currentTarget.checked)}
            />
            <Checkbox
              size="xs"
              label={t("pool.purple")}
              checked={isPurple}
              onChange={(e) => setIsPurple(e.currentTarget.checked)}
            />
          </Group>
        </div>

        {/* Weapon Type (only for weapon slot) */}
        {slotId === "1" && (
          <Select
            size="xs"
            label={t("form.weaponType")}
            data={weaponOptions}
            value={weaponTypeId || null}
            onChange={(v) => setWeaponTypeId(v ?? "")}
          />
        )}

        {/* Class Restriction */}
        <MultiSelect
          size="xs"
          label={t("form.classRestriction")}
          data={classOptions}
          value={availableClasses}
          onChange={setAvailableClasses}
          placeholder={t("form.allClasses")}
        />

        {/* Main Stat */}
        <Group align="end" gap="xs">
          <Select
            size="xs"
            label={t("form.mainStat")}
            data={mainStatOptions}
            value={mainStatType || null}
            onChange={(v) => setMainStatType(v ?? "")}
            style={{ flex: 1 }}
          />
          <NumberInput
            size="xs"
            label={t("form.value")}
            value={mainStatValue}
            onChange={(v) => setMainStatValue(typeof v === "number" ? v : 0)}
            min={0}
            hideControls
            style={{ flex: 1 }}
          />
          <Button
            size="xs"
            variant="light"
            onClick={() => setMaxValue(mainStatType, setMainStatValue)}
          >
            {t("form.maxBtn")}
          </Button>
          {mainQuality !== null && (
            <Badge color={qualityColor(mainQuality)}>
              {mainQuality.toFixed(0)}%
            </Badge>
          )}
        </Group>

        {/* Sub Stats */}
        <Text size="xs" fw={600}>{t("form.subStats")}</Text>
        {subStats.map((sub, i) => {
          const quality = sub.type ? getStatQuality(sub.type, sub.value, gameData) : null;
          return (
            <Group key={i} gap="xs" align="end">
              <Select
                size="xs"
                data={subStatOptions}
                value={sub.type || null}
                onChange={(v) => {
                  const next = [...subStats];
                  next[i] = { ...next[i], type: v ?? "" };
                  setSubStats(next);
                }}
                style={{ flex: 1 }}
                placeholder={t("form.statType")}
              />
              <NumberInput
                size="xs"
                value={sub.value}
                onChange={(v) => {
                  const next = [...subStats];
                  next[i] = { ...next[i], value: typeof v === "number" ? v : 0 };
                  setSubStats(next);
                }}
                min={0}
                hideControls
                style={{ flex: 1 }}
              />
              <Button
                size="xs"
                variant="light"
                onClick={() => {
                  const next = [...subStats];
                  const max = gameData.maxValues[next[i].type];
                  if (max) next[i] = { ...next[i], value: max };
                  setSubStats(next);
                }}
              >
                {t("form.maxBtn")}
              </Button>
              {quality !== null && (
                <Badge size="xs" color={qualityColor(quality)}>
                  {quality.toFixed(0)}%
                </Badge>
              )}
            </Group>
          );
        })}

        {/* Dingyin Stat */}
        <Group align="end" gap="xs">
          <Select
            size="xs"
            label={t("form.dingyin")}
            data={dingyinOptions}
            value={dingyinType || null}
            onChange={(v) => setDingyinType(v ?? "")}
            style={{ flex: 1 }}
          />
          <NumberInput
            size="xs"
            label={t("form.value")}
            value={dingyinValue}
            onChange={(v) => setDingyinValue(typeof v === "number" ? v : 0)}
            min={0}
            hideControls
            style={{ flex: 1 }}
          />
          <Button
            size="xs"
            variant="light"
            onClick={() => setMaxValue(dingyinType, setDingyinValue)}
          >
            {t("form.maxBtn")}
          </Button>
        </Group>

        {/* Actions */}
        <Group justify="flex-end" gap="xs" mt={2}>
          <Button size="xs" variant="subtle" onClick={onClose}>{t("form.cancel")}</Button>
          <Button size="xs" onClick={handleSave} disabled={!slotId}>{t("form.save")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
