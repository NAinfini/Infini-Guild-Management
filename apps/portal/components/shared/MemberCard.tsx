import type { ClassName, MemberProfile, User, UserBadge } from "@guild/shared";
import { CLASS_COLOR_GROUP, CLASS_NAMES } from "@guild/shared";
import { IconPhoto, IconVideo } from "@tabler/icons-react";
import DOMPurify from "dompurify";
import { motion, useReducedMotion, useSpring } from "motion/react";
import { memo, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { parseAvailabilityRanges } from "../../utils/availability";
import { sanitizeTitleHtml } from "../../utils/sanitize";
import "./MemberCard.css";

/*
 * ReactBits TiltedCard 的原参数（reactbits.dev/components/tilted-card）。
 * mass 2 是关键的一个：刚度低、质量大，光标快速掠过时卡面会明显跟不上、
 * 冲过头再收回来。调回 mass 1 就退化成一条普通缓动曲线，整个效果的意义
 * 也就没了——别为了「跟手一点」去改它。
 */
const TILT_SPRING = { stiffness: 100, damping: 30, mass: 2 } as const;
/** 光标推到卡片边缘时的最大倾角（度）。 */
const TILT_AMPLITUDE = 14;
/*
 * 1.1 在 200~235px 宽的卡上等于向外顶出 20 多像素，而网格间距只有 8px，
 * 抬起来的卡会整个压住左右邻居。1.04 只越界约 5px，卡还是「抬起来了」，
 * 但不再吃掉邻居。
 */
const HOVER_SCALE = 1.04;
/*
 * 高光相对倾斜的反向行程系数。乘出来约 ±18px，正好在 .member-card__spec
 * 那圈 -30% 的余量之内；再大就会把渐变的软边平移出卡面，露出一条硬边。
 */
const SPECULAR_TRAVEL = 1.3;

const BADGE_SANITIZE_OPTIONS = {
  ALLOWED_TAGS: ["span", "b", "strong", "i", "em", "u", "br"],
  ALLOWED_ATTR: ["style"],
};

const MemberBadge = memo(function MemberBadge({ badge }: { badge: UserBadge }) {
  const sanitizedHtml = useMemo(
    () => DOMPurify.sanitize(badge.label_html, BADGE_SANITIZE_OPTIONS),
    [badge.label_html],
  );
  return (
    <span
      className="member-card__badge"
      style={{ "--badge-color": badge.color } as React.CSSProperties}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
});

type MemberCardProps = {
  user: User;
  profile: MemberProfile;
  badges?: UserBadge[];
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
  return CLASS_COLOR_GROUP[className] ?? "blue";
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
  badges,
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
    () => sanitizeTitleHtml(profile.title_html ?? ""),
    [profile.title_html],
  );

  /* 五个弹簧都在 compact 提前 return 之前建立——hooks 不能有条件调用。
   * 静止时它们不跑帧循环，紧凑卡多这五个值的代价可以忽略。 */
  const rotateX = useSpring(0, TILT_SPRING);
  const rotateY = useSpring(0, TILT_SPRING);
  const scale = useSpring(1, TILT_SPRING);
  const specularX = useSpring(0, TILT_SPRING);
  const specularY = useSpring(0, TILT_SPRING);
  const prefersReducedMotion = useReducedMotion();

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion || event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    /* 归一化到 [-1, 1]：卡片中心是 0，边缘是 ±1。 */
    const ratioX = (event.clientX - rect.left - rect.width / 2) / (rect.width / 2);
    const ratioY = (event.clientY - rect.top - rect.height / 2) / (rect.height / 2);
    /* rotateX 取负：光标往下走，卡片的上缘要朝观察者倒过来。 */
    rotateX.set(ratioY * -TILT_AMPLITUDE);
    rotateY.set(ratioX * TILT_AMPLITUDE);
    specularX.set(ratioX * -TILT_AMPLITUDE * SPECULAR_TRAVEL);
    specularY.set(ratioY * -TILT_AMPLITUDE * SPECULAR_TRAVEL);
  };

  const handlePointerEnter = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion || event.pointerType !== "mouse") return;
    scale.set(HOVER_SCALE);
  };

  /* 离开时无条件复位：prefersReducedMotion 可能在悬停中途翻转，
   * 那时若跟着提前 return，卡片会停在最后一帧的角度上不回来。 */
  const handlePointerLeave = () => {
    rotateX.set(0);
    rotateY.set(0);
    scale.set(1);
    specularX.set(0);
    specularY.set(0);
  };

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
    <div
      className="member-card__frame"
      onPointerMove={handlePointerMove}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      role="presentation"
    >
      <motion.button
        type="button"
        className={`member-card member-card--full${selected ? " member-card--selected" : ""}`}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        aria-label={t("a11y.openProfile", { name: user.username })}
        style={{ rotateX, rotateY, scale }}
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

        <div className="member-card__content">
          <span className="member-card__username">{user.username}</span>
          <div className="member-card__title" dangerouslySetInnerHTML={{ __html: titleHtml || "&nbsp;" }} />
        </div>

        {/* A "0" count says nothing and, on a roster where most profiles carry no
            media, turned every card into a row of zeroes. Only non-empty counts show. */}
        <div className="member-card__meta-row">
          {profile.images.length > 0 ? (
            <span className="member-card__pill member-card__pill--photo" aria-label={`${t("member.photo")} ${profile.images.length}`}>
              <IconPhoto size={13} />
              {profile.images.length}
            </span>
          ) : null}
          {profile.video_urls.length > 0 ? (
            <span className="member-card__pill member-card__pill--video" aria-label={`${t("member.video")} ${profile.video_urls.length}`}>
              <IconVideo size={13} />
              {profile.video_urls.length}
            </span>
          ) : null}
          {badges?.map((badge) => (
            <MemberBadge key={badge.id} badge={badge} />
          ))}
        </div>

        {/* 放在最后：定位元素本来就画在常规流之上，写在末尾只是让「这层盖在
            卡面上」在阅读顺序上也成立。透明度很低，不影响下面文字的可读性。 */}
        <motion.span
          className="member-card__spec"
          aria-hidden="true"
          style={{ x: specularX, y: specularY }}
        />
      </motion.button>
    </div>
  );
});

