import type { WarHistory } from "@guild/shared";
import { NumberTicker } from "@portal/components/effects";
import { PortalCard } from "../shared/PortalCard";
import { ActionIcon, Avatar, Stack, Text } from "@mantine/core";
import { memo, useState } from "react";
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
import { FlameIcon, HeartIcon, HammerIcon, ShieldIcon } from "@portal/components/icons";
import { CompareBar } from "../shared/CompareBar";
import { EmptyState } from "../shared/EmptyState";
import { cardHeading, formatDateTime, type DashboardLastWarMvp, type DashboardLastWarMvpEntry } from "./shared";

const MVP_ICON_MAP: Record<string, React.ReactNode> = {
  damage: <FlameIcon size={12} />,
  healing: <HeartIcon size={12} />,
  damage_taken: <ShieldIcon size={12} />,
  building_damage: <HammerIcon size={12} />,
};

type LastWarCardProps = {
  recentWars: WarHistory[];
  warMvps: DashboardLastWarMvp[];
  isExternalView: boolean;
  onOpenHistory: (warName: string) => void;
};

const RESULT_COLOR: Record<string, string> = {
  win: "var(--color-success, #22c55e)",
  loss: "var(--color-danger, #ef4444)",
  draw: "var(--color-warning, #f59e0b)",
};

const RESULT_LABEL_KEY: Record<string, string> = {
  win: "card.lastWar.result.victory",
  loss: "card.lastWar.result.defeat",
  draw: "card.lastWar.result.draw",
};

function resultColor(result: string | null): string {
  return (result && RESULT_COLOR[result]) ?? "var(--color-text-muted, #6B665E)";
}

function resultLabel(result: string | null, t: (key: string) => string): string {
  return t((result && RESULT_LABEL_KEY[result]) ?? "card.lastWar.result.pending");
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

export const LastWarCard = memo(function LastWarCard({ recentWars, warMvps, isExternalView, onOpenHistory }: LastWarCardProps) {
  const { t } = useTranslation("dashboard");
  const [index, setIndex] = useState(0);

  const war = recentWars[index] ?? null;
  const mvp = warMvps[index] ?? null;
  const total = recentWars.length;
  const hasPrev = index > 0;
  const hasNext = index < total - 1;

  return (
    <PortalCard className="dashboard-card" interactive={false}>
      <div className="war-card-header">
        {cardHeading(t("card.lastWar.title"), <SwordsOutlined size={18} />)}
        {total > 1 ? (
          <div className="war-nav">
            <ActionIcon
              disabled={!hasPrev}
              onClick={() => setIndex((i) => i - 1)}
              className="war-nav-btn"
              aria-label={t("card.lastWar.aria.prevWar")}
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
              aria-label={t("card.lastWar.aria.nextWar")}
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
                  aria-label={t("card.lastWar.aria.openHistory")}
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
          <Stack gap={8}>
            <CompareBar
              classPrefix="war-compare-"
              icon={<TargetOutlined size={13} />}
              label={t("card.lastWar.kills")}
              own={war.own_stats?.kills ?? 0}
              enemy={war.enemy_stats?.kills ?? 0}
            />
            {!isExternalView ? (
              <>
                <CompareBar
                  classPrefix="war-compare-"
                  icon={<CrownOutlined size={13} />}
                  label={t("card.lastWar.credits")}
                  own={war.own_stats?.credits ?? 0}
                  enemy={war.enemy_stats?.credits ?? 0}
                />
                <CompareBar
                  classPrefix="war-compare-"
                  icon={<ShieldOutlined size={13} />}
                  label={t("card.lastWar.towers")}
                  own={war.own_stats?.towers ?? 0}
                  enemy={war.enemy_stats?.towers ?? 0}
                />
                <CompareBar
                  classPrefix="war-compare-"
                  icon={<ShieldOutlined size={13} />}
                  label={t("card.lastWar.baseHp")}
                  own={war.own_stats?.base_hp ?? 0}
                  enemy={war.enemy_stats?.base_hp ?? 0}
                />
              </>
            ) : null}
          </Stack>

          {/* MVPs */}
          {!isExternalView && mvp ? (
            <Stack gap={6} pt={8} style={{ borderTop: "1px solid color-mix(in srgb, var(--color-text, #1A1815) 8%, transparent)" }}>
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.08em", marginBottom: 2 }}>
                {t("card.lastWar.mvps")}
              </Text>
              <Stack gap={6}>
                {mvp.map((entry) => (
                  <MvpChip key={entry.category} entry={entry} icon={MVP_ICON_MAP[entry.category] ?? <FlameIcon size={12} />} />
                ))}
              </Stack>
            </Stack>
          ) : null}
        </div>
      ) : (
        <EmptyState title={t("empty")} />
      )}
    </PortalCard>
  );
});
