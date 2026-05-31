import { Card, Group, Skeleton, Stack } from "@mantine/core";
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import type { GuildWarService } from "../../../services/GuildWarService";
import type { useGuildWarData } from "../../../hooks/data/useGuildWarData";
import type { EChartsThemeConfig } from "../../../theme/echarts";
import { useGuildWarAnalytics } from "../../../hooks/guild-war/useGuildWarAnalytics";

const LazyGuildWarAnalyticsTab = lazy(() =>
  import("../../feature/guild-war/GuildWarAnalyticsTab").then((mod) => ({ default: mod.GuildWarAnalyticsTab })),
);

type GuildWarAnalyticsTabWrapperProps = {
  historyQuery: ReturnType<typeof useGuildWarData>["historyQuery"];
  chartPalette: string[];
  guildWarService: GuildWarService;
  chartThemeName: string;
  chartThemeConfig: EChartsThemeConfig;
};

export function GuildWarAnalyticsTabWrapper({
  historyQuery,
  chartPalette,
  guildWarService,
  chartThemeName,
  chartThemeConfig,
}: GuildWarAnalyticsTabWrapperProps) {
  const { t } = useTranslation("guild-war");
  const analytics = useGuildWarAnalytics({
    historyRows: historyQuery.data?.data ?? [],
    chartPalette,
    guildWarService,
  });

  return (
    <Suspense
      fallback={
        <Card>
          <Stack gap={10} p="md">
            <Group gap={8}><Skeleton height={28} width="25%" /><Skeleton height={28} width="25%" /></Group>
            <Skeleton height={180} radius={8} />
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={18} />)}
          </Stack>
        </Card>
      }
    >
      <LazyGuildWarAnalyticsTab
        analytics={analytics}
        chartThemeName={chartThemeName}
        chartThemeConfig={chartThemeConfig}
        loadErrorMessage={t("common:loadError")}
      />
    </Suspense>
  );
}
