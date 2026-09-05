import { Button } from "@portal/components/ui/button";
import { Card, CardContent } from "@portal/components/ui/card";
import { LoadingIndicator } from "@portal/components/ui/loading-indicator";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useAppError } from "../../hooks/useAppError";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { useExternalView } from "../../hooks/useExternalView";
import { PageLayout } from "../layout/PageLayout";
import { EventsWorkspaceSubnav } from "../feature/events/EventsWorkspaceSubnav";
import { useRecurringTemplatesController } from "../feature/events/useRecurringTemplatesController";
import { EmptyState } from "../shared/EmptyState";
import { useTranslation } from "react-i18next";
import "./EventsPage.css";

const LazyRecurringTemplatesTab = lazy(() =>
  import("../feature/events/RecurringTemplatesTab").then((mod) => ({ default: mod.RecurringTemplatesTab })),
);

export function RecurringTemplatesPage() {
  const { t } = useTranslation("events");
  const navigate = useNavigate();
  const { showError } = useAppError();
  const isExternalView = useExternalView();
  const { canManage } = useEffectivePermissions();
  const canManageTemplates = canManage(["events.templates"]) && !isExternalView;
  const controller = useRecurringTemplatesController({
    enabled: canManageTemplates,
    showError,
  });

  return (
    <PageLayout
      className="events-page"
      toolbar={<EventsWorkspaceSubnav value="recurring" canManageTemplates={canManageTemplates} />}
    >
      <Suspense fallback={<LoadingIndicator />}>
        {controller.error ? (
          <Card className="events-page__error-card"><CardContent>
            <EmptyState
              status="error"
              title={t("common:loadError")}
              description={t("error.loadDescription")}
              actions={<Button onClick={() => { void controller.refetchTemplates(); }}>{t("common:action.retry")}</Button>}
            />
          </CardContent></Card>
        ) : (
          <LazyRecurringTemplatesTab
            canManage={canManageTemplates}
            templates={controller.templates}
            loading={controller.loading}
            onCreateTemplate={() => {
              void navigate({ to: "/events/recurring/new", viewTransition: false });
            }}
            onEditTemplate={(template) => {
              void navigate({
                to: "/events/recurring/$templateId/edit",
                params: { templateId: template.id },
                viewTransition: false,
              });
            }}
          />
        )}
      </Suspense>
    </PageLayout>
  );
}
