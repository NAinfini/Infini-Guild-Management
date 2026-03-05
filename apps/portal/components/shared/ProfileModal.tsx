import type { MemberProfile, User } from "@guild/shared";
import { Button, Modal, Stack, Text } from "@mantine/core";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import DOMPurify from "dompurify";
import { MediaGallery } from "./MediaGallery";
import styles from "./ProfileModal.module.css";

type ProfileModalProps = {
  open: boolean;
  user: User | null;
  profile: MemberProfile | null;
  onClose: () => void;
  onEdit?: () => void;
  canEdit?: boolean;
  resolveMediaUrl?: (key: string) => string;
};

function defaultMediaResolver(value: string): string {
  return value;
}

export function ProfileModal({
  open,
  user,
  profile,
  onClose,
  onEdit,
  canEdit = false,
  resolveMediaUrl = defaultMediaResolver,
}: ProfileModalProps) {
  const { t } = useTranslation("common");
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const safeTitleHtml = useMemo(
    () =>
      DOMPurify.sanitize(profile?.title_html ?? "", {
        ALLOWED_TAGS: ["span", "b", "strong", "i", "em", "u", "br"],
        ALLOWED_ATTR: ["style"],
      }),
    [profile?.title_html],
  );
  const avatarUrl = profile?.images[0] ? resolveMediaUrl(profile.images[0]) : null;
  const activeTime = user?.updated_at ? new Date(user.updated_at).toLocaleString() : "-";

  useEffect(() => {
    setAvatarLoaded(false);
  }, [open, profile?.id]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      const container = bodyRef.current;
      if (!container) return;
      const firstFocusable = container.querySelector<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      firstFocusable?.focus();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [open]);

  const handleTrapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") {
      return;
    }

    const container = bodyRef.current;
    if (!container) {
      return;
    }
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      ),
    ).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");

    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement as HTMLElement | null;

    if (event.shiftKey) {
      if (!active || active === first || !container.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (!active || active === last || !container.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <Modal
      opened={open}
      title={user ? `${user.username} Profile` : "Profile"}
      onClose={onClose}
      classNames={{ content: styles.modalContent }}
      size="min(1180px, 96vw)"
      centered
      returnFocus
      closeOnClickOutside={false}
      keepMounted={false}
    >
      {!user || !profile ? null : (
        <div ref={bodyRef} onKeyDown={handleTrapFocus} tabIndex={-1}>
          <Stack gap={16} w="100%">
            <div className={styles.header}>
              <div className={styles.avatarWrap}>
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={`${user.username} avatar`}
                  loading="lazy"
                  decoding="async"
                  className={`${styles.avatar}${avatarLoaded ? ` ${styles.avatarLoaded}` : ""}`}
                  onLoad={() => setAvatarLoaded(true)}
                />
              ) : (
                <div className={styles.avatarFallback} aria-hidden="true">
                  {user.username.slice(0, 1).toUpperCase()}
                </div>
              )}
              </div>
              <div className={styles.infoGrid}>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.name")}</span>
                  <Text fw={700}>{user.username}</Text>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.activeTime")}</span>
                  <Text>{activeTime}</Text>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.power")}</span>
                  <Text>{profile.power}</Text>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.title")}</span>
                  <span dangerouslySetInnerHTML={{ __html: safeTitleHtml || "-" }} />
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.class")}</span>
                  <Text>{profile.classes.join(", ") || "-"}</Text>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.bio")}</span>
                  <Text>{profile.bio ?? "-"}</Text>
                </div>
              </div>
            </div>

            <MediaGallery
              images={profile.images}
              videos={profile.video_urls}
              audioKey={profile.audio_key}
              resolveMediaUrl={resolveMediaUrl}
            />

            {canEdit && onEdit ? (
              <div className={styles.editAction}>
                <Button onClick={onEdit} aria-label={`Edit profile for ${user.username}`}>
                  {t("profile.editProfile")}
                </Button>
              </div>
            ) : null}
          </Stack>
        </div>
      )}
    </Modal>
  );
}
