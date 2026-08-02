import type { MemberProfile, User } from "@guild/shared";
import { Text } from "@mantine/core";
import { PhotoIcon, PlayerPauseIcon, PlayerPlayIcon, VideoIcon } from "@portal/components/icons";
import { getMemberStatus } from "@portal/components/shared/MemberCard";
import { resolveClassCatalogItem, useClassCatalogStore } from "@portal/stores/class-catalog";
import { sanitizeTitleHtml } from "@portal/utils/sanitize";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ClassIcon } from "../../shared/ClassIcon";
import { resolveProfileMediaUrl } from "../../../utils/media";

type ProfileLivePreviewProps = {
  user: User | null;
  profile: MemberProfile | null | undefined;
  power: number;
  titleHtml: string;
  bio: string;
  classList: string[];
  imageList: string[];
  videoList: string[];
};

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * 名片：把左边填的东西拼成一张卡。
 *
 * 结构照 Discord 的侧写卡：横幅 → 压在横幅上的圆头像＋状态点 → 名字 → 称号 →
 * 职业 → 战力/媒体 → 一句自述 → 语音条。每一格都对应库里真有的字段，没有的
 * 字段不发明——所以没有「私信」输入框（站内没有私信），横幅也没有单独的上传口。
 *
 * 横幅取相册第一张；一张都没有就退化成主职业色的渐变，而不是留一条空槽。
 *
 * 注意：这张卡只在资料页出现，名册用的仍是 MemberCard 的大方图卡。两处排版
 * 不同，但状态判定共用 getMemberStatus()，不会出现同一个人两种状态。
 */
export function ProfileLivePreview({
  user,
  profile,
  power,
  titleHtml,
  bio,
  classList,
  imageList,
  videoList,
}: ProfileLivePreviewProps) {
  const { t } = useTranslation("profile");
  const classCatalog = useClassCatalogStore((state) => state.items);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);

  const audioKey = profile?.audio_key ?? null;

  /* 换了音源就把播放态收回来：旧的那条已经被卸载，按钮不该还显示「暂停」。 */
  useEffect(() => {
    setPlaying(false);
    setDuration(null);
  }, [audioKey]);

  const safeTitleHtml = useMemo(
    () => (titleHtml ? sanitizeTitleHtml(titleHtml) : ""),
    [titleHtml],
  );

  if (!user || !profile) return null;

  const status = getMemberStatus(user, profile);
  const classItems = classList.map((classId) => resolveClassCatalogItem(classId, classCatalog));
  const primaryColor = classItems[0]?.color ?? null;
  const bannerKey = imageList[0] ?? null;
  const avatarSrc = profile.avatar_key ? resolveProfileMediaUrl(profile.avatar_key) : null;
  const audioSrc = audioKey ? resolveProfileMediaUrl(audioKey) : null;

  const togglePlay = () => {
    const element = audioRef.current;
    if (!element) return;
    if (element.paused) {
      void element.play();
    } else {
      element.pause();
    }
  };

  return (
    <div className="profile-live-preview">
      <Text size="xs" fw={600} c="dimmed" className="profile-rail__label">
        {t("preview.railLabel")}
      </Text>

      <article
        className="pcard"
        style={primaryColor ? ({ "--pcard-accent": primaryColor } as CSSProperties) : undefined}
      >
        <div className="pcard__banner">
          {bannerKey ? (
            <img
              className="pcard__banner-img"
              src={resolveProfileMediaUrl(bannerKey)}
              alt=""
              loading="lazy"
              decoding="async"
            />
          ) : null}
          <span className="pcard__avatar">
            {avatarSrc ? (
              <img src={avatarSrc} alt={t("common:a11y.avatar", { name: user.username })} />
            ) : (
              <span aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span>
            )}
          </span>
          <span
            className={`pcard__dot pcard__dot--${status}`}
            role="img"
            aria-label={t("common:a11y.status", { status })}
          />
        </div>

        <div className="pcard__body">
          <div className="pcard__name">{user.username}</div>
          {safeTitleHtml ? (
            <div className="pcard__title" dangerouslySetInnerHTML={{ __html: safeTitleHtml }} />
          ) : (
            <div className="pcard__title pcard__title--empty">{t("field.titleEmpty")}</div>
          )}

          {classItems.length > 0 ? (
            <div className="pcard__classes">
              {classItems.map((item) => (
                <span
                  key={item.id}
                  className="pcard__class"
                  style={{ "--class-color": item.color } as CSSProperties}
                >
                  <ClassIcon item={item} size={14} framed={false} />
                  {item.label}
                </span>
              ))}
            </div>
          ) : null}

          {/* 计数为 0 时不渲染：一排「0」什么也没说明。 */}
          <div className="pcard__stats">
            <span className="pcard__power">
              {t("common:member.power")} <b>{power}</b>
            </span>
            {imageList.length > 0 ? (
              <span className="pcard__pill">
                <PhotoIcon size={12} />
                {imageList.length}
              </span>
            ) : null}
            {videoList.length > 0 ? (
              <span className="pcard__pill">
                <VideoIcon size={12} />
                {videoList.length}
              </span>
            ) : null}
          </div>

          {bio.trim() ? <p className="pcard__bio">{bio}</p> : null}
        </div>

        {audioSrc ? (
          <div className="pcard__audio">
            <button
              type="button"
              className="pcard__play"
              aria-label={t(playing ? "preview.audioPause" : "preview.audioPlay")}
              onClick={togglePlay}
            >
              {playing ? <PlayerPauseIcon size={13} /> : <PlayerPlayIcon size={13} />}
            </button>
            <span className="pcard__audio-label">{t("preview.audioLabel")}</span>
            {/* 时长等浏览器读出元数据后才显示——先摆一个占位数字就是编的。 */}
            {duration !== null ? (
              <span className="pcard__audio-time">{formatDuration(duration)}</span>
            ) : null}
            <audio
              ref={audioRef}
              src={audioSrc}
              preload="metadata"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onLoadedMetadata={(event) => {
                const value = event.currentTarget.duration;
                if (Number.isFinite(value)) setDuration(value);
              }}
            />
          </div>
        ) : null}
      </article>
    </div>
  );
}
