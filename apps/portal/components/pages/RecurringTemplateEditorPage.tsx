import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Card, CardContent } from "@portal/components/ui/card";
import { LoadingIndicator } from "@portal/components/ui/loading-indicator";
import type { ImageGridEditorItem } from "@portal/types/media";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useAppError } from "../../hooks/useAppError";
import { useBeforeUnloadPrompt } from "../../hooks/useBeforeUnloadPrompt";
import { useAttachmentService } from "../../services/AttachmentService";
import { resolveMediaUrl } from "../../utils/media";
import {
  RecurringTemplateFormContent,
  type RecurringTemplateFormPayload,
} from "../feature/events/RecurringTemplateFormContent";
import { useRecurringTemplatesController } from "../feature/events/useRecurringTemplatesController";
import { ArrowLeftIcon } from "../icons";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import "./EventsPage.css";

type RecurringTemplateEditorPageProps = {
  mode: "create" | "edit";
};

function buildAttachmentSnapshot(items: ImageGridEditorItem[]) {
  return JSON.stringify(items.map((item) => ({ id: item.id, hasFile: Boolean(item.file) })));
}

export function RecurringTemplateEditorPage({ mode }: RecurringTemplateEditorPageProps) {
  const { t } = useTranslation("events");
  const navigate = useNavigate();
  const { templateId } = useParams({ strict: false }) as { templateId?: string };
  const { showError } = useAppError();
  const confirm = useConfirmDialog();
  const controller = useRecurringTemplatesController({ enabled: true, showError });
  const attachmentService = useAttachmentService();
  const [formDirty, setFormDirty] = useState(false);
  const [attachmentItems, setAttachmentItems] = useState<ImageGridEditorItem[]>([]);
  const [attachmentBaseline, setAttachmentBaseline] = useState("[]");
  const [saved, setSaved] = useState(false);
  const attachmentItemsRef = useRef(attachmentItems);
  const attachmentIdentityRef = useRef<string | null>(null);
  const attachmentSnapshot = useMemo(() => buildAttachmentSnapshot(attachmentItems), [attachmentItems]);
  const isDirty = formDirty || attachmentSnapshot !== attachmentBaseline;
  useBeforeUnloadPrompt(isDirty && !saved);

  const template = mode === "edit"
    ? controller.templates.find((item) => item.id === templateId) ?? null
    : null;
  const editingRevisionRef = useRef<{ templateId: string; updatedAt: string } | null>(null);
  if (mode === "create") {
    editingRevisionRef.current = null;
  } else if (template && editingRevisionRef.current?.templateId !== template.id) {
    // Keep the revision that initialized this form: a background refetch must not make an old draft current.
    editingRevisionRef.current = { templateId: template.id, updatedAt: template.updated_at };
  }
  const attachmentIdentity = mode === "create" ? "create" : template ? `edit:${template.id}` : null;
  useEffect(() => {
    attachmentItemsRef.current = attachmentItems;
  }, [attachmentItems]);
  useEffect(() => () => {
    attachmentService.releaseItems(attachmentItemsRef.current);
  }, [attachmentService]);
  useEffect(() => {
    if (!attachmentIdentity || attachmentIdentityRef.current === attachmentIdentity) return;
    const nextItems = (template?.attachments ?? []).map((mediaId, index) => ({
      id: mediaId,
      src: resolveMediaUrl(mediaId),
      alt: t("recurring.media.imageAlt", { index: index + 1 }),
    }));
    setAttachmentItems((current) => {
      attachmentService.releaseItems(current);
      return nextItems;
    });
    setAttachmentBaseline(buildAttachmentSnapshot(nextItems));
    attachmentIdentityRef.current = attachmentIdentity;
  }, [attachmentIdentity, attachmentService, t, template]);
  const returnToTemplates = useCallback(() => {
    void navigate({ to: "/events/recurring", replace: true, viewTransition: false });
  }, [navigate]);
  useEffect(() => {
    if (saved) returnToTemplates();
  }, [returnToTemplates, saved]);
  const handleFilesSelected = useCallback(async (files: File[]) => {
    try {
      const prepared = await attachmentService.prepareFiles(files);
      setAttachmentItems((current) => [...current, ...prepared]);
    } catch (error) {
      showError(error, t("recurring.message.imagePrepareFailed"));
    }
  }, [attachmentService, showError, t]);
  const handleAttachmentDelete = useCallback((item: ImageGridEditorItem) => {
    attachmentService.releaseItem(item);
    setAttachmentItems((current) => current.filter((candidate) => candidate.id !== item.id));
  }, [attachmentService]);
  const handleSave = useCallback(async (payload: RecurringTemplateFormPayload) => {
    const attachments = attachmentService.extractExistingMediaIds(attachmentItems);
    const files = attachmentService.extractNewFiles(attachmentItems);
    try {
      if (mode === "create") {
        await controller.createRecurringTemplate({
          ...payload,
          description: payload.description ?? undefined,
          duration_minutes: payload.duration_minutes ?? undefined,
          capacity: payload.capacity ?? undefined,
          attachments,
        }, files);
      } else if (template) {
        const expectedUpdatedAt = editingRevisionRef.current?.templateId === template.id
          ? editingRevisionRef.current.updatedAt
          : null;
        if (!expectedUpdatedAt) return;
        await controller.updateRecurringTemplate(template.id, {
          ...payload,
          attachments,
          expected_updated_at: expectedUpdatedAt,
        }, files);
      } else {
        return;
      }
    } catch {
      return;
    }
    setSaved(true);
  }, [attachmentItems, attachmentService, controller, mode, template]);
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
    return <PageLayout className="events-page recurring-template-editor-page"><LoadingIndicator /></PageLayout>;
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
          <div className="event-route-header__title">
            <Button
              variant="outline"
              size="sm"
              className="event-route-header__back"
              onClick={returnToTemplates}
            >
              <ArrowLeftIcon size={15} />
              {t("recurring.backToList")}
            </Button>
            <h2>{mode === "create" ? t("recurring.create") : t("recurring.edit")}</h2>
          </div>
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
            attachmentItems={attachmentItems}
            onAttachmentsChange={setAttachmentItems}
            onFilesSelected={(files) => { void handleFilesSelected(files); }}
            onAttachmentDelete={handleAttachmentDelete}
            onDirtyChange={setFormDirty}
            stickyActions
          />
        </CardContent></Card>
      </div>
    </PageLayout>
  );
}
