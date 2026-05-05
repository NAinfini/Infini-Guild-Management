import type { ClassName, MemberProfile, User } from "@guild/shared";
import { CLASS_COLOR_GROUP, CLASS_NAMES } from "@guild/shared";
import DOMPurify from "dompurify";
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseAvailabilityRanges } from "../../utils/availability";
import "./MemberCard.css";

type MemberCardProps = {
  user: User;
  profile: MemberProfile;
  onClick?: () => void;
  onDoubleClick?: () => void;
  compact?: boolean;
  selected?: boolean;
  resolveMediaUrl?: (key: string) => string;
};

type MemberStatus = "active" | "inactive" | "vacation";

function isClassName(value: string): value is ClassName {
  return (CLASS_NAMES as readonly string[]).includes(value);
}

function resolveClassGroup(className: string | null): string {
  if (!className || !isClassName(className)) {
    return "blue";
  }
  return CLASS_COLOR_GROUP[className];
}

function getMemberStatus(user: User, profile: MemberProfile): MemberStatus {
  if (!user.is_active) {
    return "inactive";
  }

  if (profile.vacation_start && profile.vacation_end) {
    const now = Date.now();
    const start = Date.parse(profile.vacation_start);
    const end = Date.parse(profile.vacation_end);
    if (!Number.isNaN(start) && !Number.isNaN(end) && now >= start && now <= end) {
      return "vacation";
    }
  }

  const rangesByDay = parseAvailabilityRanges(profile.availability);
  const nowUtc = new Date();
  const dayIndex = nowUtc.getUTCDay();
  const currentMinutes = nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes();
  const ranges = rangesByDay.get(dayIndex) ?? [];

  for (const range of ranges) {
    if (currentMinutes >= range.startMinutes && currentMinutes < range.endMinutes) {
      return "active";
    }
  }

  return "inactive";
}

function defaultMediaResolver(value: string): string {
  return value;
}

export const MemberCard = memo(function MemberCard({
  user,
  profile,
  onClick,
  onDoubleClick,
  compact = false,
  selected = false,
  resolveMediaUrl = defaultMediaResolver,
}: MemberCardProps) {
  const { t } = useTranslation("common");
  const primaryClass = profile.classes[0] ?? null;
  const classGroup = resolveClassGroup(primaryClass);
  const status = getMemberStatus(user, profile);
  const avatarKey = profile.avatar_key ?? null;
  const avatarSrc = avatarKey ? resolveMediaUrl(avatarKey) : null;
  const [avatarBroken, setAvatarBroken] = useState(false);

  const titleHtml = useMemo(
    () =>
      DOMPurify.sanitize(profile.title_html ?? "", {
        ALLOWED_TAGS: ["span", "b", "strong", "i", "em", "u", "br"],
        ALLOWED_ATTR: ["style"],
      }),
    [profile.title_html],
  );

  if (compact) {
    return (
      <button
        type="button"
        className={`member-card member-card--compact member-card--${classGroup}${selected ? " member-card--selected" : ""}`}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        aria-label={t("a11y.select", { name: user.username })}
      >
        <span className="member-card__compact-username">{user.username}</span>
        <span className="member-card__compact-meta">{primaryClass ?? "-"}</span>
        <span className="member-card__compact-meta">{t("member.power")} {profile.power}</span>
      </button>
    );
  }

  return (
    <div className="member-card__frame" onClick={onClick} onDoubleClick={onDoubleClick} role="presentation">
      <button
        type="button"
        className={`member-card member-card--full member-card--animated${selected ? " member-card--selected" : ""}`}
        tabIndex={-1}
        aria-label={t("a11y.openProfile", { name: user.username })}
      >
        <div className="member-card__avatar-wrap">
          {avatarSrc && !avatarBroken ? (
            <img
              src={avatarSrc}
              alt={t("a11y.avatar", { name: user.username })}
              loading="lazy"
              decoding="async"
              className="member-card__avatar"
              onError={() => setAvatarBroken(true)}
            />
          ) : (
            <div className="member-card__avatar-fallback" aria-hidden="true">
              {user.username.slice(0, 1).toUpperCase()}
            </div>
          )}
          <span
            className={`member-card__status-dot member-card__status-dot--${status}`}
            aria-label={t("a11y.status", { status })}
          />
        </div>

        <div className="member-card__meta-row">
          <span className="member-card__pill member-card__pill--photo">{t("member.photo")} {profile.images.length}</span>
          <span className="member-card__pill member-card__pill--video">{t("member.video")} {profile.video_urls.length}</span>
        </div>

        <div className="member-card__content">
          <span className="member-card__username">{user.username}</span>
          <div className="member-card__title" dangerouslySetInnerHTML={{ __html: titleHtml || "&nbsp;" }} />
        </div>
      </button>
    </div>
  );
});

