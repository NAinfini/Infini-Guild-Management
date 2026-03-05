import type { WarHistory } from "@guild/shared";
import { InfiniCard, NumberTicker } from "@infini-dev-kit/frontend/components";
import { ActionIcon, Avatar, Text } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CrownOutlined,
  GoToOutlined,
  LeftOutlined,
  RightOutlined,
  ShieldOutlined,
  SwordsOutlined,
  TargetOutlined,
  TrophyOutlined,
} from "../../utils/icons";
import { IconFlame, IconHeart, IconHammer } from "@tabler/icons-react";
import { EmptyState } from "../shared/EmptyState";
import { cardHeading, formatDateTime, type DashboardLastWarMvp, type DashboardLastWarMvpEntry } from "./shared";

type LastWarCardProps = {
  recentWars: WarHistory[];
  warMvps: DashboardLastWarMvp[];
  isExternalView: boolean;
  onOpenHistory: (warName: string) => void;
};

function resultColor(result: string | null): string {
  if (result === "win") return "var(--infini-color-success, #22c55e)";
  if (result === "loss") return "var(--infini-color-danger, #ef4444)";
  if (result === "draw") return "var(--infini-color-warning, #f59e0b)";
  return "color-mix(in srgb, var(--infini-color-text, #111827) 50%, transparent)";
}

function resultLabel(result: string | null, t: (key: string) => string): string {
  if (result === "win") return t("card.lastWar.result.victory");
  if (result === "loss") return t("card.lastWar.result.defeat");
  if (result === "draw") return t("card.lastWar.result.draw");
  return t("card.lastWar.result.pending");
}

function CompareBar({
  icon,
  label,
  own,
  enemy,
}: {
  icon: React.ReactNode;
  label: string;
  own: number;
  enemy: number;
}) {
  const total = own + enemy || 1;
  const ownPct = Math.round((own / total) * 100);
  const enemyPct = 100 - ownPct;

  return (
    <div className="war-compare-row">
      <div className="war-compare-label">
        <span className="war-compare-label-icon">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="war-compare-bar-wrap">
        <span className="war-compare-val war-compare-val--left">{own.toLocaleString()}</span>
        <div className="war-compare-bar">
          <div
            className={`war-compare-bar-fill war-compare-bar-fill--own${ownPct >= enemyPct ? " war-compare-bar-fill--winning" : ""}`}
            style={{ width: `${ownPct}%` }}
          />
          <div
            className={`war-compare-bar-fill war-compare-bar-fill--enemy${enemyPct > ownPct ? " war-compare-bar-fill--winning" : ""}`}
            style={{ width: `${enemyPct}%` }}
          />
        </div>
        <span className="war-compare-val war-compare-val--right">{enemy.toLocaleString()}</span>
      </div>
    </div>
  );
}

function MvpChip({ entry, icon }: { entry: DashboardLastWarMvpEntry; icon: React.ReactNode }) {
  return (
    <div className="war-mvp-chip">
      <Avatar size={28} radius="xl" className="war-mvp-avatar">
        {entry.initials}
      </Avatar>
      <div className="war-mvp-chip-info">
        <Text size="xs" fw={600} truncate className="war-mvp-chip-name">
          {entry.name}
        </Text>
        <div className="war-mvp-chip-category">
          {icon}
          <Text size="xs" c="dimmed" className="war-mvp-chip-label">
            {entry.label}
          </Text>
        </div>
      </div>
      <Text size="sm" fw={700} className="war-mvp-chip-value">
        <NumberTicker value={entry.value} />
      </Text>
    </div>
  );
}

export function LastWarCard({ recentWars, warMvps, isExternalView, onOpenHistory }: LastWarCardProps) {
  const { t } = useTranslation("dashboard");
  const [index, setIndex] = useState(0);

  const war = recentWars[index] ?? null;
  const mvp = warMvps[index] ?? null;
  const total = recentWars.length;
  const hasPrev = index > 0;
  const hasNext = index < total - 1;

  return (
    <InfiniCard className="dashboard-card" interactive={false} overrides={{ glow: { variant: "spotlight", glowIntensity: 0.3 } }}>
      <div className="war-card-header">
        {cardHeading(t("card.lastWar.title"), <SwordsOutlined size={18} />)}
        {total > 1 ? (
          <div className="war-nav">
            <ActionIcon
              disabled={!hasPrev}
              onClick={() => setIndex((i) => i - 1)}
              className="war-nav-btn"
              aria-label="Previous war"
            >
              <LeftOutlined size={16} stroke={2.6} />
            </ActionIcon>
            <Text size="xs" c="dimmed" className="war-nav-counter">
              {index + 1}/{total}
            </Text>
            <ActionIcon
              disabled={!hasNext}
              onClick={() => setIndex((i) => i + 1)}
              className="war-nav-btn"
              aria-label="Next war"
            >
              <RightOutlined size={16} stroke={2.6} />
            </ActionIcon>
          </div>
        ) : null}
      </div>

      {war ? (
        <div className="war-body">
          {/* War name row: name + time on left, result + share on right */}
          <div className="war-info-row">
            <div className="war-info-left">
              <div className="war-name-line">
                <Text fw={700} size="lg" truncate>{war.war_name}</Text>
                <ActionIcon
                  onClick={() => onOpenHistory(war.war_name)}
                  className="war-share-btn"
                  aria-label="Open war history"
                >
                  <GoToOutlined size={15} stroke={2.4} />
                </ActionIcon>
              </div>
              <Text c="dimmed" size="xs">{formatDateTime(war.created_at)}</Text>
            </div>
            <div
              className="war-result-badge"
              style={{ "--war-result-color": resultColor(war.result) } as React.CSSProperties}
            >
              <TrophyOutlined size={14} />
              <span>{resultLabel(war.result, t)}</span>
            </div>
          </div>

          {/* VS header */}
          <div className="war-vs-bar-header">
            <span className="war-vs-bar-team war-vs-bar-team--us">{t("card.lastWar.us")}</span>
            <SwordsOutlined size={14} />
            <span className="war-vs-bar-team war-vs-bar-team--enemy">{war.enemy_name ?? t("card.lastWar.enemy")}</span>
          </div>

          {/* Comparison bars */}
          <div className="war-compare-section">
            <CompareBar
              icon={<TargetOutlined size={13} />}
              label={t("card.lastWar.kills")}
              own={war.own_kills ?? 0}
              enemy={war.enemy_kills ?? 0}
            />
            {!isExternalView ? (
              <>
                <CompareBar
                  icon={<CrownOutlined size={13} />}
                  label={t("card.lastWar.credits")}
                  own={war.own_credits ?? 0}
                  enemy={war.enemy_credits ?? 0}
                />
                <CompareBar
                  icon={<ShieldOutlined size={13} />}
                  label={t("card.lastWar.towers")}
                  own={war.own_towers ?? 0}
                  enemy={war.enemy_towers ?? 0}
                />
                <CompareBar
                  icon={<ShieldOutlined size={13} />}
                  label={t("card.lastWar.baseHp")}
                  own={war.own_base_hp ?? 0}
                  enemy={war.enemy_base_hp ?? 0}
                />
              </>
            ) : null}
          </div>

          {/* MVPs */}
          {!isExternalView && mvp ? (
            <div className="war-mvp-section">
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" className="war-mvp-section-header">
                {t("card.lastWar.mvps")}
              </Text>
              <div className="war-mvp-chips">
                <MvpChip entry={{ ...mvp.damage, label: t("card.lastWar.mvp.damage") }} icon={<IconFlame size={12} />} />
                <MvpChip entry={{ ...mvp.healing, label: t("card.lastWar.mvp.healing") }} icon={<IconHeart size={12} />} />
                <MvpChip entry={{ ...mvp.building, label: t("card.lastWar.mvp.building") }} icon={<IconHammer size={12} />} />
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState title={t("empty")} />
      )}
    </InfiniCard>
  );
}
