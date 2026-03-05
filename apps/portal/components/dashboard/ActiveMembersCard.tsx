import { InfiniCard, NumberTicker } from "@infini-dev-kit/frontend/components";
import { Group, RingProgress, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TeamOutlined } from "../../utils/icons";
import { cardHeading } from "./shared";

type ActiveMembersCardProps = {
  activeMemberCount: number;
  totalMembersCount: number;
  allWarWinRate: number;
  activeEventsCount: number;
};

function renderRing(
  value: number,
  label: ReactNode,
  color: string,
) {
  return (
    <RingProgress
      className="dashboard-stats-circle"
      size={100}
      thickness={10}
      roundCaps
      sections={[{ value, color }]}
      label={label}
      rootColor="var(--infini-color-border)"
    />
  );
}

export function ActiveMembersCard({
  activeMemberCount,
  totalMembersCount,
  allWarWinRate,
  activeEventsCount,
}: ActiveMembersCardProps) {
  const { t } = useTranslation("dashboard");
  const safeActiveMemberCount = Math.max(0, activeMemberCount);
  const safeTotalMembersCount = Math.max(0, totalMembersCount);
  const safeActiveEventsCount = Math.max(0, activeEventsCount);
  const safeWinRate = Number.isFinite(allWarWinRate) ? Math.max(0, Math.min(100, allWarWinRate)) : 0;
  const activeMemberPercent =
    safeTotalMembersCount > 0 ? Math.min(100, (safeActiveMemberCount / safeTotalMembersCount) * 100) : 0;
  const weeklyEventsPercent = Math.min(100, (safeActiveEventsCount / 7) * 100);

  return (
    <InfiniCard className="dashboard-card" interactive={false} overrides={{ glow: { variant: "spotlight", glowIntensity: 0.25 } }}>
      {cardHeading(t("card.activeMembers.title"), <TeamOutlined size={18} />)}
      <Group className="dashboard-stats-circles" gap={10} mt={12} align="flex-start">
        <div className="dashboard-stats-circle-item">
          {renderRing(
            activeMemberPercent,
            <span className="dashboard-stats-circle-center">
              <span className="dashboard-stats-circle-value">
                <NumberTicker value={safeActiveMemberCount} />
                <span className="dashboard-stats-circle-subvalue">/{safeTotalMembersCount}</span>
              </span>
            </span>,
            "infini-primary",
          )}
          <Text className="dashboard-stats-circle-label">{t("card.activeMembers.activeRatio")}</Text>
        </div>

        <div className="dashboard-stats-circle-item">
          {renderRing(
            weeklyEventsPercent,
            <span className="dashboard-stats-circle-center">
              <span className="dashboard-stats-circle-value">
                <NumberTicker value={safeActiveEventsCount} />
              </span>
            </span>,
            "infini-success",
          )}
          <Text className="dashboard-stats-circle-label">{t("card.activeMembers.eventsWeek")}</Text>
        </div>

        <div className="dashboard-stats-circle-item">
          {renderRing(
            safeWinRate,
            <span className="dashboard-stats-circle-center">
              <span className="dashboard-stats-circle-value">
                <NumberTicker value={safeWinRate} decimals={1} suffix="%" />
              </span>
            </span>,
            "infini-warning",
          )}
          <Text className="dashboard-stats-circle-label">{t("card.activeMembers.winRate")}</Text>
        </div>
      </Group>
    </InfiniCard>
  );
}
