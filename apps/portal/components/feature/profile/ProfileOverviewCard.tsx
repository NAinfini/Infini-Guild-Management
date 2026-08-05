import type { MemberProfile, User, UserBadge } from "@guild/shared";
import { Text } from "@mantine/core";
import { BoltIcon, PhotoIcon, ClockIcon, SwordsIcon, VideoIcon } from "@portal/components/icons";
import { getMemberStatus, MemberBadgeChip } from "@portal/components/shared/MemberCard";
import { resolveClassCatalogItem, useClassCatalogStore } from "@portal/stores/class-catalog";
import { sanitizeTitleHtml } from "@portal/utils/sanitize";
import { weeklyAvailableMinutes } from "@portal/utils/availability";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ClassIcon } from "../../shared/ClassIcon";
import { resolveProfileMediaUrl } from "../../../utils/media";

type ProfileOverviewCardProps = {
  user: User | null;
  profile: MemberProfile | null | undefined;
  badges: UserBadge[];
  power: number;
  titleHtml: string;
  classList: string[];
  imageList: string[];
  videoList: string[];
  availabilityData: Record<string, unknown> | null;
};

/**
 * 「主页」屏顶上的全宽概览条。
 *
 * 它答的问题和下面的表单不同：表单是「改什么」，这里是「现在是什么」——头像、
 * 在线状态、角色、加入时间、徽章，以及五个一眼看完的计数。
 *
 * 计数取的是草稿（form 里的那几个数组），不是服务端的 profile：改完还没保存时，
 * 这条要跟着草稿动，否则它会和右栏的名片预览对不上。加入时间和资料更新时间没有
 * 草稿一说，取服务端的值。
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
}: ProfileOverviewCardProps) {
  const { t, i18n } = useTranslation("profile");
  const classCatalog = useClassCatalogStore((state) => state.items);

  const safeTitleHtml = useMemo(
    () => (titleHtml ? sanitizeTitleHtml(titleHtml) : ""),
    [titleHtml],
  );

  if (!user || !profile) return null;

  const status = getMemberStatus(user, profile);
  const classItems = classList.map((classId) => resolveClassCatalogItem(classId, classCatalog));
  const primaryColor = classItems[0]?.color ?? null;
  const avatarSrc = profile.avatar_key ? resolveProfileMediaUrl(profile.avatar_key) : null;
  const weekHours = Math.round(weeklyAvailableMinutes(availabilityData) / 60);
  const formatDay = (value: string) => new Date(value).toLocaleDateString(i18n.language);

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
        </span>

        <div className="profile-overview__who">
          <div className="profile-overview__name-row">
            <h2 className="profile-overview__name">{user.username}</h2>
            <span className="profile-overview__role">{user.role}</span>
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
