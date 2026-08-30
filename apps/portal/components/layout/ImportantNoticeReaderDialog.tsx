import type { ImportantNoticeActive } from "@guild/shared";
import { lazy, Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@portal/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { buildTipTapEditorLabels } from "@portal/components/shared/tiptap-meta";
import { formatDateTime } from "../../utils/datetime";
import styles from "./ImportantNoticeGate.module.css";

const LazyTipTapEditor = lazy(() =>
  import("@portal/components/shared/TipTapEditor").then((module) => ({ default: module.TipTapEditor })),
);

export function ImportantNoticeReaderDialog({
  notice,
  onOpenChange,
}: {
  notice: ImportantNoticeActive | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("common");
  const { t: editorTranslation } = useTranslation("editor");
  const editorLabels = useMemo(() => buildTipTapEditorLabels(editorTranslation), [editorTranslation]);

  return (
    <Dialog open={notice !== null} onOpenChange={onOpenChange}>
      <DialogContent className={styles.content} closeLabel={t("action.close")}>
        {notice ? (
          <>
            <div className={styles.hero}>
              <DialogTitle className={styles.title}>{notice.title}</DialogTitle>
              <DialogDescription className={styles.published}>
                {t("importantNotice.published", { date: formatDateTime(notice.published_at) })}
              </DialogDescription>
            </div>
            <div className={styles.reader} tabIndex={0}>
              <Suspense fallback={<p className={styles.muted}>{t("message.loading")}</p>}>
                <LazyTipTapEditor
                  value={notice.body_json}
                  onChange={() => undefined}
                  editable={false}
                  placeholder=""
                  labels={editorLabels}
                />
              </Suspense>
            </div>
            <div className={styles.footer}>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("action.close")}
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
