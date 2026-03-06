import { Button, Group, Slider, Stack, Text } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { useMediaQuery } from "@mantine/hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigation, Pagination, Zoom } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import { Swiper, SwiperSlide } from "swiper/react";
import { isDirectPlayableVideoUrl, isEmbeddableVideoUrl, toEmbedVideoUrl } from "../../utils/video-embed";
import { EmptyState } from "./EmptyState";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";
import "swiper/css/zoom";
import styles from "./MediaGallery.module.css";

type MediaGalleryProps = {
  images: string[];
  videos?: string[];
  audioKey?: string | null;
  resolveMediaUrl?: (key: string) => string;
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

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function formatMediaTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "00:00";
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function MediaGallery({
  images,
  videos = [],
  audioKey = null,
  resolveMediaUrl = defaultResolver,
}: MediaGalleryProps) {
  const { t } = useTranslation("common");
  const isMobile = useMediaQuery("(max-width: 767px)") ?? false;
  const [activeIndex, setActiveIndex] = useState(0);
  const [embedPlayingVideos, setEmbedPlayingVideos] = useState<Record<number, boolean>>({});
  const [directVideoPlaying, setDirectVideoPlaying] = useState<Record<number, boolean>>({});
  const [directVideoProgress, setDirectVideoProgress] = useState<Record<number, VideoProgressState>>({});
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState<VideoProgressState>({ current: 0, duration: 0 });
  const [thumbnailExpanded, setThumbnailExpanded] = useState(true);
  const [swiperRef, setSwiperRef] = useState<SwiperType | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
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
      })),
    ],
    [images, resolveMediaUrl, videos],
  );
  const thumbnails = items.slice(0, 60);
  const audioResolved = audioKey ? resolveMediaUrl(audioKey) : null;

  useEffect(() => {
    if (isMobile) {
      setThumbnailExpanded(false);
    }
  }, [isMobile]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      Object.values(directVideoRefs.current).forEach((video) => {
        if (!video) {
          return;
        }
        video.pause();
      });
    };
  }, []);

  useEffect(() => {
    Object.entries(directVideoRefs.current).forEach(([indexKey, video]) => {
      const index = Number.parseInt(indexKey, 10);
      if (!Number.isFinite(index) || !video) {
        return;
      }
      if (index !== activeIndex && !video.paused) {
        video.pause();
        setDirectVideoPlaying((previous) => ({ ...previous, [index]: false }));
      }
    });
    setEmbedPlayingVideos((previous) => {
      const next: Record<number, boolean> = {};
      for (const [indexKey, value] of Object.entries(previous)) {
        const index = Number.parseInt(indexKey, 10);
        if (Number.isFinite(index) && index === activeIndex && value) {
          next[index] = true;
        }
      }
      return next;
    });
  }, [activeIndex]);

  const toggleAudioPlayback = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      void audio.play().catch(() => {});
      return;
    }
    audio.pause();
  };

  const seekAudio = (nextValue: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(nextValue)) {
      return;
    }
    audio.currentTime = nextValue;
    setAudioProgress((previous) => ({ ...previous, current: nextValue }));
  };

  const toggleDirectVideoPlayback = (index: number) => {
    const video = directVideoRefs.current[index];
    if (!video) {
      return;
    }
    if (video.paused) {
      void video.play().catch(() => {});
      return;
    }
    video.pause();
  };

  const restartDirectVideo = (index: number) => {
    const video = directVideoRefs.current[index];
    if (!video) {
      return;
    }
    video.currentTime = 0;
    void video.play().catch(() => {});
  };

  const openDirectVideoFullscreen = (index: number) => {
    const video = directVideoRefs.current[index] as FullscreenVideoElement | null;
    if (!video) {
      return;
    }
    const requestFullscreen = video.requestFullscreen ?? video.webkitRequestFullscreen;
    if (!requestFullscreen) {
      return;
    }
    void Promise.resolve(requestFullscreen.call(video)).catch(() => {});
  };

  if (items.length === 0 && !audioResolved) {
    return <EmptyState title={t("media.noMedia")} />;
  }

  return (
    <Stack gap={12} w="100%">
      {items.length > 0 ? (
        <div className={styles.gallery}>
          <Swiper
            modules={[Navigation, Pagination, Zoom]}
            navigation
            pagination={{ clickable: true }}
            zoom={{ maxRatio: 2.6 }}
            onSwiper={setSwiperRef}
            onSlideChange={(swiper) => setActiveIndex(swiper.activeIndex)}
          >
            {items.map((item, index) => (
              <SwiperSlide key={item.key}>
                {item.type === "image" ? (
                  isHttpUrl(item.source) ? (
                    <div className={`swiper-zoom-container ${styles.slide}`}>
                      <img
                        src={item.source}
                        alt={`Media image ${index + 1}`}
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                  ) : (
                    <InfiniCard interactive={false}>
                      <div style={{ padding: "1.2rem" }}>
                        <Text c="dimmed">{item.label}</Text>
                      </div>
                    </InfiniCard>
                  )
                ) : (
                  <div className={`${styles.slide} ${styles.videoSlide}`}>
                    {item.isDirect ? (
                      <>
                        <video
                          ref={(element) => {
                            directVideoRefs.current[index] = element;
                          }}
                          src={item.source}
                          controls
                          playsInline
                          preload="metadata"
                          className={styles.nativeVideo}
                          onLoadedMetadata={(event) => {
                            const target = event.currentTarget;
                            setDirectVideoProgress((previous) => ({
                              ...previous,
                              [index]: {
                                current: target.currentTime,
                                duration: Number.isFinite(target.duration) ? target.duration : 0,
                              },
                            }));
                          }}
                          onTimeUpdate={(event) => {
                            const target = event.currentTarget;
                            setDirectVideoProgress((previous) => ({
                              ...previous,
                              [index]: {
                                current: target.currentTime,
                                duration: Number.isFinite(target.duration) ? target.duration : previous[index]?.duration ?? 0,
                              },
                            }));
                          }}
                          onPlay={() => {
                            setDirectVideoPlaying((previous) => ({ ...previous, [index]: true }));
                          }}
                          onPause={() => {
                            setDirectVideoPlaying((previous) => ({ ...previous, [index]: false }));
                          }}
                        />
                        <Group className={styles.videoControls} justify="space-between" gap={8}>
                          <Group gap={6} wrap="wrap">
                            <Button size="xs" variant="default" onClick={() => toggleDirectVideoPlayback(index)}>
                              {directVideoPlaying[index] ? t("media.pause") : t("media.resume")}
                            </Button>
                            <Button size="xs" variant="default" onClick={() => restartDirectVideo(index)}>
                              {t("media.restart")}
                            </Button>
                            <Button size="xs" variant="default" onClick={() => openDirectVideoFullscreen(index)}>
                              {t("media.fullscreen")}
                            </Button>
                          </Group>
                          <Text size="xs" c="dimmed">
                            {formatMediaTime(directVideoProgress[index]?.current ?? 0)} / {formatMediaTime(directVideoProgress[index]?.duration ?? 0)}
                          </Text>
                        </Group>
                        <Slider
                          className={styles.videoProgress}
                          min={0}
                          max={Math.max(directVideoProgress[index]?.duration ?? 0, 1)}
                          value={Math.min(
                            directVideoProgress[index]?.current ?? 0,
                            Math.max(directVideoProgress[index]?.duration ?? 0, 1),
                          )}
                          disabled={(directVideoProgress[index]?.duration ?? 0) <= 0}
                          onChange={(nextValue) => {
                            const video = directVideoRefs.current[index];
                            if (!video || !Number.isFinite(nextValue)) {
                              return;
                            }
                            video.currentTime = nextValue;
                            setDirectVideoProgress((previous) => ({
                              ...previous,
                              [index]: {
                                current: nextValue,
                                duration: previous[index]?.duration ?? video.duration,
                              },
                            }));
                          }}
                          aria-label={`Seek video ${item.label}`}
                        />
                      </>
                    ) : !isEmbeddableVideoUrl(item.source) ? (
                      <Stack gap={8}>
                        <Text>{t("media.openInDouyin")}</Text>
                        <Button component="a" href={item.source} target="_blank" rel="noreferrer">
                          {t("media.open")}
                        </Button>
                      </Stack>
                    ) : embedPlayingVideos[index] ? (
                      <>
                        <iframe
                          src={toEmbedVideoUrl(item.source)}
                          title={item.label}
                          style={{ width: "100%", height: "calc(100% - 40px)", border: "none", borderRadius: 8 }}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                        <Group justify="center">
                          <Button
                            size="xs"
                            variant="default"
                            onClick={() => setEmbedPlayingVideos((previous) => ({ ...previous, [index]: false }))}
                          >
                            {t("media.stopVideo")}
                          </Button>
                        </Group>
                      </>
                    ) : (
                      <Stack gap={8}>
                        <Button
                          onClick={() => setEmbedPlayingVideos((previous) => ({ ...previous, [index]: true }))}
                          aria-label={`Play video ${item.label}`}
                        >
                          {t("media.playVideo")}
                        </Button>
                        <Button component="a" href={item.source} target="_blank" rel="noreferrer" variant="default">
                          {t("media.externalLink")}
                        </Button>
                      </Stack>
                    )}
                  </div>
                )}
              </SwiperSlide>
            ))}
          </Swiper>

          <div className={styles.thumbnailsHeader}>
            <Text c="dimmed">
              {Math.min(activeIndex + 1, items.length)} / {items.length}
            </Text>
            <Button size="xs" variant="default" onClick={() => setThumbnailExpanded((value) => !value)}>
              {thumbnailExpanded ? t("media.hideThumbnails") : t("media.showThumbnails")}
            </Button>
          </div>

          {thumbnailExpanded ? (
            <div className={styles.thumbnails}>
              {thumbnails.map((item, index) => (
                <button
                  key={item.key}
                  type="button"
                  className={`${styles.thumb}${index === activeIndex ? ` ${styles.thumbActive}` : ""}`}
                  onClick={() => {
                    setActiveIndex(index);
                    swiperRef?.slideTo(index);
                  }}
                  aria-label={`Open media item ${index + 1}`}
                  aria-pressed={index === activeIndex}
                >
                  {item.type === "image" && isHttpUrl(item.source) ? (
                    <img
                      src={item.source}
                      alt={`Media thumbnail ${index + 1}`}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span>{item.type === "video" ? "Video" : "Image"}</span>
                  )}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {audioResolved ? (
        isHttpUrl(audioResolved) ? (
          <InfiniCard className={styles.audioSection} interactive={false}>
            <div style={{ padding: "1.2rem" }}>
              <Stack gap={8}>
              <audio
                ref={audioRef}
                controls
                src={audioResolved}
                style={{ width: "100%" }}
                onLoadedMetadata={(event) => {
                  const target = event.currentTarget;
                  setAudioProgress({
                    current: target.currentTime,
                    duration: Number.isFinite(target.duration) ? target.duration : 0,
                  });
                }}
                onTimeUpdate={(event) => {
                  const target = event.currentTarget;
                  setAudioProgress((previous) => ({
                    current: target.currentTime,
                    duration: Number.isFinite(target.duration) ? target.duration : previous.duration,
                  }));
                }}
                onPlay={() => setAudioPlaying(true)}
                onPause={() => setAudioPlaying(false)}
                onEnded={() => {
                  setAudioPlaying(false);
                  setAudioProgress((previous) => ({ ...previous, current: 0 }));
                }}
              />
              <Group className={styles.audioControls} justify="space-between" gap={8}>
                <Button size="xs" variant="default" onClick={toggleAudioPlayback}>
                  {audioPlaying ? t("media.pause") : t("media.resume")}
                </Button>
                <Text size="xs" c="dimmed">
                  {formatMediaTime(audioProgress.current)} / {formatMediaTime(audioProgress.duration)}
                </Text>
              </Group>
              <Slider
                className={styles.audioProgress}
                min={0}
                max={Math.max(audioProgress.duration, 1)}
                value={Math.min(audioProgress.current, Math.max(audioProgress.duration, 1))}
                disabled={audioProgress.duration <= 0}
                onChange={seekAudio}
                aria-label="Seek profile audio"
              />
            </Stack>
            </div>
          </InfiniCard>
        ) : (
          <InfiniCard interactive={false}>
            <div style={{ padding: "1.2rem" }}>
              <Text c="dimmed" style={{ wordBreak: "break-all" }}>
                {audioKey}
              </Text>
            </div>
          </InfiniCard>
        )
      ) : (
        <EmptyState title={t("media.noAudio")} />
      )}
    </Stack>
  );
}
