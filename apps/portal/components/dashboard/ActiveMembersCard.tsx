import { Paper, Skeleton } from "@mantine/core";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { TeamOutlined } from "../../utils/icons";
import { cardHeading } from "./shared";

type ActiveMembersCardProps = {
  activeMemberCount: number;
  totalMembersCount: number;
  allWarWinRate: number;
  activeEventsCount: number;
  memberStatsLoading: boolean;
  eventsLoading: boolean;
  warsLoading: boolean;
};

export const ActiveMembersCard = memo(function ActiveMembersCard({
  activeMemberCount,
  totalMembersCount,
  allWarWinRate,
  activeEventsCount,
  memberStatsLoading,
  eventsLoading,
  warsLoading,
}: ActiveMembersCardProps) {
  const { t } = useTranslation("dashboard");
  const safeActiveMemberCount = Math.max(0, activeMemberCount);
  const safeTotalMembersCount = Math.max(0, totalMembersCount);
  const safeActiveEventsCount = Math.max(0, activeEventsCount);
  const safeWinRate = Number.isFinite(allWarWinRate) ? Math.max(0, Math.min(100, allWarWinRate)) : 0;

  return (
    <Paper withBorder radius="md" className="dashboard-card">
      <div>
        {cardHeading(t("card.activeMembers.title"), <TeamOutlined size={18} />)}
        <div className="dashboard-kpi-grid">
          <Skeleton visible={memberStatsLoading} radius="md">
            <dl className="dashboard-kpi">
              <dt className="dashboard-kpi__label">{t("card.activeMembers.activeRatio")}</dt>
              <dd className="dashboard-kpi__value portal-kpi-value">
                <span>{safeActiveMemberCount}</span>
                <span className="dashboard-kpi__subvalue">/{safeTotalMembersCount}</span>
              </dd>
            </dl>
          </Skeleton>

          <Skeleton visible={eventsLoading} radius="md">
            <dl className="dashboard-kpi">
              <dt className="dashboard-kpi__label">{t("card.activeMembers.upcomingEvents")}</dt>
              <dd className="dashboard-kpi__value portal-kpi-value">{safeActiveEventsCount}</dd>
            </dl>
          </Skeleton>

          <Skeleton visible={warsLoading} radius="md">
            <dl className="dashboard-kpi">
              <dt className="dashboard-kpi__label">{t("card.activeMembers.winRate")}</dt>
              <dd className="dashboard-kpi__value portal-kpi-value">{safeWinRate.toFixed(1)}%</dd>
            </dl>
          </Skeleton>
        </div>
      </div>
    </Paper>
  );
});
