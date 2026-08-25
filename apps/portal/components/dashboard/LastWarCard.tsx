import { DEFAULT_GAME_RULES, type ExternalDashboardWar } from "@guild/shared";
import { SectionHeader } from "../shared/SectionHeader";
import { Avatar, AvatarFallback } from "@portal/components/ui/avatar";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { memo, useState, type CSSProperties, type ReactNode } from "react";
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
import { formatDateTimeWithTimeZone } from "@portal/utils/datetime";
import { cardHeading, type DashboardLastWarMvp, type DashboardLastWarMvpEntry } from "./shared";
import { findGuildWarResultDefinition } from "@guild/shared";
import { getGuildWarResultLabel, getGuildWarTeamStatLabel } from "@portal/utils/game-rules";

const MVP_ICON_MAP: Record<string, React.ReactNode> = {
  damage: <FlameIcon size={12} />,
  healing: <HeartIcon size={12} />,
  damage_taken: <ShieldIcon size={12} />,
  building_damage: <HammerIcon size={12} />,
};

type LastWarCardProps = {
  recentWars: ExternalDashboardWar[];
  warMvps: DashboardLastWarMvp[];
  isExternalView: boolean;
  onOpenHistory: (warName: string) => void;
  onViewHistory: () => void;
};

function MvpChip({ entry, icon }: { entry: DashboardLastWarMvpEntry; icon: ReactNode }) {
  return (
    <div className="war-mvp-chip">
      <Avatar className="war-mvp-avatar">
        <AvatarFallback>{entry.initials}</AvatarFallback>
      </Avatar>
      <div className="war-mvp-chip-info">
        <span className="war-mvp-chip-name">
          {entry.name}
        </span>
        <div className="war-mvp-chip-category">
          {icon}
          <span className="war-mvp-chip-label">
            {entry.label}
          </span>
        </div>
      </div>
      <strong className="war-mvp-chip-value">
        {entry.value}
      </strong>
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
  const gameRules = DEFAULT_GAME_RULES;
  const [index, setIndex] = useState(0);

  const war = recentWars[index] ?? null;
  const mvp = warMvps[index] ?? null;
  const total = recentWars.length;
  const hasPrev = index > 0;
  const hasNext = index < total - 1;
  const resultDefinition = war?.result ? findGuildWarResultDefinition(war.result) : undefined;
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
    <Card className="dashboard-card gap-0 py-0">
      <div>
        <div className="war-card-header">
        {cardHeading(t("card.lastWar.title"), <SwordsOutlined size={18} />)}
        {total > 1 ? (
          <div className="war-nav">
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={!hasPrev}
              onClick={() => setIndex((i) => i - 1)}
              className="war-nav-btn"
              aria-label={t("card.lastWar.aria.prevWar")}
            >
              <LeftOutlined size={16} stroke={2.6} />
            </Button>
            <span className="war-nav-counter">
              {index + 1}/{total}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={!hasNext}
              onClick={() => setIndex((i) => i + 1)}
              className="war-nav-btn"
              aria-label={t("card.lastWar.aria.nextWar")}
            >
              <RightOutlined size={16} stroke={2.6} />
            </Button>
          </div>
        ) : null}
        </div>

        {war ? (
        <div className="war-body">
          {/* War name row: name + time on left, result + share on right */}
          <div className="war-info-row">
            <div className="war-info-left">
              <div className="war-name-line">
                <strong className="war-name">{war.war_name}</strong>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => onOpenHistory(war.war_name)}
                  className="war-share-btn"
                  aria-label={t("card.lastWar.aria.openHistory")}
                >
                  <GoToOutlined size={15} stroke={2.4} />
                </Button>
              </div>
              <time className="war-created-at" dateTime={war.created_at}>{formatDateTimeWithTimeZone(war.created_at)}</time>
            </div>
            <div
              className="war-result-badge"
              style={{ "--war-result-color": resultColor } as CSSProperties}
            >
              <TrophyOutlined size={14} />
              <span>{war.result
                ? getGuildWarResultLabel(war.result, i18n.language)
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
          <div className="war-compare-section">
            {teamStats.map((definition, statIndex) => definition ? (
              <CompareBar
                key={definition.key}
                classPrefix="war-compare-"
                icon={statIndex === 0 ? <TargetOutlined size={13} /> : statIndex === 1 ? <CrownOutlined size={13} /> : <ShieldOutlined size={13} />}
                label={getGuildWarTeamStatLabel(definition.key)}
                own={war.own_stats?.[definition.key] ?? 0}
                enemy={war.enemy_stats?.[definition.key] ?? 0}
              />
            ) : null)}
          </div>

          {/* MVPs */}
          {!isExternalView && mvp ? (
            <div className="war-mvp-section">
              <SectionHeader title={t("card.lastWar.mvps")} className="section-header--flush" />
              <div className="war-mvp-chips">
                {mvp.map((entry) => (
                  <MvpChip key={entry.category} entry={entry} icon={MVP_ICON_MAP[entry.category] ?? <FlameIcon size={12} />} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
        ) : (
          <EmptyState
            title={t("card.lastWar.empty")}
            actions={(
              <Button onClick={onViewHistory}>
                {t("card.lastWar.viewHistory")}
              </Button>
            )}
          />
        )}
      </div>
    </Card>
  );
});
