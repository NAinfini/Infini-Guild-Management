import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Card, CardContent } from "@portal/components/ui/card";
import { Skeleton } from "@portal/components/ui/skeleton";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useAppError } from "../../hooks/useAppError";
import { useBeforeUnloadPrompt } from "../../hooks/useBeforeUnloadPrompt";
import {
  RecurringTemplateFormContent,
  type RecurringTemplateFormPayload,
} from "../feature/events/RecurringTemplateFormContent";
import { useRecurringTemplatesController } from "../feature/events/useRecurringTemplatesController";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import "./EventsPage.css";

type RecurringTemplateEditorPageProps = {
  mode: "create" | "edit";
};

export function RecurringTemplateEditorPage({ mode }: RecurringTemplateEditorPageProps) {
  const { t } = useTranslation("events");
  const navigate = useNavigate();
  const { templateId } = useParams({ strict: false }) as { templateId?: string };
  const { showError } = useAppError();
  const confirm = useConfirmDialog();
  const controller = useRecurringTemplatesController({ enabled: true, showError });
  const [isDirty, setIsDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  useBeforeUnloadPrompt(isDirty && !saved);

  const template = mode === "edit"
    ? controller.templates.find((item) => item.id === templateId) ?? null
    : null;
  const returnToTemplates = useCallback(() => {
    void navigate({ to: "/events/recurring", replace: true, viewTransition: false });
  }, [navigate]);
  useEffect(() => {
    if (saved) returnToTemplates();
  }, [returnToTemplates, saved]);
  const handleSave = useCallback(async (payload: RecurringTemplateFormPayload) => {
    try {
      if (mode === "create") {
        await controller.createRecurringTemplate({
          ...payload,
          description: payload.description ?? undefined,
          duration_minutes: payload.duration_minutes ?? undefined,
          capacity: payload.capacity ?? undefined,
        });
      } else if (template) {
        await controller.updateRecurringTemplate(template.id, payload);
      } else {
        return;
      }
    } catch {
      return;
    }
    setSaved(true);
  }, [controller, mode, template]);
  const handleDelete = useCallback(async (id: string) => {
    const currentTemplate = controller.templates.find((item) => item.id === id);
    if (!currentTemplate) return;
    const confirmed = await confirm({
      title: t("recurring.confirm.delete.title"),
      description: <p>{t("recurring.confirm.delete.description", { title: currentTemplate.title })}</p>,
      confirmLabel: t("common:action.confirm"),
      cancelLabel: t("common:action.cancel"),
      intent: "danger",
    });
    if (!confirmed) return;
    await controller.deleteRecurringTemplate(id);
    setSaved(true);
  }, [confirm, controller, t]);

  if (controller.loading) {
    return <PageLayout className="events-page recurring-template-editor-page"><div className="event-route-loading"><Skeleton className="h-9" /><Skeleton className="h-105" /></div></PageLayout>;
  }
  if (controller.error) {
    return (
      <PageLayout className="events-page recurring-template-editor-page">
        <EmptyState
          status="error"
          title={t("common:loadError")}
          description={t("error.loadDescription")}
          actions={<Button onClick={() => { void controller.refetchTemplates(); }}>{t("common:action.retry")}</Button>}
        />
      </PageLayout>
    );
  }
  if (mode === "edit" && !template) {
    return (
      <PageLayout className="events-page recurring-template-editor-page">
        <EmptyState
          status="error"
          title={t("recurring.empty")}
          actions={<Button onClick={returnToTemplates}>{t("view.recurring")}</Button>}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout className="events-page recurring-template-editor-page">
      <div className="event-route-stack">
        <header className="event-route-header event-route-header--sticky recurring-template-editor-page__header">
          <h1>{mode === "create" ? t("recurring.create") : t("recurring.edit")}</h1>
          {template ? (
            <Badge
              variant={template.paused ? "outline" : "secondary"}
              className="recurring-template-editor-page__status"
            >
              {template.paused ? t("recurring.status.paused") : t("recurring.status.active")}
            </Badge>
          ) : null}
        </header>
        <Card className="recurring-template-editor-page__form"><CardContent>
          <RecurringTemplateFormContent
            mode={mode}
            template={template}
            confirmLoading={controller.formSaving}
            onCancel={returnToTemplates}
            onSave={(payload) => { void handleSave(payload); }}
            onPause={controller.pauseRecurringTemplate}
            onResume={controller.resumeRecurringTemplate}
            onDelete={handleDelete}
            onDirtyChange={setIsDirty}
            stickyActions
          />
        </CardContent></Card>
      </div>
    </PageLayout>
  );
}
