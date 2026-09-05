import { LoadingIndicator } from "@portal/components/ui/loading-indicator";
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
  canManageWeights: boolean;
};

export function GuildWarAnalyticsTabWrapper({
  historyQuery,
  chartPalette,
  guildWarService,
  chartThemeName,
  chartThemeConfig,
  canManageWeights,
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
        <LoadingIndicator />
      }
    >
      <LazyGuildWarAnalyticsTab
        analytics={analytics}
        chartThemeName={chartThemeName}
        chartThemeConfig={chartThemeConfig}
        loadErrorMessage={t("common:loadError")}
        onRetry={() => {
          void analytics.analyticsQuery.refetch();
          void analytics.analyticsDetailsQuery.refetch();
        }}
        canManageWeights={canManageWeights}
      />
    </Suspense>
  );
}
