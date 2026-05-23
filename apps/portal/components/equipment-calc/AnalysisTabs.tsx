import { Tabs } from "@mantine/core";
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import type { GameData } from "@guild/shared/calculator/types";
import { ErrorBoundary } from "../effects";
import {
  IconArrowsExchange,
  IconChartArrows,
  IconSeeding,
  IconReplace,
  IconCpu,
  IconForms,
} from "@tabler/icons-react";

const ComparisonTab = lazy(() => import("./ComparisonTab").then((m) => ({ default: m.ComparisonTab })));
const PriorityTab = lazy(() => import("./PriorityTab").then((m) => ({ default: m.PriorityTab })));
const CultivationTab = lazy(() => import("./CultivationTab").then((m) => ({ default: m.CultivationTab })));
const TransmutationTab = lazy(() => import("./TransmutationTab").then((m) => ({ default: m.TransmutationTab })));
const BestBuildTab = lazy(() => import("./BestBuildTab").then((m) => ({ default: m.BestBuildTab })));
const ManualEntryTab = lazy(() => import("./ManualEntryTab").then((m) => ({ default: m.ManualEntryTab })));

type Props = { gameData: GameData };

const TAB_ICON_SIZE = 18;

export function AnalysisTabs({ gameData }: Props) {
  const { t } = useTranslation("equipCalc");

  return (
    <Tabs defaultValue="comparison">
      <Tabs.List>
        <Tabs.Tab value="comparison" leftSection={<IconArrowsExchange size={TAB_ICON_SIZE} />}>
          {t("tabs.comparison")}
        </Tabs.Tab>
        <Tabs.Tab value="priority" leftSection={<IconChartArrows size={TAB_ICON_SIZE} />}>
          {t("tabs.priority")}
        </Tabs.Tab>
        <Tabs.Tab value="cultivation" leftSection={<IconSeeding size={TAB_ICON_SIZE} />}>
          {t("tabs.cultivation")}
        </Tabs.Tab>
        <Tabs.Tab value="transmutation" leftSection={<IconReplace size={TAB_ICON_SIZE} />}>
          {t("tabs.transmutation")}
        </Tabs.Tab>
        <Tabs.Tab value="bestBuild" leftSection={<IconCpu size={TAB_ICON_SIZE} />}>
          {t("tabs.bestBuild")}
        </Tabs.Tab>
        <Tabs.Tab value="manualEntry" leftSection={<IconForms size={TAB_ICON_SIZE} />}>
          {t("tabs.manualEntry")}
        </Tabs.Tab>
      </Tabs.List>

      <ErrorBoundary>
        <Suspense fallback={null}>
          <Tabs.Panel value="comparison" pt="sm"><ComparisonTab gameData={gameData} /></Tabs.Panel>
          <Tabs.Panel value="priority" pt="sm"><PriorityTab gameData={gameData} /></Tabs.Panel>
          <Tabs.Panel value="cultivation" pt="sm"><CultivationTab gameData={gameData} /></Tabs.Panel>
          <Tabs.Panel value="transmutation" pt="sm"><TransmutationTab gameData={gameData} /></Tabs.Panel>
          <Tabs.Panel value="bestBuild" pt="sm"><BestBuildTab gameData={gameData} /></Tabs.Panel>
          <Tabs.Panel value="manualEntry" pt="sm"><ManualEntryTab gameData={gameData} /></Tabs.Panel>
        </Suspense>
      </ErrorBoundary>
    </Tabs>
  );
}
