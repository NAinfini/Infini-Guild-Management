import { Card } from "@portal/components/ui/card";
import { Skeleton } from "@portal/components/ui/skeleton";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { TeamOutlined } from "../../utils/icons";
import { cardHeading, KpiMeter } from "./shared";

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
    <Card className="dashboard-card gap-0 py-0">
      <div>
        {cardHeading(t("card.activeMembers.title"), <TeamOutlined size={18} />)}
        <div className="dashboard-kpi-grid">
          {memberStatsLoading ? (
            <Skeleton className="dashboard-kpi-skeleton" />
          ) : (
            <dl className="dashboard-kpi">
              <dt className="dashboard-kpi__label">{t("card.activeMembers.activeRatio")}</dt>
              <dd className="dashboard-kpi__value portal-kpi-value">
                <span className="dashboard-kpi__value-row">
                  <span>{safeActiveMemberCount}</span>
                  <span className="dashboard-kpi__subvalue">/{safeTotalMembersCount}</span>
                </span>
                <KpiMeter ratio={safeTotalMembersCount > 0 ? safeActiveMemberCount / safeTotalMembersCount : 0} />
              </dd>
            </dl>
          )}

          {/* 活动数不是比例，没有分母可画——这一格刻意留空，缺席本身就是信息。 */}
          {eventsLoading ? (
            <Skeleton className="dashboard-kpi-skeleton" />
          ) : (
            <dl className="dashboard-kpi">
              <dt className="dashboard-kpi__label">{t("card.activeMembers.upcomingEvents")}</dt>
              <dd className="dashboard-kpi__value portal-kpi-value">{safeActiveEventsCount}</dd>
            </dl>
          )}

          {warsLoading ? (
            <Skeleton className="dashboard-kpi-skeleton" />
          ) : (
            <dl className="dashboard-kpi">
              <dt className="dashboard-kpi__label">{t("card.activeMembers.winRate")}</dt>
              <dd className="dashboard-kpi__value portal-kpi-value">
                <span className="dashboard-kpi__value-row">{safeWinRate.toFixed(1)}%</span>
                <KpiMeter ratio={safeWinRate / 100} />
              </dd>
            </dl>
          )}
        </div>
      </div>
    </Card>
  );
});
