import { ActionIcon, Button } from "@mantine/core";
import { AnimatePresence, Reorder, useDragControls } from "motion/react";
import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { ImageGridEditorItem } from "@portal/types/media";

export type { ImageGridEditorItem };

export interface ImageGridEditorProps {
  items: ImageGridEditorItem[];
  onReorder: (items: ImageGridEditorItem[]) => void;
  onDelete?: (item: ImageGridEditorItem) => void;
  onFilesSelected?: (files: File[]) => void;
  maxImages?: number;
  maxFileSize?: number;
  allowedTypes?: string[];
  onError?: (error: Error) => void;
  error?: Error | string;
  errorContent?: ReactNode;
  loading?: boolean;
  loadingContent?: ReactNode;
  imageSize?: number;
  borderRadius?: number;
  gap?: number;
  accept?: string;
  uploadLabel?: ReactNode;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
}

function useMotionAllowed(): boolean {
  if (typeof window === "undefined") return true;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function DraggableImageCell({
  item,
  imageSize,
  borderRadius,
  onDelete,
  disabled,
  motionAllowed,
}: {
  item: ImageGridEditorItem;
  imageSize: number;
  borderRadius: number;
  onDelete?: (item: ImageGridEditorItem) => void;
  disabled: boolean;
  motionAllowed: boolean;
}) {
  const dragControls = useDragControls();
  const [isDragging, setIsDragging] = useState(false);

  const cellStyle: CSSProperties = {
    position: "relative",
    width: imageSize,
    height: imageSize,
    borderRadius,
    overflow: "visible",
    cursor: disabled ? "default" : "grab",
    listStyle: "none",
  };

  const imgStyle: CSSProperties = {
    width: imageSize,
    height: imageSize,
    objectFit: "cover",
    borderRadius,
    display: "block",
    border: "1px solid var(--border-subtle)",
    pointerEvents: "none",
    userSelect: "none",
  };

  const placeholderStyle: CSSProperties = {
    width: imageSize,
    height: imageSize,
    borderRadius,
    border: "1px dashed var(--border-subtle)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
    textAlign: "center",
    fontSize: Math.max(9, imageSize * 0.12),
    color: "var(--text-muted)",
    userSelect: "none",
    wordBreak: "break-all",
    overflow: "hidden",
  };

  const hasUrl = item.src && (/^(https?|blob):\/\//i.test(item.src) || item.src.startsWith("/"));

  return (
    <Reorder.Item
      key={item.id}
      value={item}
      role="listitem"
      aria-label={item.alt ?? item.id}
      dragControls={dragControls}
      dragListener={!disabled}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => setIsDragging(false)}
      layout={motionAllowed ? "position" : undefined}
      style={{
        ...cellStyle,
        zIndex: isDragging ? 10 : 1,
      }}
      whileDrag={motionAllowed ? {
        scale: 1.08,
        rotate: 0,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        cursor: "grabbing",
      } : undefined}
    >
      {hasUrl ? (
        <img
          src={item.src!}
          alt={item.alt ?? ""}
          loading="lazy"
          decoding="async"
          style={imgStyle}
          draggable={false}
        />
      ) : (
        <div style={placeholderStyle}>
          {item.id.length > 20 ? `${item.id.slice(0, 18)}…` : item.id}
        </div>
      )}

      {onDelete && !disabled ? (
        <ActionIcon
          type="button"
          aria-label={`Delete ${item.alt ?? item.id}`}
          color="red"
          variant="filled"
          radius="xl"
          size={20}
          style={{ position: "absolute", top: -6, right: -6, zIndex: 10 }}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
        >
          ×
        </ActionIcon>
      ) : null}
    </Reorder.Item>
  );
}

export const ImageGridEditor = forwardRef<HTMLDivElement, ImageGridEditorProps>(
  function ImageGridEditor(
    {
      items,
      onReorder,
      onDelete,
      onFilesSelected,
      maxImages = 10,
      maxFileSize,
      allowedTypes,
      onError,
      error,
      errorContent,
      loading,
      loadingContent,
      imageSize = 80,
      borderRadius = 8,
      gap = 8,
      accept = "image/*",
      uploadLabel,
      disabled = false,
      className,
      style: styleProp,
      "aria-label": ariaLabel,
      ...rest
    },
    ref,
  ) {
    const motionAllowed = useMotionAllowed();
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (loading) return <>{loadingContent}</>;
    if (error) return <>{errorContent}</>;

    const canUpload = !disabled && items.length < maxImages && onFilesSelected;

    const handleFileChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = e.target.files;
        if (!fileList || fileList.length === 0 || !onFilesSelected) return;
        const remaining = maxImages - items.length;
        let selected = Array.from(fileList).slice(0, Math.max(0, remaining));

        if (allowedTypes && allowedTypes.length > 0) {
          const rejected = selected.filter((f) => !allowedTypes.includes(f.type));
          if (rejected.length > 0) {
            try { onError?.(new Error(`File type not allowed: ${rejected.map((f) => f.name).join(", ")}`)); } catch { /* swallow */ }
          }
          selected = selected.filter((f) => allowedTypes.includes(f.type));
        }

        if (maxFileSize) {
          const oversized = selected.filter((f) => f.size > maxFileSize);
          if (oversized.length > 0) {
            try { onError?.(new Error(`File too large: ${oversized.map((f) => f.name).join(", ")}`)); } catch { /* swallow */ }
          }
          selected = selected.filter((f) => f.size <= maxFileSize);
        }

        if (selected.length > 0) onFilesSelected(selected);
        e.target.value = "";
      },
      [items.length, maxImages, onFilesSelected, maxFileSize, allowedTypes, onError],
    );

    const containerStyle: CSSProperties = {
      display: "flex",
      flexWrap: "wrap",
      gap,
      alignItems: "flex-start",
      justifyContent: items.length === 0 ? "center" : "flex-start",
      ...styleProp,
    };

    /*
     * role="group", not role="list": Reorder.Group already renders a real <ul>
     * of <li>s, so declaring the wrapper a list gave it a <ul> and the upload
     * <label> as children, neither of which may sit inside a list.
     */
    return (
      <div ref={ref} className={className} style={containerStyle} aria-label={ariaLabel} role="group" aria-live="polite" {...rest}>
        <Reorder.Group
          axis="x"
          values={items}
          onReorder={onReorder}
          layoutScroll
          style={{ display: "flex", flexWrap: "wrap", gap, listStyle: "none", padding: 0, margin: 0 }}
        >
          <AnimatePresence mode="popLayout">
            {items.map((item) => (
              <DraggableImageCell
                key={item.id}
                item={item}
                imageSize={imageSize}
                borderRadius={borderRadius}
                onDelete={onDelete}
                disabled={disabled}
                motionAllowed={motionAllowed}
              />
            ))}
          </AnimatePresence>
        </Reorder.Group>

        {canUpload ? (
          <>
            <Button
              type="button"
              variant="default"
              color="gray"
              aria-label={typeof uploadLabel === "string" ? uploadLabel : "Add images"}
              onClick={() => fileInputRef.current?.click()}
              w={imageSize}
              h={imageSize}
              p={4}
              radius={borderRadius}
              style={{ borderStyle: "dashed", fontSize: Math.max(10, imageSize * 0.14) }}
              styles={{
                inner: { height: "100%" },
                label: {
                  flexDirection: "column",
                  whiteSpace: "normal",
                  lineHeight: 1.2,
                },
              }}
            >
              {uploadLabel ?? (
                <>
                  <span style={{ fontSize: Math.max(18, imageSize * 0.3), lineHeight: 1 }}>+</span>
                  <span>{items.length}/{maxImages}</span>
                </>
              )}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={accept}
              onChange={handleFileChange}
              hidden
              disabled={disabled}
            />
          </>
        ) : null}
      </div>
    );
  },
);
