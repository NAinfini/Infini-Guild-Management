import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageSubnav } from "../../shared/PageSubnav";

export type EventsWorkspace = "events" | "recurring";

type EventsWorkspaceSubnavProps = {
  value: EventsWorkspace;
  canManageTemplates: boolean;
};

export function EventsWorkspaceSubnav({ value, canManageTemplates }: EventsWorkspaceSubnavProps) {
  const { t } = useTranslation("events");
  const navigate = useNavigate();

  return (
    <PageSubnav
      value={value}
      label={t("navigation.section")}
      items={[
        { value: "events", label: t("view.events") },
        ...(canManageTemplates ? [{ value: "recurring" as const, label: t("view.recurring") }] : []),
      ]}
      onChange={(nextWorkspace) => {
        void navigate({
          to: nextWorkspace === "events" ? "/events" : "/events/recurring",
          viewTransition: false,
        });
      }}
    />
  );
}
