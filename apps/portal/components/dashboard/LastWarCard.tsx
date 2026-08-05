import type { WarHistory } from "@guild/shared";
import { SectionHeader } from "../shared/SectionHeader";
import { ActionIcon, Avatar, Button, Paper, Stack, Text } from "@mantine/core";
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
import { findGuildWarResultDefinition } from "@guild/shared";
import { useSiteConfigStore } from "@portal/stores/site-config";
import { getGuildWarResultLabel, getGuildWarTeamStatLabel } from "@portal/utils/game-rules";

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
  onViewHistory: () => void;
};

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
        {entry.value}
      </Text>
    </div>
  );
}

export const LastWarCard = memo(function LastWarCard({
  recentWars,
  warMvps,
  isExternalView,
  onOpenHistory,
  onViewHistory,
}: LastWarCardProps) {
  const { t, i18n } = useTranslation("dashboard");
  const gameRules = useSiteConfigStore((state) => state.gameRules);
  const [index, setIndex] = useState(0);

  const war = recentWars[index] ?? null;
  const mvp = warMvps[index] ?? null;
  const total = recentWars.length;
  const hasPrev = index > 0;
  const hasNext = index < total - 1;
  const resultDefinition = war?.result ? findGuildWarResultDefinition(gameRules, war.result) : undefined;
  const resultColor = resultDefinition?.tone === "success"
    ? "var(--status-success)"
    : resultDefinition?.tone === "danger"
      ? "var(--status-danger)"
      : "var(--text-muted)";
  const teamStats = isExternalView
    ? [gameRules.guild_war.team_stats.find((definition) => definition.dashboard === "primary")
        ?? gameRules.guild_war.team_stats[0]].filter(Boolean)
    : gameRules.guild_war.team_stats.filter((definition) => definition.dashboard !== "hidden");

  return (
    <Paper withBorder radius="md" className="dashboard-card">
      <div>
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
              style={{ "--war-result-color": resultColor } as React.CSSProperties}
            >
              <TrophyOutlined size={14} />
              <span>{war.result
                ? getGuildWarResultLabel(war.result, i18n.language, gameRules)
                : t("card.lastWar.result.pending")}</span>
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
            {teamStats.map((definition, statIndex) => definition ? (
              <CompareBar
                key={definition.key}
                classPrefix="war-compare-"
                icon={statIndex === 0 ? <TargetOutlined size={13} /> : statIndex === 1 ? <CrownOutlined size={13} /> : <ShieldOutlined size={13} />}
                label={getGuildWarTeamStatLabel(definition.key, i18n.language, gameRules)}
                own={war.own_stats?.[definition.key] ?? 0}
                enemy={war.enemy_stats?.[definition.key] ?? 0}
              />
            ) : null)}
          </Stack>

          {/* MVPs */}
          {!isExternalView && mvp ? (
            <Stack gap={6} className="war-mvp-section">
              <SectionHeader title={t("card.lastWar.mvps")} className="section-header--flush" />
              <Stack gap={6}>
                {mvp.map((entry) => (
                  <MvpChip key={entry.category} entry={entry} icon={MVP_ICON_MAP[entry.category] ?? <FlameIcon size={12} />} />
                ))}
              </Stack>
            </Stack>
          ) : null}
        </div>
        ) : (
          <EmptyState
            title={t("card.lastWar.empty")}
            actions={(
              <Button variant="default" onClick={onViewHistory}>
                {t("card.lastWar.viewHistory")}
              </Button>
            )}
          />
        )}
      </div>
    </Paper>
  );
});
