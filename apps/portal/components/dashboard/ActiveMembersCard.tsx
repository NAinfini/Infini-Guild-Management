import { NumberTicker } from "@portal/components/effects";
import { PortalCard } from "../shared/PortalCard";
import { Group, RingProgress, Skeleton, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";
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
      rootColor="gray"
    />
  );
}

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
  const activeMemberPercent =
    safeTotalMembersCount > 0 ? Math.min(100, (safeActiveMemberCount / safeTotalMembersCount) * 100) : 0;
  const upcomingEventsPercent = Math.min(100, safeActiveEventsCount * 10);

  return (
    <PortalCard className="dashboard-card" interactive={false}>
      {cardHeading(t("card.activeMembers.title"), <TeamOutlined size={18} />)}
      <Group gap={10} mt={12} align="flex-start" justify="space-between" w="100%">
        <Skeleton visible={memberStatsLoading} radius="md" style={{ flex: "1 1 0", minWidth: 0 }}>
          <Stack gap={8} align="center">
            {renderRing(
              activeMemberPercent,
              <span className="dashboard-stats-circle-center">
                <span className="dashboard-stats-circle-value">
                  <NumberTicker value={safeActiveMemberCount} />
                  <span className="dashboard-stats-circle-subvalue">/{safeTotalMembersCount}</span>
                </span>
              </span>,
              "portal-accent",
            )}
            <Text className="dashboard-stats-circle-label">{t("card.activeMembers.activeRatio")}</Text>
          </Stack>
        </Skeleton>

        <Skeleton visible={eventsLoading} radius="md" style={{ flex: "1 1 0", minWidth: 0 }}>
          <Stack gap={8} align="center">
            {renderRing(
              upcomingEventsPercent,
              <span className="dashboard-stats-circle-center">
                <span className="dashboard-stats-circle-value">
                  <NumberTicker value={safeActiveEventsCount} />
                </span>
              </span>,
              "blue",
            )}
            <Text className="dashboard-stats-circle-label">{t("card.activeMembers.upcomingEvents")}</Text>
          </Stack>
        </Skeleton>

        <Skeleton visible={warsLoading} radius="md" style={{ flex: "1 1 0", minWidth: 0 }}>
          <Stack gap={8} align="center">
            {renderRing(
              safeWinRate,
              <span className="dashboard-stats-circle-center">
                <span className="dashboard-stats-circle-value">
                  <NumberTicker value={safeWinRate} decimals={1} suffix="%" />
                </span>
              </span>,
              "green",
            )}
            <Text className="dashboard-stats-circle-label">{t("card.activeMembers.winRate")}</Text>
          </Stack>
        </Skeleton>
      </Group>
    </PortalCard>
  );
});
