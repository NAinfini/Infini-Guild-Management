import { Button, Group, Slider, Stack, Text } from "@mantine/core";
import { Carousel } from "@mantine/carousel";
import { useMediaQuery } from "@mantine/hooks";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";
import { isDirectPlayableVideoUrl, isEmbeddableVideoUrl, toEmbedVideoUrl, getVideoThumbnailUrl } from "@guild/shared/utils/video";
import { ChevronUpIcon, ChevronDownIcon, PlayIcon } from "@portal/components/icons";
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
  seekVideo: string;
  playVideoAria: string;
  openItemAria: string;
};

const DEFAULT_LABELS: MediaGalleryLabels = {
  noMedia: "No media",
  imageLoadFailed: "Image failed to load",
  pause: "Pause",
  resume: "Play",
  restart: "Restart",
  fullscreen: "Fullscreen",
  stopVideo: "Stop video",
  playVideo: "Play video",
  externalLink: "Open link",
  openInDouyin: "This video can only be viewed on Douyin",
  open: "Open",
  hideThumbnails: "Hide thumbnails",
  showThumbnails: "Show thumbnails",
  thumbnailVideo: "Video",
  thumbnailImage: "Image",
  seekVideo: "Seek video",
  playVideoAria: "Play video",
  openItemAria: "Open item",
};

export function buildMediaGalleryLabels(t: (key: string) => string): MediaGalleryLabels {
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
    seekVideo: t("media.aria.seekVideo"),
    playVideoAria: t("media.aria.playVideo"),
    openItemAria: t("media.aria.openItem"),
  };
}

export type MediaGalleryProps = {
  images: string[];
  videos?: string[];
  resolveMediaUrl?: (key: string) => string;
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

function defaultResolver(value: string): string {
  return value;
}

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
    videos = [],
    resolveMediaUrl = defaultResolver,
    emptyContent,
    labels: labelsProp,
    className,
    style,
    ...rest
  }, ref) {
  const labels = { ...DEFAULT_LABELS, ...labelsProp };
  const isMobile = useMediaQuery("(max-width: 767px)") ?? false;
  const [activeIndex, setActiveIndex] = useState(0);
  const [directVideoPlaying, setDirectVideoPlaying] = useState<Record<number, boolean>>({});
  const [directVideoProgress, setDirectVideoProgress] = useState<Record<number, VideoProgressState>>({});
  const [thumbnailExpanded, setThumbnailExpanded] = useState(true);

  const [embla, setEmbla] = useState<any>(null);
  const directVideoRefs = useRef<Record<number, HTMLVideoElement | null>>({});

  const items = useMemo(
    () => [
      ...images.map((item) => ({
        key: `img-${item}`,
        type: "image" as const,
        label: item,
        source: resolveMediaUrl(item),
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

  const handleImageError = useCallback((index: number) => {
    setBrokenImages((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, []);

  useEffect(() => {
    setBrokenImages(new Set());
  }, [images, videos]);

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

  useEffect(() => {
    Object.entries(directVideoRefs.current).forEach(([indexKey, video]) => {
      const index = Number.parseInt(indexKey, 10);
      if (!Number.isFinite(index) || !video) return;
      if (index !== activeIndex && !video.paused) {
        video.pause();
        setDirectVideoPlaying((prev) => ({ ...prev, [index]: false }));
      }
    });
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
    return <>{emptyContent ?? <Text c="dimmed">{labels.noMedia}</Text>}</>;
  }

  return (
    <div ref={ref} className={clsx(className)} style={style} {...rest}>
      <Stack gap={12} w="100%">
      {items.length > 0 ? (
        <div className="infini-media-gallery-grid">
          <Carousel
            withIndicators
            withControls
            getEmblaApi={setEmbla}
            onSlideChange={setActiveIndex}
          >
            {items.map((item, index) => (
              <Carousel.Slide key={item.key}>
                {item.type === "image" ? (
                  isRenderableUrl(item.source) && !brokenImages.has(index) ? (
                    <div className="infini-media-gallery-slide">
                      <img src={item.source} alt={`Media image ${index + 1}`} loading="lazy" decoding="async" onError={() => handleImageError(index)} />
                    </div>
                  ) : (
                    <div className="infini-media-gallery-slide infini-media-gallery-slide--broken">
                      <Text c="dimmed" ta="center">{brokenImages.has(index) ? labels.imageLoadFailed : item.label}</Text>
                    </div>
                  )
                ) : (
                  <div className="infini-media-gallery-slide infini-media-gallery-video-slide">
                    {"isDirect" in item && item.isDirect ? (
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
                        <Group className="infini-media-gallery-video-controls" justify="space-between" gap={8}>
                          <Group gap={6} wrap="wrap">
                            <Button size="xs" variant="default" onClick={() => toggleDirectVideoPlayback(index)}>
                              {directVideoPlaying[index] ? labels.pause : labels.resume}
                            </Button>
                            <Button size="xs" variant="default" onClick={() => restartDirectVideo(index)}>{labels.restart}</Button>
                            <Button size="xs" variant="default" onClick={() => openDirectVideoFullscreen(index)}>{labels.fullscreen}</Button>
                          </Group>
                          <Text size="xs" c="dimmed">
                            {formatMediaTime(directVideoProgress[index]?.current ?? 0)} / {formatMediaTime(directVideoProgress[index]?.duration ?? 0)}
                          </Text>
                        </Group>
                        <Slider
                          className="infini-media-gallery-video-progress"
                          min={0}
                          max={Math.max(directVideoProgress[index]?.duration ?? 0, 1)}
                          value={Math.min(directVideoProgress[index]?.current ?? 0, Math.max(directVideoProgress[index]?.duration ?? 0, 1))}
                          disabled={(directVideoProgress[index]?.duration ?? 0) <= 0}
                          onChange={(nextValue) => {
                            const video = directVideoRefs.current[index];
                            if (!video || !Number.isFinite(nextValue)) return;
                            video.currentTime = nextValue;
                            setDirectVideoProgress((prev) => ({ ...prev, [index]: { current: nextValue, duration: prev[index]?.duration ?? video.duration } }));
                          }}
                          aria-label={labels.seekVideo}
                        />
                      </>
                    ) : !isEmbeddableVideoUrl(item.source) ? (
                      <Stack gap={8}>
                        <Text>{labels.openInDouyin}</Text>
                        <Button component="a" href={item.source} target="_blank" rel="noreferrer">{labels.open}</Button>
                      </Stack>
                    ) : (
                      <>
                        <iframe
                          src={toEmbedVideoUrl(item.source)}
                          title={item.label}
                          style={{ width: "100%", height: "calc(100% - 40px)", border: "none", borderRadius: 8 }}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                        <Group justify="center" gap={8}>
                          <Button size="xs" variant="default" component="a" href={item.source} target="_blank" rel="noreferrer">
                            {labels.externalLink}
                          </Button>
                        </Group>
                      </>
                    )}
                  </div>
                )}
              </Carousel.Slide>
            ))}
          </Carousel>

          <div className="infini-media-gallery-thumbnails-header">
            <Text c="dimmed">{Math.min(activeIndex + 1, items.length)} / {items.length}</Text>
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
                  onClick={() => { setActiveIndex(index); (embla as { scrollTo?: (index: number) => void })?.scrollTo?.(index); }}
                  aria-label={`${labels.openItemAria} ${index + 1}`}
                  aria-pressed={index === activeIndex}
                >
                  {item.type === "image" && isRenderableUrl(item.source) && !brokenImages.has(index) ? (
                    <img src={item.source} alt={`Media thumbnail ${index + 1}`} loading="lazy" decoding="async" onError={() => handleImageError(index)} />
                  ) : item.type === "video" ? (
                    "thumbnailUrl" in item && item.thumbnailUrl ? (
                      <div className="infini-media-gallery-thumb-video">
                        <img src={item.thumbnailUrl} alt={`Video thumbnail ${index + 1}`} loading="lazy" decoding="async" />
                        <PlayIcon size={16} className="infini-media-gallery-thumb-play" />
                      </div>
                    ) : "isDirect" in item && item.isDirect ? (
                      <div className="infini-media-gallery-thumb-video">
                        <video src={item.source} preload="metadata" muted className="infini-media-gallery-thumb-vid" />
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
      ) : null}
    </Stack>
    </div>
  );
  }
);
