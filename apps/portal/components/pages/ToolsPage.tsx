import { PortalCard } from "../shared/PortalCard";
import { Alert, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { DiceFiveFilledIcon, SwordsIcon, WrenchIcon } from "@portal/components/icons";
import { DiceRollerModal } from "@portal/components/feature/tools/DiceRollerModal";
import { TitleSandboxModal } from "@portal/components/feature/tools/TitleSandboxModal";
import { useTranslation } from "react-i18next";
import { useDisclosure } from "@mantine/hooks";
import { useExternalView } from "../../hooks/useExternalView";
import { FormatPainterOutlined } from "../../utils/icons";
import { PageLayout } from "../layout/PageLayout";
import "./ToolsPage.css";
import { lazy, Suspense, type ReactNode } from "react";
import { useSiteConfigStore } from "@portal/stores/site-config";
import { queryKeys } from "@portal/api/query-keys";
import { fetchGameData } from "@portal/services/GameDataService";

const LazyEquipmentCalcModal = lazy(() =>
  import("../equipment-calc/EquipmentCalcModal").then((m) => ({ default: m.EquipmentCalcModal })),
);

type ToolCard = {
  key: string;
  icon: ReactNode;
  title: string;
  description: string;
  metaLabel?: string;
  metaValue?: string;
  onOpen: () => void;
};

export function ToolsPage() {
  const { t } = useTranslation("tools");
  const isExternalView = useExternalView();
  const [sandboxOpened, sandboxHandlers] = useDisclosure(false);
  const [diceOpened, diceHandlers] = useDisclosure(false);
  const [equipCalcOpened, equipCalcHandlers] = useDisclosure(false);
  const equipCalcEnabled = useSiteConfigStore((s) => s.features.tools && s.features.equipmentCalc);

  const { data: rawGameData } = useQuery({
    queryKey: queryKeys.gameData.latest(),
    queryFn: fetchGameData,
    enabled: equipCalcEnabled,
  });
  const equipCalcDataVersion = rawGameData?.version;

  const toolCards: ToolCard[] = [
    {
      key: "sandbox",
      icon: <FormatPainterOutlined />,
      title: t("sandbox.title"),
      description: t("sandbox.description"),
      onOpen: sandboxHandlers.open,
    },
    {
      key: "dice",
      icon: <DiceFiveFilledIcon size={28} />,
      title: t("dice.title"),
      description: t("dice.description"),
      onOpen: diceHandlers.open,
    },
    // Equipment calculator — in-house tool (see docs/plans/2026-05-21-equipment-calculator-design.md)
    ...(equipCalcEnabled
      ? [{
          key: "equipCalc",
          icon: <SwordsIcon size={28} />,
          title: t("equipCalc.title"),
          description: t("equipCalc.description"),
          metaLabel: t("equipCalc.versionLabel"),
          metaValue: equipCalcDataVersion,
          onOpen: equipCalcHandlers.open,
        }]
      : []),
  ];

  return (
    <PageLayout title={t("title")} subtitle={t("subtitle")} icon={<WrenchIcon size={22} />}>
      {isExternalView ? (
        <Alert color="gray" title={t("sandbox.readOnlyHint")} />
      ) : null}

      {/* 5 columns squeezed each card to ~200px, which wrapped every title; 3 gives
          the title one line and leaves the meta row readable. */}
      <PageLayout.Grid cols={{ xs: 1, sm: 2, md: 3 }} gap={16}>
        {toolCards.map((tool) => (
          <PortalCard
            key={tool.key}
            className="tool-card"
          >
            <button
              type="button"
              className="tool-card__btn"
              onClick={() => {
                if (isExternalView) return;
                tool.onOpen();
              }}
            >
              <div className="tool-card__content">
                {/* h2, not h3: the page title is the h1, so h3 skipped a level. */}
                <Title order={2} className="tool-card__title">
                  {tool.title}
                </Title>
                <Text c="dimmed" className="tool-card__description">
                  {tool.description}
                </Text>
                {tool.metaValue ? (
                  <div className="tool-card__meta">
                    <Text size="xs" c="dimmed" fw={700}>{tool.metaLabel}</Text>
                    <Text size="xs" c="dimmed" title={tool.metaValue}>{tool.metaValue}</Text>
                  </div>
                ) : null}
              </div>
              <div className="tool-card__icon-wrap">
                <div className="tool-card__icon">{tool.icon}</div>
              </div>
            </button>
          </PortalCard>
        ))}
      </PageLayout.Grid>

      <TitleSandboxModal opened={sandboxOpened} onClose={sandboxHandlers.close} />

      <DiceRollerModal opened={diceOpened} onClose={diceHandlers.close} />

      {equipCalcEnabled && (
        <Suspense>
          <LazyEquipmentCalcModal opened={equipCalcOpened} onClose={equipCalcHandlers.close} />
        </Suspense>
      )}
    </PageLayout>
  );
}
