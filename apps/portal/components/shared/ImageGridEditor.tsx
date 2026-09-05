import { IMAGE_FILE_ACCEPT } from "@guild/shared";
import { Button } from "@portal/components/ui/button";
import { useReducedMotionPreference } from "@portal/hooks/useReducedMotionPreference";
import { AnimatePresence, Reorder, useDragControls, useMotionValue } from "motion/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { ImageGridEditorItem } from "@portal/types/media";
import { useTranslation } from "react-i18next";
import "./ImageGridEditor.css";

export type { ImageGridEditorItem };

export interface ImageGridEditorProps {
  items: ImageGridEditorItem[];
  onReorder: (items: ImageGridEditorItem[]) => void;
  onDelete?: (item: ImageGridEditorItem) => void;
  onFilesSelected?: (files: File[]) => void;
  maxImages: number;
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
  deletingIds?: ReadonlySet<string>;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
}

function DraggableImageCell({
  item,
  imageSize,
  borderRadius,
  onDelete,
  deleteLabel,
  disabled,
  deletePending,
  motionAllowed,
}: {
  item: ImageGridEditorItem;
  imageSize: number;
  borderRadius: number;
  onDelete?: (item: ImageGridEditorItem) => void;
  deleteLabel: string;
  disabled: boolean;
  deletePending: boolean;
  motionAllowed: boolean;
}) {
  const dragControls = useDragControls();
  const [isDragging, setIsDragging] = useState(false);
  const dragX = useMotionValue(0);

  useEffect(() => {
    if (!motionAllowed) dragX.jump(0);
  }, [dragX, motionAllowed]);

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
    padding: "var(--space-xs)",
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
      dragMomentum={motionAllowed}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => {
        setIsDragging(false);
        // Reorder 的松手回弹独立于 MotionConfig，需要直接结束位移。
        if (!motionAllowed) dragX.jump(0);
      }}
      layout="position"
      transition={motionAllowed ? undefined : { duration: 0 }}
      style={{
        ...cellStyle,
        x: dragX,
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
        <Button
          type="button"
          aria-label={deleteLabel}
          variant="ghost"
          size="icon"
          loading={deletePending}
          disabled={deletePending}
          className="image-grid-editor__delete"
          style={{ position: "absolute", top: -6, right: -6, zIndex: 10, width: 44, height: 44 }}
          onClick={(e) => {
            e.stopPropagation();
            if (deletePending) return;
            onDelete(item);
          }}
        >
          <span
            aria-hidden="true"
            className="image-grid-editor__delete-glyph"
            style={{
              display: "inline-grid",
              placeItems: "center",
              width: 20,
              height: 20,
              borderRadius: "50%",
              lineHeight: 1,
            }}
          >
            ×
          </span>
        </Button>
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
      maxImages,
      allowedTypes,
      onError,
      error,
      errorContent,
      loading,
      loadingContent,
      imageSize = 80,
      borderRadius = 8,
      gap = 8,
      accept = IMAGE_FILE_ACCEPT,
      uploadLabel,
      disabled = false,
      deletingIds,
      className,
      style: styleProp,
      "aria-label": ariaLabel,
      ...rest
    },
    ref,
  ) {
    const { t } = useTranslation("common");
    const motionAllowed = !useReducedMotionPreference();
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
            onError?.(new Error(`File type not allowed: ${rejected.map((f) => f.name).join(", ")}`));
          }
          selected = selected.filter((f) => allowedTypes.includes(f.type));
        }

        if (selected.length > 0) onFilesSelected(selected);
        e.target.value = "";
      },
      [items.length, maxImages, onFilesSelected, allowedTypes, onError],
    );

    const containerStyle: CSSProperties = {
      display: "flex",
      flexWrap: "wrap",
      gap,
      alignItems: "flex-start",
      justifyContent: "flex-start",
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
                deleteLabel={t("media.aria.deleteItem", { name: item.alt ?? item.id })}
                disabled={disabled}
                deletePending={deletingIds?.has(item.id) ?? false}
                motionAllowed={motionAllowed}
              />
            ))}
          </AnimatePresence>
        </Reorder.Group>

        {canUpload ? (
          <>
            <Button
              type="button"
              variant="outline"
              aria-label={typeof uploadLabel === "string" ? uploadLabel : t("media.aria.addImages")}
              onClick={() => fileInputRef.current?.click()}
              className="image-grid-editor__add"
              style={{
                width: imageSize,
                height: imageSize,
                padding: "var(--space-xs)",
                borderRadius,
                fontSize: Math.max(10, imageSize * 0.14),
              }}
            >
              {uploadLabel ?? (
                <>
                  {/* 加号的行框比字号高，跟着行高走会整体偏上；这里按字形高度对齐。 */}
                  <span
                    style={{
                      fontSize: Math.max(18, imageSize * 0.3),
                      lineHeight: 1,
                      display: "block",
                    }}
                  >
                    +
                  </span>
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
