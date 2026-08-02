import { Alert, Paper, SimpleGrid, Stack, Text, Title, UnstyledButton } from "@mantine/core";
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
      <Stack gap={16}>
      {isExternalView ? (
        <Alert color="gray" title={t("page.readOnlyHint")} />
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
              </div>
              <div className="tool-card__icon-wrap">
                <div className="tool-card__icon">{tool.icon}</div>
              </div>
            </UnstyledButton>
          </Paper>
        ))}
      </SimpleGrid>
      </Stack>

      <DiceRollerModal opened={diceOpened} onClose={diceHandlers.close} />
    </PageLayout>
  );
}
