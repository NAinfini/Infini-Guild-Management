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
} from "../../utils/icons";
import { FlameIcon, HeartIcon, HammerIcon, ShieldIcon } from "@portal/components/icons";
import { EmptyState } from "../shared/EmptyState";
import { formatDateTimeWithTimeZone } from "@portal/utils/datetime";
import { cardHeading, type DashboardLastWarMvp, type DashboardLastWarMvpEntry } from "./shared";
import { findGuildWarResultDefinition } from "@guild/shared";
import { getGuildWarResultLabel, getGuildWarTeamStatLabel } from "@portal/utils/game-rules";

const MVP_ICON_MAP: Record<string, React.ReactNode> = {
  damage: <FlameIcon size={12} aria-hidden="true" />,
  healing: <HeartIcon size={12} aria-hidden="true" />,
  damage_taken: <ShieldIcon size={12} aria-hidden="true" />,
  building_damage: <HammerIcon size={12} aria-hidden="true" />,
};

type LastWarCardProps = {
  recentWars: ExternalDashboardWar[];
  warMvps: DashboardLastWarMvp[];
  isExternalView: boolean;
  onOpenHistory: (warName: string) => void;
  onViewHistory: () => void;
};

function MvpEntry({ entry, icon }: { entry: DashboardLastWarMvpEntry; icon: ReactNode }) {
  return (
    <div className="war-mvp-entry">
      <Avatar className="war-mvp-avatar">
        <AvatarFallback>{entry.initials}</AvatarFallback>
      </Avatar>
      <div className="war-mvp-entry__copy">
        <strong className="war-mvp-entry__name">
          {entry.name}
        </strong>
        <span className="war-mvp-entry__category">
          {icon}
          {entry.label}
        </span>
      </div>
      <data className="war-mvp-entry__value" value={entry.value}>{entry.value.toLocaleString()}</data>
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

  const total = recentWars.length;
  const activeIndex = Math.min(index, Math.max(total - 1, 0));
  const war = recentWars[activeIndex] ?? null;
  const mvp = warMvps[activeIndex] ?? null;
  const hasPrev = activeIndex > 0;
  const hasNext = activeIndex < total - 1;
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
    <Card className="dashboard-card war-report-card gap-0 py-0">
      <div className="war-report">
        <div className="war-card-header">
          {cardHeading(t("card.lastWar.title"), <SwordsOutlined size={18} aria-hidden="true" />)}
          {total > 1 ? (
            <div className="war-nav">
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={!hasPrev}
                onClick={() => setIndex((current) => current - 1)}
                className="war-nav-btn"
                aria-label={t("card.lastWar.aria.prevWar")}
              >
                <LeftOutlined size={16} stroke={2.6} aria-hidden="true" />
              </Button>
              <span className="war-nav-counter" aria-live="polite">
                {activeIndex + 1}/{total}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={!hasNext}
                onClick={() => setIndex((current) => current + 1)}
                className="war-nav-btn"
                aria-label={t("card.lastWar.aria.nextWar")}
              >
                <RightOutlined size={16} stroke={2.6} aria-hidden="true" />
              </Button>
            </div>
          ) : null}
        </div>

        {war ? (
          <article
            key={war.id}
            className="war-report-slide"
            style={{ "--war-result-color": resultColor } as CSSProperties}
          >
            <section className="war-match-hero">
              <strong className="war-result-label">
                {war.result
                  ? getGuildWarResultLabel(war.result, i18n.language)
                  : t("card.lastWar.result.pending")}
              </strong>
              <div className="war-opponent">
                <h3 className="war-opponent-name">{war.enemy_name ?? t("card.lastWar.enemy")}</h3>
                <span className="war-report-name">{war.war_name}</span>
              </div>
              <div className="war-match-meta">
                <time className="war-created-at" dateTime={war.created_at}>
                  {formatDateTimeWithTimeZone(war.created_at)}
                </time>
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  onClick={() => onOpenHistory(war.war_name)}
                  className="war-report-link"
                >
                  {t("card.lastWar.report")}
                  <GoToOutlined size={14} stroke={2.4} aria-hidden="true" />
                </Button>
              </div>
            </section>

            <div className="war-report-details">
              <table className="war-scoreboard">
                <caption className="sr-only">{t("card.lastWar.comparison")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("card.lastWar.us")}</th>
                    <th scope="col">{t("card.lastWar.comparison")}</th>
                    <th scope="col">{t("card.lastWar.enemy")}</th>
                  </tr>
                </thead>
                <tbody>
                  {teamStats.map((definition, statIndex) => {
                    if (!definition) return null;
                    const own = war.own_stats?.[definition.key] ?? 0;
                    const enemy = war.enemy_stats?.[definition.key] ?? 0;
                    return (
                      <tr key={definition.key}>
                        <td className="war-score-value war-score-value--own" data-leading={own > enemy || undefined}>
                          {own.toLocaleString()}
                        </td>
                        <th scope="row" className="war-score-metric">
                          <span aria-hidden="true">
                            {statIndex === 0
                              ? <TargetOutlined size={13} />
                              : statIndex === 1
                                ? <CrownOutlined size={13} />
                                : <ShieldOutlined size={13} />}
                          </span>
                          {getGuildWarTeamStatLabel(definition.key)}
                        </th>
                        <td className="war-score-value war-score-value--enemy" data-leading={enemy > own || undefined}>
                          {enemy.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {!isExternalView && mvp ? (
                <section className="war-mvp-section">
                  <SectionHeader title={t("card.lastWar.mvps")} className="section-header--flush" />
                  <div className="war-mvp-grid">
                    {mvp.map((entry) => (
                      <MvpEntry
                        key={entry.category}
                        entry={entry}
                        icon={MVP_ICON_MAP[entry.category] ?? <FlameIcon size={12} aria-hidden="true" />}
                      />
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </article>
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
