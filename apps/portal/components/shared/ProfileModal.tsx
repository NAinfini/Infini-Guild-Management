import type { MemberProfile, MemberSummary } from "@guild/shared";
import { PencilIcon, XIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MediaGallery, buildMediaGalleryLabels } from "@portal/components/shared/MediaGallery";
import { formatLocaleDateTime } from "../../utils/datetime";
import { sanitizeTitleHtml } from "../../utils/sanitize";
import { useClassCatalog } from "../../hooks/data/useClassData";
import { resolveClassCatalogItem } from "../../utils/class-catalog";
import { ClassIcon } from "./ClassIcon";
import { resolveMediaUrl as resolvePortalMediaUrl } from "../../utils/media";
import styles from "./ProfileModal.module.css";

type ProfileModalProps = {
  open: boolean;
  user: MemberSummary | null;
  profile: MemberProfile | null;
  onClose: () => void;
  onEdit?: () => void;
  canEdit?: boolean;
  editLabel?: string;
  resolveMediaUrl?: (mediaId: string, variant?: "view" | "full") => string;
};

export function ProfileModal({
  open,
  user,
  profile,
  onClose,
  onEdit,
  canEdit = false,
  editLabel,
  resolveMediaUrl = resolvePortalMediaUrl,
}: ProfileModalProps) {
  const { t, i18n } = useTranslation("common");
  const classCatalog = useClassCatalog();
  const mediaLabels = useMemo(() => buildMediaGalleryLabels(t), [t]);
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const safeTitleHtml = useMemo(
    () => sanitizeTitleHtml(profile?.title_html ?? ""),
    [profile?.title_html],
  );
  /* 图标按钮没有可见文案，这句同时当 tooltip 和无障碍名，两处不能各写各的。 */
  const editTitle = editLabel || t("profile.editProfile");
  const avatarUrl = profile?.avatar_media_id ? resolveMediaUrl(profile.avatar_media_id) : null;
  const accountUpdated = formatLocaleDateTime(user?.updated_at, i18n.language, "numeric");
  const classItems = useMemo(
    () => (profile?.classes ?? []).map((id) => resolveClassCatalogItem(id, classCatalog)),
    [classCatalog, profile?.classes],
  );

  useEffect(() => {
    setAvatarLoaded(false);
    setAvatarError(false);
  }, [open, profile?.user_id]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (nextOpen) return;
        if (details.reason === "outside-press") {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      <DialogContent showCloseButton={false} className={styles.modalContent}>
        <DialogHeader className={styles.modalTitle}>
          <DialogTitle className={styles.modalHeading}>
            {t("profile.modalTitle", { name: user?.display_name ?? "" })}
          </DialogTitle>
          <div className={styles.modalActions}>
            {user && canEdit && onEdit ? (
              <Tooltip>
                <TooltipTrigger
                  render={(
                    <Button type="button" variant="outline" size="icon-sm" aria-label={editTitle} onClick={onEdit} />
                  )}
                >
                  <PencilIcon size={14} />
                </TooltipTrigger>
                <TooltipContent>{editTitle}</TooltipContent>
              </Tooltip>
            ) : null}
            <DialogClose
              render={(
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t("action.close")} />
              )}
            >
              <XIcon aria-hidden />
            </DialogClose>
          </div>
        </DialogHeader>
        <div className={styles.modalBody}>
          {!user || !profile ? null : (
            <div className={styles.modalStack}>
            <div className={styles.header}>
              <div className={styles.avatarWrap}>
                {avatarUrl && !avatarError ? (
                  <img
                    src={avatarUrl}
                    alt={t("a11y.avatar", { name: user.display_name })}
                    loading="lazy"
                    decoding="async"
                    className={`${styles.avatar}${avatarLoaded ? ` ${styles.avatarLoaded}` : ""}`}
                    onLoad={() => setAvatarLoaded(true)}
                    onError={() => setAvatarError(true)}
                  />
                ) : (
                  <div className={styles.avatarFallback} aria-hidden="true">
                    {user.display_name.slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
              <div className={styles.infoGrid}>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.name")}</span>
                  <strong className={styles.fieldValue}>{user.display_name}</strong>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.accountUpdated")}</span>
                  <span className={styles.fieldValue}>{accountUpdated}</span>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.power")}</span>
                  <span className={styles.fieldValue}>{profile.power}</span>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.title")}</span>
                  <span className={styles.fieldValue} dangerouslySetInnerHTML={{ __html: safeTitleHtml || "-" }} />
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.class")}</span>
                  {classItems.length > 0 ? (
                    <div className={`${styles.fieldValue} ${styles.classList}`}>
                      {classItems.map((item) => (
                        <span key={item.id} className={styles.classItem}>
                          <ClassIcon item={item} size={20} />
                          <span>{item.label}</span>
                        </span>
                      ))}
                    </div>
                  ) : <span className={styles.fieldValue}>-</span>}
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.bio")}</span>
                  <span className={styles.fieldValue}>{profile.bio ?? "-"}</span>
                </div>
              </div>
            </div>

            <MediaGallery
              images={profile.images}
              videos={profile.video_urls}
              resolveMediaUrl={resolveMediaUrl}
              labels={mediaLabels}
            />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
