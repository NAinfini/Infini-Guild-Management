import type { ClassCatalogItem } from "@guild/shared";
import { useState, type CSSProperties } from "react";
import { resolveMediaUrl } from "../../utils/media";
import { ClassGlyphIcon } from "./ClassGlyphIcon";
import "./ClassIcon.css";

type ClassIconProps = {
  item: Pick<ClassCatalogItem, "label" | "color" | "icon_type" | "vector_icon" | "icon_media_id">;
  size?: number;
  framed?: boolean;
  className?: string;
  label?: string;
};

export function ClassIcon({
  item,
  size = 28,
  framed = true,
  className = "",
  label,
}: ClassIconProps) {
  const [failedMediaId, setFailedMediaId] = useState<string | null>(null);
  const showImage =
    item.icon_type === "image"
    && item.icon_media_id
    && failedMediaId !== item.icon_media_id;
  const iconSize = Math.max(12, Math.round(size * (framed ? 0.56 : 0.82)));
  const accessibleProps = label
    ? { role: "img", "aria-label": label }
    : { "aria-hidden": true };

  return (
    <span
      {...accessibleProps}
      className={`class-icon${framed ? " class-icon--framed" : ""}${className ? ` ${className}` : ""}`}
      style={{
        width: size,
        height: size,
        "--class-color": item.color,
      } as CSSProperties}
    >
      {showImage ? (
        <img
          src={resolveMediaUrl(item.icon_media_id!)}
          alt=""
          className="class-icon__image"
          loading="lazy"
          decoding="async"
          onError={() => setFailedMediaId(item.icon_media_id)}
        />
      ) : item.icon_type === "vector" && item.vector_icon ? (
        <ClassGlyphIcon
          iconId={item.vector_icon}
          size={iconSize}
          className="class-icon__vector"
        />
      ) : null}
    </span>
  );
}
