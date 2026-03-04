import { InfiniCard, InfiniNumberTicker, InfiniProgressRing } from "@infini-dev-kit/frontend/components";
import { Group, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { TeamOutlined } from "../../utils/icons";
import { cardHeading } from "./shared";

type ActiveMembersCardProps = {
  activeMemberCount: number;
  totalMembersCount: number;
  allWarWinRate: number;
  activeEventsCount: number;
};

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
    <InfiniCard className="dashboard-card" overrides={{ glow: { variant: "spotlight", glowIntensity: 0.25 } }}>
      {cardHeading(t("card.activeMembers.title"), <TeamOutlined size={18} />)}
      <Group className="dashboard-stats-circles" gap={10} mt={12} align="flex-start">
        <div className="dashboard-stats-circle-item">
          <InfiniProgressRing
            className="dashboard-stats-circle"
            value={activeMemberPercent}
            size={100}
            strokeWidth={10}
            glow
            label={
              <span className="dashboard-stats-circle-value">
                <InfiniNumberTicker value={safeActiveMemberCount} />
                <span className="dashboard-stats-circle-subvalue">/{safeTotalMembersCount}</span>
              </span>
            }
          />
          <Text className="dashboard-stats-circle-label">{t("card.activeMembers.activeRatio")}</Text>
        </div>

        <div className="dashboard-stats-circle-item">
          <InfiniProgressRing
            className="dashboard-stats-circle"
            value={weeklyEventsPercent}
            size={100}
            strokeWidth={10}
            glow
            label={
              <span className="dashboard-stats-circle-value">
                <InfiniNumberTicker value={safeActiveEventsCount} />
              </span>
            }
          />
          <Text className="dashboard-stats-circle-label">{t("card.activeMembers.eventsWeek")}</Text>
        </div>

        <div className="dashboard-stats-circle-item">
          <InfiniProgressRing
            className="dashboard-stats-circle"
            value={safeWinRate}
            size={100}
            strokeWidth={10}
            glow
            label={
              <span className="dashboard-stats-circle-value">
                <InfiniNumberTicker value={safeWinRate} decimals={1} suffix="%" />
              </span>
            }
          />
          <Text className="dashboard-stats-circle-label">{t("card.activeMembers.winRate")}</Text>
        </div>
      </Group>
    </InfiniCard>
  );
}
