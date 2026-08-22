import type { MemberAvailability, MemberProfile, User, UserBadge } from "@guild/shared";
import { IMAGE_FILE_ACCEPT } from "@guild/shared";
import { ActionIcon, FileButton, Text, Tooltip } from "@mantine/core";
import { BoltIcon, PhotoIcon, ClockIcon, SwordsIcon, TrashIcon, UploadIcon, VideoIcon } from "@portal/components/icons";
import { getMemberStatus, MemberBadgeChip } from "@portal/components/shared/MemberCard";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useClassCatalog } from "@portal/hooks/data/useClassData";
import { resolveClassCatalogItem } from "@portal/utils/class-catalog";
import { sanitizeTitleHtml } from "@portal/utils/sanitize";
import { weeklyAvailableMinutes } from "@portal/utils/availability";
import { formatLocaleDate } from "@portal/utils/datetime";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ClassIcon } from "./ClassIcon";
import { resolveMediaUrl } from "../../utils/media";
import "./ProfileOverviewCard.css";

type ProfileOverviewCardProps = {
  user: User | null;
  profile: MemberProfile | null | undefined;
  badges: UserBadge[];
  power: number;
  titleHtml: string;
  classList: string[];
  imageList: string[];
  videoList: string[];
  availabilityData: MemberAvailability | null;
  /* 头像操作是可选的：这一条本身只回答「这个人是什么样」。本人的资料页传回调，
     后台成员详情只读地复用同一条，不传。 */
  avatarUploading?: boolean;
  onUploadAvatar?: (file: File) => void;
  onRemoveAvatar?: () => void;
};

/**
 * 「这个人现在是什么样」的全宽概览条。
 *
 * 它答的问题和表单不同：表单是「改什么」，这里是「现在是什么」——头像、
 * 在线状态、加入时间、徽章，以及五个一眼看完的计数。
 *
 * 计数取的是调用方给的值（资料页给草稿、后台给草稿或服务端值），不是自己去查
 * profile：资料页改完还没保存时这条要跟着草稿动，否则它会和名片预览对不上。
 * 加入时间和资料更新时间没有草稿一说，取服务端的值。
 */
export function ProfileOverviewCard({
  user,
  profile,
  badges,
  power,
  titleHtml,
  classList,
  imageList,
  videoList,
  availabilityData,
  avatarUploading = false,
  onUploadAvatar,
  onRemoveAvatar,
}: ProfileOverviewCardProps) {
  const { t, i18n } = useTranslation("profile");
  const classCatalog = useClassCatalog();
  const confirm = useConfirmDialog();

  const safeTitleHtml = useMemo(
    () => (titleHtml ? sanitizeTitleHtml(titleHtml) : ""),
    [titleHtml],
  );

  if (!user || !profile) return null;

  const status = getMemberStatus(user, profile);
  const classItems = classList.map((classId) => resolveClassCatalogItem(classId, classCatalog));
  const primaryColor = classItems[0]?.color ?? null;
  const avatarSrc = profile.avatar_media_id ? resolveMediaUrl(profile.avatar_media_id) : null;
  const weekHours = Math.round(weeklyAvailableMinutes(availabilityData) / 60);
  const formatDay = (value: string) => formatLocaleDate(value, i18n.language, "numeric");

  const handleRemoveAvatar = async () => {
    if (!onRemoveAvatar) return;
    const confirmed = await confirm({
      title: t("confirm.removeAvatar.title"),
      description: t("confirm.removeAvatar.description"),
      confirmLabel: t("common:action.delete"),
      cancelLabel: t("common:action.cancel"),
      intent: "danger",
    });
    if (confirmed) onRemoveAvatar();
  };

  const stat = (key: string, icon: ReactNode, label: string, value: string) => (
    <div className="profile-overview__stat" key={key}>
      <dt className="profile-overview__stat-label">
        <span className="profile-overview__stat-icon" aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd className="profile-overview__stat-value portal-kpi-value">{value}</dd>
    </div>
  );

  return (
    <section
      className="profile-overview"
      /* 主职业色。和名片预览用同一个来源，两块的色调才是一致的。 */
      style={primaryColor ? ({ "--overview-accent": primaryColor } as CSSProperties) : undefined}
    >
      <div className="profile-overview__identity">
        <span className="profile-overview__avatar">
          {avatarSrc ? (
            <img src={avatarSrc} alt={t("common:a11y.avatar", { name: user.username })} />
          ) : (
            <span aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span>
          )}
          <span
            className={`profile-overview__dot profile-overview__dot--${status}`}
            role="img"
            aria-label={t(`overview.status.${status}`)}
          />

          {/* 换头像的入口就长在头像上，而不是媒体卡里的一个分组：要改的东西
              和点的地方是同一个。只用 opacity 收起来，控件始终留在 tab 序列里，
              :focus-within 让键盘也能把它翻出来。 */}
          {onUploadAvatar || onRemoveAvatar ? (
            <span className="profile-overview__avatar-actions">
              {onUploadAvatar ? (
                <FileButton onChange={(file) => { if (file) onUploadAvatar(file); }} accept={IMAGE_FILE_ACCEPT}>
                  {(props) => (
                    <Tooltip label={t("media.uploadAvatar")} withArrow>
                      <ActionIcon
                        size={44}
                        radius="xl"
                        variant="subtle"
                        color="gray"
                        aria-label={t("media.uploadAvatar")}
                        loading={avatarUploading}
                        className="profile-overview__avatar-upload"
                        {...props}
                      >
                        <UploadIcon size={18} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </FileButton>
              ) : null}
              {avatarSrc && onRemoveAvatar ? (
                <Tooltip label={t("media.removeAvatar")} withArrow>
                  <ActionIcon
                    size={44}
                    radius="xl"
                    variant="subtle"
                    color="red"
                    aria-label={t("media.removeAvatar")}
                    onClick={() => void handleRemoveAvatar()}
                  >
                    <TrashIcon size={18} />
                  </ActionIcon>
                </Tooltip>
              ) : null}
            </span>
          ) : null}
        </span>

        <div className="profile-overview__who">
          <div className="profile-overview__name-row">
            <h2 className="profile-overview__name">{user.username}</h2>
            <span className={`profile-overview__status profile-overview__status--${status}`}>
              {t(`overview.status.${status}`)}
            </span>
          </div>

          {safeTitleHtml ? (
            <div className="profile-overview__title" dangerouslySetInnerHTML={{ __html: safeTitleHtml }} />
          ) : (
            <Text size="sm" c="dimmed">{t("field.titleEmpty")}</Text>
          )}

          {/* 职业和徽章同一行：两者都是「挂在名字上的标签」，分两行会读成两类东西。 */}
          {classItems.length > 0 || badges.length > 0 ? (
            <div className="profile-overview__tags">
              {classItems.map((item) => (
                <span
                  key={item.id}
                  className="profile-overview__class"
                  style={{ "--class-color": item.color } as CSSProperties}
                >
                  <ClassIcon item={item} size={14} framed={false} />
                  {item.label}
                </span>
              ))}
              {badges.map((badge) => (
                <MemberBadgeChip key={badge.id} badge={badge} />
              ))}
            </div>
          ) : null}

          <div className="profile-overview__meta">
            <span>{t("overview.joined")} {formatDay(user.created_at)}</span>
            <span>{t("overview.updated")} {formatDay(profile.updated_at)}</span>
            <span>
              {t("overview.lastLogin")}{" "}
              {user.last_login_at ? formatDay(user.last_login_at) : t("overview.lastLogin.never")}
            </span>
          </div>
        </div>
      </div>

      <dl className="profile-overview__stats">
        {stat("power", <BoltIcon size={13} />, t("field.power"), power.toLocaleString())}
        {stat("classes", <SwordsIcon size={13} />, t("section.classes"), String(classList.length))}
        {stat("images", <PhotoIcon size={13} />, t("gaps.field.images"), String(imageList.length))}
        {stat("videos", <VideoIcon size={13} />, t("media.videos"), String(videoList.length))}
        {stat("week", <ClockIcon size={13} />, t("overview.stat.weekHours"), t("week.hoursShort", { hours: weekHours }))}
      </dl>
    </section>
  );
}
