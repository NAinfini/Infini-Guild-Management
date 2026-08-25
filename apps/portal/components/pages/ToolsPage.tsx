import { DiceFiveFilledIcon } from "@portal/components/icons";
import { DiceRollerModal } from "@portal/components/feature/tools/DiceRollerModal";
import { Alert, AlertTitle } from "@portal/components/ui/alert";
import { Card } from "@portal/components/ui/card";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useExternalView } from "../../hooks/useExternalView";
import { PageLayout } from "../layout/PageLayout";
import "./ToolsPage.css";

export function ToolsPage() {
  const { t } = useTranslation("tools");
  const isExternalView = useExternalView();
  const [diceOpened, setDiceOpened] = useState(false);

  return (
    <PageLayout>
      <div className="tools-page">
        <div className="tools-page__utility">
          {isExternalView ? (
            <Alert>
              <AlertTitle>{t("page.readOnlyHint")}</AlertTitle>
            </Alert>
          ) : null}

          <Card className="tool-launch-panel py-0">
            <button
              type="button"
              className="tool-launch-panel__button"
              disabled={isExternalView}
              aria-disabled={isExternalView}
              onClick={() => setDiceOpened(true)}
            >
              <span className="tool-launch-panel__semantic-icon" aria-hidden="true">
                <DiceFiveFilledIcon size={28} />
              </span>
              <span className="tool-launch-panel__content">
                {/* h2 follows the route-level h1 owned by the application shell. */}
                <h2 className="tool-launch-panel__title">{t("dice.title")}</h2>
                <span className="tool-launch-panel__description">{t("dice.description")}</span>
              </span>
              <span className="tool-launch-panel__action">{t("dice.open")}</span>
            </button>
          </Card>
        </div>
      </div>

      <DiceRollerModal opened={diceOpened} onClose={() => setDiceOpened(false)} />
    </PageLayout>
  );
}
