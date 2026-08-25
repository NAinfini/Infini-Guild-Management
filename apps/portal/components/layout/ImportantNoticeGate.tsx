import type { ImportantNoticeAcknowledgement, ImportantNoticeActive } from "@guild/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
  fetchImportantNoticeAcknowledgements,
} from "../../services/NotificationService";
import { useAuthStore } from "../../stores/auth";
import { formatDateTime } from "../../utils/datetime";
import { CheckIcon } from "@portal/components/icons";
import { buildTipTapEditorLabels } from "@portal/components/shared/tiptap-meta";
import styles from "./ImportantNoticeGate.module.css";

const LOCAL_ACKNOWLEDGEMENT_PREFIX = "portal:important-notice-ack";

const LazyTipTapEditor = lazy(() =>
  import("@portal/components/shared/TipTapEditor").then((module) => ({ default: module.TipTapEditor })),
);

export function importantNoticeAcknowledgementStorageKey(
  notice: Pick<ImportantNoticeActive, "id" | "publication_revision">,
): string {
  return `${LOCAL_ACKNOWLEDGEMENT_PREFIX}:${notice.id}:${notice.publication_revision}`;
}

function hasLocalAcknowledgement(notice: ImportantNoticeActive): boolean {
  try {
    return window.localStorage.getItem(importantNoticeAcknowledgementStorageKey(notice)) === "1";
  } catch {
    return false;
  }
}

function writeLocalAcknowledgement(notice: ImportantNoticeActive): boolean {
  try {
    window.localStorage.setItem(importantNoticeAcknowledgementStorageKey(notice), "1");
    return true;
  } catch {
    return false;
  }
}

function acknowledgementKey(acknowledgement: Pick<ImportantNoticeAcknowledgement, "notice_id" | "publication_revision">): string {
  return `${acknowledgement.notice_id}:${acknowledgement.publication_revision}`;
}

function noticeKey(notice: Pick<ImportantNoticeActive, "id" | "publication_revision">): string {
  return `${notice.id}:${notice.publication_revision}`;
}

export function ImportantNoticeGate() {
  const { t } = useTranslation("common");
  const { t: editorTranslation } = useTranslation("editor");
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [localAcknowledgementVersion, setLocalAcknowledgementVersion] = useState(0);
  const editorLabels = useMemo(() => buildTipTapEditorLabels(editorTranslation), [editorTranslation]);

  const activeQuery = useQuery({
    queryKey: queryKeys.importantNotices.active(),
    queryFn: fetchActiveImportantNotices,
    staleTime: 30_000,
    refetchInterval: () => document.visibilityState === "visible" ? 60_000 : false,
    refetchIntervalInBackground: false,
  });
  const acknowledgementsQuery = useQuery({
    queryKey: queryKeys.importantNotices.acknowledgements(user?.id),
    queryFn: fetchImportantNoticeAcknowledgements,
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  const activeNotices = useMemo(
    () => [...(activeQuery.data ?? [])].sort((left, right) => {
      const time = Date.parse(left.published_at) - Date.parse(right.published_at);
      return time || left.id.localeCompare(right.id);
    }),
    [activeQuery.data],
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!event.key?.startsWith(`${LOCAL_ACKNOWLEDGEMENT_PREFIX}:`)) return;
      setLocalAcknowledgementVersion((current) => current + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [activeNotices]);

  const localAcknowledged = useMemo(() => {
    void localAcknowledgementVersion;
    return user
      ? new Set<string>()
      : new Set(activeNotices.filter((notice) => hasLocalAcknowledgement(notice)).map(noticeKey));
  }, [activeNotices, localAcknowledgementVersion, user]);
  const serverAcknowledged = useMemo(
    () => new Set((acknowledgementsQuery.data ?? []).map(acknowledgementKey)),
    [acknowledgementsQuery.data],
  );
  const queue = activeNotices.filter((notice) => !localAcknowledged.has(noticeKey(notice)) && !serverAcknowledged.has(noticeKey(notice)));
  const currentNotice = queue[0] ?? null;

  useEffect(() => {
    const appRoot = document.getElementById("root");
    if (!currentNotice || !appRoot) return;
    appRoot.setAttribute("inert", "");
    return () => {
      appRoot.removeAttribute("inert");
    };
  }, [currentNotice]);

  const acknowledgementMutation = useMutation({
    mutationFn: async (notice: ImportantNoticeActive) => {
      if (user) {
        await acknowledgeImportantNotice(notice.id, notice.publication_revision);
      } else if (!writeLocalAcknowledgement(notice)) {
        throw new Error("Unable to store the important-notice acknowledgement locally");
      }
      return notice;
    },
    onSuccess: (notice) => {
      if (user) {
        queryClient.setQueryData<ImportantNoticeAcknowledgement[]>(
          queryKeys.importantNotices.acknowledgements(user.id),
          (current) => [...(current ?? []), { notice_id: notice.id, publication_revision: notice.publication_revision }],
        );
      } else {
        setLocalAcknowledgementVersion((current) => current + 1);
      }
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.importantNotices.active() });
    },
  });

  // A signed-in visitor's server acknowledgements must arrive before deciding
  // whether a notice is blocking; otherwise a cross-device acknowledgement flashes.
  if (user && acknowledgementsQuery.isLoading) return null;
  if (!currentNotice) return null;

  const currentIndex = activeNotices.findIndex((notice) => noticeKey(notice) === noticeKey(currentNotice)) + 1;

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
            {activeNotices.length > 1 ? (
              <span className={styles.count}>
                {t("importantNotice.count", { current: currentIndex, total: activeNotices.length })}
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
