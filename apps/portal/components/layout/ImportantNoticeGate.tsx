import type { ImportantNoticeActive } from "@guild/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@portal/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { queryKeys } from "../../api/query-keys";
import {
  acknowledgeImportantNotice,
  fetchActiveImportantNotices,
} from "../../services/NotificationService";
import { useAuthStore } from "../../stores/auth";
import { formatDateTime } from "../../utils/datetime";
import { CheckIcon } from "@portal/components/icons";
import { buildTipTapEditorLabels } from "@portal/components/shared/tiptap-meta";
import styles from "./ImportantNoticeGate.module.css";

const LazyTipTapEditor = lazy(() =>
  import("@portal/components/shared/TipTapEditor").then((module) => ({ default: module.TipTapEditor })),
);

export function ImportantNoticeGate() {
  const { t } = useTranslation("common");
  const { t: editorTranslation } = useTranslation("editor");
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const editorLabels = useMemo(() => buildTipTapEditorLabels(editorTranslation), [editorTranslation]);
  const activeQueryKey = queryKeys.importantNotices.active(user?.id);

  const activeQuery = useQuery({
    queryKey: activeQueryKey,
    queryFn: fetchActiveImportantNotices,
    enabled: Boolean(user),
    staleTime: 30_000,
    refetchInterval: () => document.visibilityState === "visible" ? 60_000 : false,
    refetchIntervalInBackground: false,
  });
  const activeNotices = useMemo(
    () => [...(activeQuery.data ?? [])].sort((left, right) => {
      const time = Date.parse(left.published_at) - Date.parse(right.published_at);
      return time || left.id.localeCompare(right.id);
    }),
    [activeQuery.data],
  );

  const requiredNotices = activeNotices.filter((notice) => notice.requires_acknowledgement);
  const currentNotice = requiredNotices.find((notice) => notice.acknowledged_at === null) ?? null;
  const mustResolveNotices = Boolean(user) && (activeQuery.isLoading || activeQuery.isError);
  const shouldBlock = mustResolveNotices || currentNotice !== null;

  useEffect(() => {
    const appRoot = document.getElementById("root");
    if (!shouldBlock || !appRoot) return;
    appRoot.setAttribute("inert", "");
    return () => {
      appRoot.removeAttribute("inert");
    };
  }, [shouldBlock]);

  const acknowledgementMutation = useMutation({
    mutationFn: async (notice: ImportantNoticeActive) => {
      await acknowledgeImportantNotice(notice.id);
      return notice;
    },
    onSuccess: (notice) => {
      const acknowledgedAt = new Date().toISOString();
      queryClient.setQueryData<ImportantNoticeActive[]>(activeQueryKey, (current) => current?.map((entry) => (
        entry.id === notice.id
          ? { ...entry, read_at: entry.read_at ?? acknowledgedAt, acknowledged_at: entry.acknowledged_at ?? acknowledgedAt }
          : entry
      )));
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: activeQueryKey });
    },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: activeQueryKey }); },
  });

  if (!user) return null;
  if (activeQuery.isLoading || activeQuery.isError) {
    const isError = activeQuery.isError;
    return (
      <Dialog open onOpenChange={(_open, details) => details.cancel()}>
        <DialogContent showCloseButton={false} className={styles.content} finalFocus={false}>
          <div className={styles.hero}>
            <DialogTitle className={styles.title}>
              {t(isError ? "importantNotice.loadErrorTitle" : "importantNotice.checking")}
            </DialogTitle>
            <DialogDescription className={styles.published}>
              {t(isError ? "errors.connectionIssue" : "importantNotice.checkingDescription")}
            </DialogDescription>
          </div>
          <div className={styles.footer}>
            {isError ? (
              <Button
                type="button"
                onClick={() => void activeQuery.refetch()}
                disabled={activeQuery.isFetching}
              >
                {t("action.retry")}
              </Button>
            ) : <p className={styles.muted} role="status">{t("message.loading")}</p>}
          </div>
        </DialogContent>
      </Dialog>
    );
  }
  if (!currentNotice) return null;

  const currentIndex = requiredNotices.findIndex((notice) => notice.id === currentNotice.id) + 1;

  return (
    <Dialog
      open
      onOpenChange={(_open, details) => details.cancel()}
    >
      <DialogContent
        showCloseButton={false}
        className={styles.content}
        finalFocus={false}
      >
        <div className={styles.hero}>
          <div className={styles.heroHeader}>
            <div>
              <DialogTitle className={styles.title}>{currentNotice.title}</DialogTitle>
              <DialogDescription className={styles.published}>
                {t("importantNotice.published", { date: formatDateTime(currentNotice.published_at) })}
              </DialogDescription>
            </div>
            {requiredNotices.length > 1 ? (
              <span className={styles.count}>
                {t("importantNotice.count", { current: currentIndex, total: requiredNotices.length })}
              </span>
            ) : null}
          </div>
        </div>

        <div className={styles.reader} tabIndex={0}>
          <Suspense fallback={<p className={styles.muted}>{t("message.loading")}</p>}>
            <LazyTipTapEditor
              value={currentNotice.body_json}
              onChange={() => undefined}
              editable={false}
              placeholder=""
              labels={editorLabels}
            />
          </Suspense>
        </div>

        <div className={styles.footer}>
          <div className={styles.footerActions}>
            {acknowledgementMutation.isError ? (
              <p role="alert" className={styles.error}>{t("importantNotice.error")}</p>
            ) : null}
            <Button
              type="button"
              onClick={() => acknowledgementMutation.mutate(currentNotice)}
              disabled={acknowledgementMutation.isPending}
            >
              <CheckIcon size={16} aria-hidden />
              {acknowledgementMutation.isPending ? t("importantNotice.confirming") : t("importantNotice.confirm")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
