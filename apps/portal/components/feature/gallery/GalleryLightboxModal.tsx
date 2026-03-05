import { LeftOutlined, RightOutlined } from "@portal/utils/icons";
import { Alert, Button, Group, Modal, Text } from "@mantine/core";
import type { GalleryItem } from "./shared";

type GalleryLightboxModalProps = {
  open: boolean;
  item: GalleryItem | null;
  index: number;
  total: number;
  zoom: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  setZoom: (next: number | ((value: number) => number)) => void;
  isHttpUrl: (value: string) => boolean;
  toEmbedVideoUrl: (value: string) => string;
  fieldR2ObjectLabel: string;
};

export function GalleryLightboxModal({
  open,
  item,
  index,
  total,
  zoom,
  onClose,
  onPrev,
  onNext,
  setZoom,
  isHttpUrl,
  toEmbedVideoUrl,
  fieldR2ObjectLabel,
}: GalleryLightboxModalProps) {
  return (
    <Modal opened={open} onClose={onClose} size="980px" withCloseButton>
      {item ? (
        <div className="gallery-lightbox">
          <div className="gallery-lightbox__toolbar">
            <Group gap={8}>
              <Button onClick={onPrev} aria-label="Previous item">
                <LeftOutlined />
              </Button>
              <Button onClick={onNext} aria-label="Next item">
                <RightOutlined />
              </Button>
              <Button onClick={() => setZoom((value) => Math.max(1, Number((value - 0.2).toFixed(2))))}>-</Button>
              <Button onClick={() => setZoom(1)}>100%</Button>
              <Button onClick={() => setZoom((value) => Math.min(2.6, Number((value + 0.2).toFixed(2))))}>+</Button>
            </Group>
            <Text c="dimmed">
              {Math.max(1, index + 1)} / {total}
            </Text>
          </div>
          {item.type === "image" ? (
            isHttpUrl(item.url) ? (
              <div
                style={{ overflow: "auto", maxHeight: "78vh", cursor: zoom > 1 ? "zoom-out" : "zoom-in" }}
                onWheel={(event) => {
                  event.preventDefault();
                  const direction = event.deltaY < 0 ? 0.12 : -0.12;
                  setZoom((value) => Math.min(2.6, Math.max(1, Number((value + direction).toFixed(2)))));
                }}
                onDoubleClick={() => setZoom((value) => (value > 1 ? 1 : 2.2))}
              >
                <img
                  src={item.url}
                  alt={item.caption ?? item.id}
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: "100%",
                    maxHeight: "78vh",
                    objectFit: "contain",
                    transform: `scale(${zoom})`,
                    transformOrigin: "center center",
                    transition: "transform 120ms ease",
                  }}
                />
              </div>
            ) : (
              <Alert color="infini-primary" title={fieldR2ObjectLabel}>
                {item.url}
              </Alert>
            )
          ) : (
            <iframe
              src={toEmbedVideoUrl(item.url)}
              title={item.caption ?? item.id}
              style={{ width: "100%", height: "70vh", border: "none", borderRadius: 8 }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          )}
        </div>
      ) : null}
    </Modal>
  );
}
