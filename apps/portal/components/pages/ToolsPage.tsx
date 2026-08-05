import { Alert, Paper, Stack, Text, Title, UnstyledButton } from "@mantine/core";
import { DiceFiveFilledIcon } from "@portal/components/icons";
import { DiceRollerModal } from "@portal/components/feature/tools/DiceRollerModal";
import { useTranslation } from "react-i18next";
import { useDisclosure } from "@mantine/hooks";
import { useExternalView } from "../../hooks/useExternalView";
import { PageLayout } from "../layout/PageLayout";
import "./ToolsPage.css";
import type { ReactNode } from "react";

type ToolCard = {
  key: string;
  icon: ReactNode;
  title: string;
  description: string;
  onOpen: () => void;
};

export function ToolsPage() {
  const { t } = useTranslation("tools");
  const isExternalView = useExternalView();
  const [diceOpened, diceHandlers] = useDisclosure(false);

  const toolCards: ToolCard[] = [
    {
      key: "dice",
      icon: <DiceFiveFilledIcon size={28} />,
      title: t("dice.title"),
      description: t("dice.description"),
      onOpen: diceHandlers.open,
    },
  ];

  return (
    <PageLayout>
      <Stack gap="lg" className="tools-page">
        <Text c="dimmed" className="tools-page__description">
          {t("page.description")}
        </Text>

        <Stack gap="md" className="tools-page__utility">
          {isExternalView ? (
            <Alert color="gray" title={t("page.readOnlyHint")} />
          ) : null}

          {toolCards.map((tool) => (
            <Paper key={tool.key} withBorder className="tool-launch-panel">
              <UnstyledButton
                className="tool-launch-panel__button"
                disabled={isExternalView}
                aria-disabled={isExternalView}
                onClick={tool.onOpen}
              >
                <div className="tool-launch-panel__icon" aria-hidden>
                  {tool.icon}
                </div>
                <div className="tool-launch-panel__content">
                  {/* h2 follows the route-level h1 owned by the application shell. */}
                  <Title order={2} className="tool-launch-panel__title">
                    {tool.title}
                  </Title>
                  <Text c="dimmed" className="tool-launch-panel__description">
                    {tool.description}
                  </Text>
                  <Text component="span" className="tool-launch-panel__action">
                    {t("dice.open")}
                  </Text>
                </div>
              </UnstyledButton>
            </Paper>
          ))}
        </Stack>
      </Stack>

      <DiceRollerModal opened={diceOpened} onClose={diceHandlers.close} />
    </PageLayout>
  );
}
