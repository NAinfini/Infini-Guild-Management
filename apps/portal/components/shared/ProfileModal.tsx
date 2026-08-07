import type { MemberProfile, User } from "@guild/shared";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { PencilIcon } from "@portal/components/icons";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { MediaGallery, buildMediaGalleryLabels } from "@portal/components/shared/MediaGallery";
import { sanitizeTitleHtml } from "../../utils/sanitize";
import { resolveClassCatalogItem, useClassCatalogStore } from "../../stores/class-catalog";
import { ClassIcon } from "./ClassIcon";
import styles from "./ProfileModal.module.css";

type ProfileModalProps = {
  open: boolean;
  user: User | null;
  profile: MemberProfile | null;
  onClose: () => void;
  onEdit?: () => void;
  canEdit?: boolean;
  editLabel?: string;
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
  editLabel,
  resolveMediaUrl = defaultMediaResolver,
}: ProfileModalProps) {
  const { t, i18n } = useTranslation("common");
  const classCatalog = useClassCatalogStore((state) => state.items);
  const mediaLabels = useMemo(() => buildMediaGalleryLabels(t), [t]);
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const safeTitleHtml = useMemo(
    () => sanitizeTitleHtml(profile?.title_html ?? ""),
    [profile?.title_html],
  );
  const avatarUrl = profile?.avatar_key ? resolveMediaUrl(profile.avatar_key) : null;
  const accountUpdated = user?.updated_at ? new Date(user.updated_at).toLocaleString(i18n.language) : "-";
  const classItems = useMemo(
    () => (profile?.classes ?? []).map((id) => resolveClassCatalogItem(id, classCatalog)),
    [classCatalog, profile?.classes],
  );

  useEffect(() => {
    setAvatarLoaded(false);
    setAvatarError(false);
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
      title={
        user ? (
          <Group gap={12} wrap="nowrap" justify="space-between" style={{ flex: 1 }}>
            <Text component="span" fw={700} size="lg" className={styles.modalHeading}>
              {t("profile.modalTitle", { name: user.username })}
            </Text>
            {canEdit && onEdit ? (
              <Button
                onClick={onEdit}
                variant="default"
                size="sm"
                leftSection={<PencilIcon size={14} />}
              >
                {editLabel || t("profile.editProfile")}
              </Button>
            ) : null}
          </Group>
        ) : undefined
      }
      onClose={onClose}
      classNames={{ content: styles.modalContent, title: styles.modalTitle, body: styles.modalBody }}
      size="min(1180px, 96vw)"
      centered
      returnFocus
      closeOnClickOutside={false}
      keepMounted={false}
    >
      {!user || !profile ? null : (
        <div ref={bodyRef} onKeyDown={handleTrapFocus} tabIndex={-1}>
          <Stack gap="var(--space-xl)" w="100%">
            <div className={styles.header}>
              <div className={styles.avatarWrap}>
                {avatarUrl && !avatarError ? (
                  <img
                    src={avatarUrl}
                    alt={t("a11y.avatar", { name: user.username })}
                    loading="lazy"
                    decoding="async"
                    className={`${styles.avatar}${avatarLoaded ? ` ${styles.avatarLoaded}` : ""}`}
                    onLoad={() => setAvatarLoaded(true)}
                    onError={() => setAvatarError(true)}
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
                  <Text fw={700} className={styles.fieldValue}>{user.username}</Text>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.accountUpdated")}</span>
                  <Text className={styles.fieldValue}>{accountUpdated}</Text>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.role")}</span>
                  <Text
                    className={`${styles.fieldValue} ${styles.roleValue}`}
                    style={user.role_color ? ({ "--role-color": user.role_color } as CSSProperties) : undefined}
                  >
                    {user.role_name}
                  </Text>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.power")}</span>
                  <Text className={styles.fieldValue}>{profile.power}</Text>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.title")}</span>
                  <span className={styles.fieldValue} dangerouslySetInnerHTML={{ __html: safeTitleHtml || "-" }} />
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.class")}</span>
                  {classItems.length > 0 ? (
                    <Group gap={8} wrap="wrap" className={styles.fieldValue}>
                      {classItems.map((item) => (
                        <Group key={item.id} gap={4} wrap="nowrap">
                          <ClassIcon item={item} size={20} />
                          <Text size="sm">{item.label}</Text>
                        </Group>
                      ))}
                    </Group>
                  ) : <Text className={styles.fieldValue}>-</Text>}
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t("profile.field.bio")}</span>
                  <Text className={styles.fieldValue}>{profile.bio ?? "-"}</Text>
                </div>
              </div>
            </div>

            <MediaGallery
              images={profile.images}
              videos={profile.video_urls}
              resolveMediaUrl={resolveMediaUrl}
              labels={mediaLabels}
            />
          </Stack>
        </div>
      )}
    </Modal>
  );
}
