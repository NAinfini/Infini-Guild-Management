import { Alert, Paper, SimpleGrid, Stack, Text, Title, UnstyledButton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { DiceFiveFilledIcon, SwordsIcon } from "@portal/components/icons";
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
    // Equipment calculator — in-house tool enabled by the active game configuration.
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
    <PageLayout>
      <Stack gap={16}>
      {isExternalView ? (
        <Alert color="gray" title={t("sandbox.readOnlyHint")} />
      ) : null}

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing={{ base: 12, md: 16 }}>
        {toolCards.map((tool) => (
          <Paper key={tool.key} withBorder className="tool-card">
            <UnstyledButton
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
            </UnstyledButton>
          </Paper>
        ))}
      </SimpleGrid>
      </Stack>

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
