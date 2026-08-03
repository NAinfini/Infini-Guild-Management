import { IMAGE_FILE_ACCEPT } from "@guild/shared";
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
import { useTranslation } from "react-i18next";
import "./ImageGridEditor.css";

export type { ImageGridEditorItem };

/*
 * 添加位要和它左边那排缩略图是同一种方块，只是空着。Mantine 的 variant="default"
 * 给的是控件灰（--mantine-color-default），深色下比图片底色亮一档，结果这一格比
 * 七张真图还抢眼——加号是最不重要的那一格。
 *
 * 走内联变量而不是 CSS class：Mantine 把变体色解析成 --button-* 写在元素的
 * style 属性上，样式表里的同名声明永远盖不过它。同 ProfileAccountTab 的
 * LOGOUT_BUTTON_VARS 先例。
 */
const ADD_TILE_VARS = {
  "--button-bg": "var(--surface-sunken)",
  "--button-bd": "1px dashed var(--border-subtle)",
  "--button-color": "var(--text-muted)",
  "--button-hover": "var(--surface-raised)",
  "--button-hover-color": "var(--text-primary)",
} as CSSProperties;

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
  deleteLabel,
  disabled,
  motionAllowed,
}: {
  item: ImageGridEditorItem;
  imageSize: number;
  borderRadius: number;
  onDelete?: (item: ImageGridEditorItem) => void;
  deleteLabel: string;
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
          aria-label={deleteLabel}
          color="red"
          variant="transparent"
          radius="xl"
          size={44}
          style={{ position: "absolute", top: -6, right: -6, zIndex: 10 }}
          onClick={(e) => {
            e.stopPropagation();
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
      accept = IMAGE_FILE_ACCEPT,
      uploadLabel,
      disabled = false,
      className,
      style: styleProp,
      "aria-label": ariaLabel,
      ...rest
    },
    ref,
  ) {
    const { t } = useTranslation("common");
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
                deleteLabel={t("media.aria.deleteItem", { name: item.alt ?? item.id })}
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
              aria-label={typeof uploadLabel === "string" ? uploadLabel : t("media.aria.addImages")}
              onClick={() => fileInputRef.current?.click()}
              w={imageSize}
              h={imageSize}
              p={4}
              radius={borderRadius}
              style={{ ...ADD_TILE_VARS, fontSize: Math.max(10, imageSize * 0.14) }}
              styles={{
                /*
                 * 两个轴都显式居中。Button 的 label 在 column 方向下只保证交叉轴
                 * （横向）居中，主轴留给默认值，加号和计数那一组就贴在方块上沿。
                 */
                inner: { height: "100%", width: "100%" },
                label: {
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  height: "100%",
                  width: "100%",
                  whiteSpace: "normal",
                  lineHeight: 1.2,
                },
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
