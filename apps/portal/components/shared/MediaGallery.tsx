import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { isDirectPlayableVideoUrl, isEmbeddableVideoUrl, toEmbedVideoUrl, getVideoThumbnailUrl } from "@guild/shared/utils/video";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  PlayIcon,
  XIcon,
} from "@portal/components/icons";
import { Button, buttonVariants } from "@portal/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { useMediaQuery } from "@portal/hooks/useMediaQuery";
import { resolveMediaUrl as resolvePortalMediaUrl } from "../../utils/media";
import "./media-gallery.css";

export type MediaGalleryLabels = {
  noMedia: string;
  imageLoadFailed: string;
  pause: string;
  resume: string;
  restart: string;
  fullscreen: string;
  stopVideo: string;
  playVideo: string;
  externalLink: string;
  openInDouyin: string;
  open: string;
  hideThumbnails: string;
  showThumbnails: string;
  thumbnailVideo: string;
  thumbnailImage: string;
  close: string;
  seekVideo: string;
  playVideoAria: string;
  previousItemAria: string;
  nextItemAria: string;
  enlargeImageAria: (index: number) => string;
  openItemAria: (index: number) => string;
  imageAlt: (index: number) => string;
  imageThumbnailAlt: (index: number) => string;
  videoThumbnailAlt: (index: number) => string;
};

export function buildMediaGalleryLabels(
  t: (key: string, options?: { index?: number }) => string,
): MediaGalleryLabels {
  return {
    noMedia: t("media.noMedia"),
    imageLoadFailed: t("media.imageLoadFailed"),
    pause: t("media.pause"),
    resume: t("media.resume"),
    restart: t("media.restart"),
    fullscreen: t("media.fullscreen"),
    stopVideo: t("media.stopVideo"),
    playVideo: t("media.playVideo"),
    externalLink: t("media.externalLink"),
    openInDouyin: t("media.openInDouyin"),
    open: t("media.open"),
    hideThumbnails: t("media.hideThumbnails"),
    showThumbnails: t("media.showThumbnails"),
    thumbnailVideo: t("media.thumbnailVideo"),
    thumbnailImage: t("media.thumbnailImage"),
    close: t("action.close"),
    seekVideo: t("media.aria.seekVideo"),
    playVideoAria: t("media.aria.playVideo"),
    previousItemAria: t("media.aria.previousItem"),
    nextItemAria: t("media.aria.nextItem"),
    enlargeImageAria: (index) => t("media.aria.enlargeImage", { index }),
    openItemAria: (index) => t("media.aria.openItem", { index }),
    imageAlt: (index) => t("media.aria.imageAlt", { index }),
    imageThumbnailAlt: (index) => t("media.aria.imageThumbnailAlt", { index }),
    videoThumbnailAlt: (index) => t("media.aria.videoThumbnailAlt", { index }),
  };
}

export type MediaGalleryProps = {
  images: string[];
  videos?: string[];
  resolveMediaUrl?: (mediaId: string, variant?: "view" | "full") => string;
  emptyContent?: ReactNode;
  labels?: Partial<MediaGalleryLabels>;
  className?: string;
  style?: CSSProperties;
};

type VideoProgressState = {
  current: number;
  duration: number;
};

type FullscreenVideoElement = HTMLVideoElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/* 省略 videos 时要落到同一个数组上。写成 `videos = []` 每次渲染都新造一个，
   下面那个 useMemo 的依赖就永远在变，items 每帧重算。 */
const NO_VIDEOS: string[] = [];

function isRenderableUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith("/");
}

function formatMediaTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "00:00";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export const MediaGallery = forwardRef<HTMLDivElement, MediaGalleryProps>(
  function MediaGallery({
    images,
    videos = NO_VIDEOS,
    resolveMediaUrl = resolvePortalMediaUrl,
    emptyContent,
    labels: labelsProp,
    className,
    style,
    ...rest
  }, ref) {
  const { t } = useTranslation("common");
  const translatedLabels = useMemo(() => buildMediaGalleryLabels(t), [t]);
  const labels = useMemo(
    () => ({ ...translatedLabels, ...labelsProp }),
    [translatedLabels, labelsProp],
  );
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [activeIndex, setActiveIndex] = useState(0);
  const [directVideoPlaying, setDirectVideoPlaying] = useState<Record<number, boolean>>({});
  const [directVideoProgress, setDirectVideoProgress] = useState<Record<number, VideoProgressState>>({});
  const [thumbnailExpanded, setThumbnailExpanded] = useState(true);
  const [enlargedIndex, setEnlargedIndex] = useState<number | null>(null);

  const directVideoRefs = useRef<Record<number, HTMLVideoElement | null>>({});

  const items = useMemo(
    () => [
      ...images.map((item) => ({
        key: `img-${item}`,
        type: "image" as const,
        label: item,
        source: resolveMediaUrl(item, "view"),
        fullSource: resolveMediaUrl(item, "full"),
      })),
      ...videos.map((item) => ({
        key: `vid-${item}`,
        type: "video" as const,
        label: item,
        source: item,
        isDirect: isDirectPlayableVideoUrl(item),
        thumbnailUrl: getVideoThumbnailUrl(item),
      })),
    ],
    [images, resolveMediaUrl, videos],
  );
  const thumbnails = items.slice(0, 20);
  const [brokenImages, setBrokenImages] = useState<Set<number>>(new Set());

  /*
   * 轮播的每一张都留在 DOM 里，只是被横向挪出了视口。浏览器的懒加载判定看的是
   * 视口，而不是轮播的「下一张」，所以整条懒下去的话，每次翻页都从零开始下载，
   * 翻页因此永远要等一次网络。左右各一张提前取好，点下一张时图已经在手上；再远
   * 的仍然懒加载，免得一开就把整本相册拉下来。
   */
  const isNearActive = (index: number) => Math.abs(index - activeIndex) <= 1;

  const handleImageError = useCallback((index: number) => {
    setBrokenImages((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, []);

  /* brokenImages 记的是下标，而下标只在同一份列表里指向同一张图，换了列表就得清
     空。判定得看内容：调用方常常临时拼出数组，按引用比会每次渲染都判成「换了列
     表」，于是清空、拿到新 Set、再渲染，组件就一直空转下去。 */
  const mediaSignature = JSON.stringify(items.map((item) => item.key));

  useEffect(() => {
    setBrokenImages(new Set());
    setEnlargedIndex(null);
  }, [mediaSignature]);

  useEffect(() => {
    if (isMobile) setThumbnailExpanded(false);
  }, [isMobile]);

  useEffect(() => {
    return () => {
      Object.values(directVideoRefs.current).forEach((video) => {
        if (video) video.pause();
      });
    };
  }, []);

  const selectSlide = useCallback((nextIndex: number) => {
    if (nextIndex === activeIndex) return;
    directVideoRefs.current[activeIndex]?.pause();
    setDirectVideoPlaying((prev) => (
      prev[activeIndex] ? { ...prev, [activeIndex]: false } : prev
    ));
    setActiveIndex(nextIndex);
  }, [activeIndex]);

  const toggleDirectVideoPlayback = (index: number) => {
    const video = directVideoRefs.current[index];
    if (!video) return;
    if (video.paused) { void video.play().catch(() => {}); return; }
    video.pause();
  };

  const restartDirectVideo = (index: number) => {
    const video = directVideoRefs.current[index];
    if (!video) return;
    video.currentTime = 0;
    void video.play().catch(() => {});
  };

  const openDirectVideoFullscreen = (index: number) => {
    const video = directVideoRefs.current[index] as FullscreenVideoElement | null;
    if (!video) return;
    const requestFullscreen = video.requestFullscreen ?? video.webkitRequestFullscreen;
    if (!requestFullscreen) return;
    void Promise.resolve(requestFullscreen.call(video)).catch(() => {});
  };

  if (items.length === 0) {
    return <>{emptyContent ?? <span className="infini-media-gallery-muted">{labels.noMedia}</span>}</>;
  }

  const previousIndex = (activeIndex - 1 + items.length) % items.length;
  const nextIndex = (activeIndex + 1) % items.length;

  return (
    <div ref={ref} className={clsx(className)} style={style} {...rest}>
      <div className="infini-media-gallery-stack">
        <div className="infini-media-gallery-grid">
          <div className="infini-media-gallery-carousel" aria-label={`${activeIndex + 1} / ${items.length}`}>
            <div className="infini-media-gallery-slides">
              {items.map((item, index) => (
                <div
                  key={item.key}
                  className="infini-media-gallery-frame"
                  data-active={index === activeIndex || undefined}
                  aria-hidden={index === activeIndex ? undefined : true}
                  inert={index === activeIndex ? undefined : true}
                >
                {item.type === "image" ? (
                  isRenderableUrl(item.source) && !brokenImages.has(index) ? (
                    <button
                      type="button"
                      className="infini-media-gallery-slide infini-media-gallery-slide-zoom"
                      onClick={() => setEnlargedIndex(index)}
                      aria-label={labels.enlargeImageAria(index + 1)}
                    >
                      <img
                        src={item.source}
                        alt={labels.imageAlt(index + 1)}
                        loading={isNearActive(index) ? "eager" : "lazy"}
                        fetchPriority={index === activeIndex ? "high" : "auto"}
                        decoding="async"
                        onError={() => handleImageError(index)}
                      />
                    </button>
                  ) : (
                    <div className="infini-media-gallery-slide">
                      <span className="infini-media-gallery-muted">{brokenImages.has(index) ? labels.imageLoadFailed : item.label}</span>
                    </div>
                  )
                ) : (
                  <div className="infini-media-gallery-slide infini-media-gallery-video-slide">
                    {index !== activeIndex ? null : "isDirect" in item && item.isDirect ? (
                      <>
                        <video
                          ref={(el) => { directVideoRefs.current[index] = el; }}
                          src={item.source}
                          controls
                          playsInline
                          preload="metadata"
                          className="infini-media-gallery-native-video"
                          onLoadedMetadata={(e) => {
                            const t = e.currentTarget;
                            setDirectVideoProgress((prev) => ({ ...prev, [index]: { current: t.currentTime, duration: Number.isFinite(t.duration) ? t.duration : 0 } }));
                          }}
                          onTimeUpdate={(e) => {
                            const t = e.currentTarget;
                            setDirectVideoProgress((prev) => ({ ...prev, [index]: { current: t.currentTime, duration: Number.isFinite(t.duration) ? t.duration : prev[index]?.duration ?? 0 } }));
                          }}
                          onPlay={() => setDirectVideoPlaying((prev) => ({ ...prev, [index]: true }))}
                          onPause={() => setDirectVideoPlaying((prev) => ({ ...prev, [index]: false }))}
                        />
                        <div className="infini-media-gallery-video-controls">
                          <div className="infini-media-gallery-video-actions">
                            <Button size="xs" variant="outline" onClick={() => toggleDirectVideoPlayback(index)}>
                              {directVideoPlaying[index] ? labels.pause : labels.resume}
                            </Button>
                            <Button size="xs" variant="outline" onClick={() => restartDirectVideo(index)}>{labels.restart}</Button>
                            <Button size="xs" variant="outline" onClick={() => openDirectVideoFullscreen(index)}>{labels.fullscreen}</Button>
                          </div>
                          <span className="infini-media-gallery-muted">
                            {formatMediaTime(directVideoProgress[index]?.current ?? 0)} / {formatMediaTime(directVideoProgress[index]?.duration ?? 0)}
                          </span>
                        </div>
                        <input
                          type="range"
                          className="infini-media-gallery-video-progress"
                          min={0}
                          max={Math.max(directVideoProgress[index]?.duration ?? 0, 1)}
                          value={Math.min(directVideoProgress[index]?.current ?? 0, Math.max(directVideoProgress[index]?.duration ?? 0, 1))}
                          disabled={(directVideoProgress[index]?.duration ?? 0) <= 0}
                          onChange={(event) => {
                            const nextValue = event.currentTarget.valueAsNumber;
                            const video = directVideoRefs.current[index];
                            if (!video || !Number.isFinite(nextValue)) return;
                            video.currentTime = nextValue;
                            setDirectVideoProgress((prev) => ({ ...prev, [index]: { current: nextValue, duration: prev[index]?.duration ?? video.duration } }));
                          }}
                          aria-label={labels.seekVideo}
                        />
                      </>
                    ) : !isEmbeddableVideoUrl(item.source) ? (
                      <div className="infini-media-gallery-external">
                        <span>{labels.openInDouyin}</span>
                        <a
                          href={item.source}
                          target="_blank"
                          rel="noreferrer"
                          className={buttonVariants()}
                        >
                          {labels.open}
                        </a>
                      </div>
                    ) : (
                      <>
                        <iframe
                          src={toEmbedVideoUrl(item.source)}
                          title={item.label}
                          className="infini-media-gallery-video-embed"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                        <div className="infini-media-gallery-embed-actions">
                          <a
                            href={item.source}
                            target="_blank"
                            rel="noreferrer"
                            className={buttonVariants({ size: "xs", variant: "outline" })}
                          >
                            {labels.externalLink}
                          </a>
                        </div>
                      </>
                    )}
                  </div>
                )}
                </div>
              ))}
            </div>
            {items.length > 1 ? (
              <>
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="infini-media-gallery-control infini-media-gallery-control--previous"
                  aria-label={labels.previousItemAria}
                  onClick={() => selectSlide(previousIndex)}
                >
                  <ChevronLeftIcon aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="infini-media-gallery-control infini-media-gallery-control--next"
                  aria-label={labels.nextItemAria}
                  onClick={() => selectSlide(nextIndex)}
                >
                  <ChevronRightIcon aria-hidden />
                </Button>
              </>
            ) : null}
          </div>

          <div className="infini-media-gallery-thumbnails-header">
            <span className="infini-media-gallery-muted">{Math.min(activeIndex + 1, items.length)} / {items.length}</span>
            <button
              type="button"
              className="infini-media-gallery-toggle-thumb"
              onClick={() => setThumbnailExpanded((v) => !v)}
              aria-label={thumbnailExpanded ? labels.hideThumbnails : labels.showThumbnails}
            >
              {thumbnailExpanded ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
            </button>
          </div>

          {thumbnailExpanded ? (
            <div className="infini-media-gallery-thumbnails">
              {thumbnails.map((item, index) => (
                <button
                  key={item.key}
                  type="button"
                  className={`infini-media-gallery-thumb${index === activeIndex ? " infini-media-gallery-thumb-active" : ""}`}
                  onClick={() => selectSlide(index)}
                  aria-label={labels.openItemAria(index + 1)}
                  aria-pressed={index === activeIndex}
                >
                  {item.type === "image" && isRenderableUrl(item.source) && !brokenImages.has(index) ? (
                    <img src={item.source} alt={labels.imageThumbnailAlt(index + 1)} loading="lazy" decoding="async" onError={() => handleImageError(index)} />
                  ) : item.type === "video" ? (
                    "thumbnailUrl" in item && item.thumbnailUrl ? (
                      <div className="infini-media-gallery-thumb-video">
                        <img src={item.thumbnailUrl} alt={labels.videoThumbnailAlt(index + 1)} loading="lazy" decoding="async" />
                        <PlayIcon size={16} className="infini-media-gallery-thumb-play" />
                      </div>
                    ) : (
                      <div className="infini-media-gallery-thumb-video">
                        <PlayIcon size={20} className="infini-media-gallery-thumb-play-only" />
                      </div>
                    )
                  ) : (
                    <span>{labels.thumbnailImage}</span>
                  )}
                </button>
              ))}
            </div>
          ) : null}
        </div>

      <Dialog
        open={enlargedIndex !== null}
        onOpenChange={(open) => {
          if (!open) setEnlargedIndex(null);
        }}
      >
        <DialogContent showCloseButton={false} className="infini-media-gallery-zoom-content">
          <DialogTitle className="sr-only">
            {enlargedIndex === null ? labels.close : labels.enlargeImageAria(enlargedIndex + 1)}
          </DialogTitle>
          <DialogClose
            render={(
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="infini-media-gallery-zoom-close"
                aria-label={labels.close}
              />
            )}
          >
            <XIcon aria-hidden />
          </DialogClose>
          <div className="infini-media-gallery-zoom-body">
            {enlargedIndex !== null && items[enlargedIndex] ? (
              <img
                className="infini-media-gallery-zoom-img"
                src={items[enlargedIndex].type === "image" ? items[enlargedIndex].fullSource : items[enlargedIndex].source}
                alt={labels.imageAlt(enlargedIndex + 1)}
                decoding="async"
                onClick={() => setEnlargedIndex(null)}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
  }
);
