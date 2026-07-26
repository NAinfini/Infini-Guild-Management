import { Badge, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { getStatQuality } from "@guild/shared/calculator/engine";
import type { Equipment, GameData } from "@guild/shared/calculator/types";
import {
  SwordIcon,
  CrownIcon,
  ShieldIcon,
  RingsIcon,
  PendantIcon,
  BootIcon,
  GauntletIcon,
} from "@portal/components/icons";

type EquipmentCardProps = {
  equipment: Equipment;
  gameData: GameData;
  isEquipped?: boolean;
  onClick?: () => void;
};

const SLOT_ICON_MAP: Record<string, typeof SwordIcon> = {
  "1": SwordIcon,
  "3": RingsIcon,
  "4": PendantIcon,
  "5": CrownIcon,
  "6": ShieldIcon,
  "7": BootIcon,
  "8": GauntletIcon,
};

function qualityLevel(quality: number): "high" | "mid" | "low" {
  if (quality >= 80) return "high";
  if (quality >= 50) return "mid";
  return "low";
}

function qualityBadgeColor(quality: number): string {
  if (quality >= 80) return "green";
  if (quality >= 50) return "yellow";
  return "red";
}

export function EquipmentCard({ equipment, gameData, isEquipped, onClick }: EquipmentCardProps) {
  const { t } = useTranslation("equipCalc");
  const SlotIcon = SLOT_ICON_MAP[equipment.slotId] ?? ShieldIcon;

  return (
    <div
      className={`ecm__equip-card${isEquipped ? " ecm__equip-card--equipped" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(); } : undefined}
    >
      {/* Header: slot icon + name + badges */}
      <div className="ecm__equip-card__header">
        <div className="ecm__equip-card__slot-icon">
          <SlotIcon size={16} />
        </div>
        <span className="ecm__equip-card__name">{equipment.name}</span>
        <div className="ecm__equip-card__badges">
          {equipment.isChengyin && (
            <Badge size="xs" color="portal-copper" variant="light">{t("pool.chengyin")}</Badge>
          )}
          {equipment.isPurple && (
            <Badge size="xs" color="violet" variant="light">{t("pool.purple")}</Badge>
          )}
          {isEquipped && (
            <Badge size="xs" color="portal-gold" variant="filled">{t("pool.equipped")}</Badge>
          )}
        </div>
      </div>

      {/* Main stat */}
      <div className="ecm__equip-card__main-stat">
        <Text size="xs" c="dimmed">{t(`statNames.${equipment.mainStat.type}`, { defaultValue: equipment.mainStat.type })}</Text>
        <Text size="xs" fw={600}>{equipment.mainStat.value}</Text>
      </div>

      {/* Sub stats with quality dots */}
      <div className="ecm__equip-card__sub-stats">
        {equipment.subStats.map((sub, idx) => {
          const quality = getStatQuality(sub.type, sub.value, gameData);
          const level = qualityLevel(quality);
          return (
            <div key={idx} className="ecm__equip-card__sub-row">
              <div className="ecm__equip-card__quality-bar">
                <div className={`ecm__equip-card__quality-fill ecm__equip-card__quality-fill--${level}`}
                  style={{ width: `${Math.min(quality, 100)}%` }} />
              </div>
              <Text size="xs" c="dimmed" style={{ flex: 1 }}>{t(`statNames.${sub.type}`, { defaultValue: sub.type })}</Text>
              <Text size="xs" fw={500}>{sub.value}</Text>
              <Badge size="xs" variant="light" color={qualityBadgeColor(quality)}>
                {quality.toFixed(0)}%
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}
