import {
  CLASS_ICON_FILE_ACCEPT,
  CLASS_VECTOR_ICON_IDS,
  type ClassCatalogItem,
} from "@guild/shared";
import { Button } from "@portal/components/ui/button";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { PhotoIcon, UploadIcon } from "@portal/components/icons";
import type { ClassEditorDraft } from "@portal/hooks/useAdminClassesController";
import type { CSSProperties, Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ClassGlyphIcon } from "../../shared/ClassGlyphIcon";
import { ClassIcon } from "../../shared/ClassIcon";

const COLOR_SWATCHES = [
  "#61B8AA",
  "#6EA8FE",
  "#A78BFA",
  "#E27676",
  "#D6A85F",
  "#E18BB6",
  "#75B86B",
  "#8594A8",
];

export function isHexColor(value: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(value);
}

function LocalImagePreview({
  file,
  label,
  className = "admin-classes__local-preview",
}: {
  file: File;
  label: string;
  className?: string;
}) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt={label} className={className} />;
}

type AdminClassEditorFormProps = {
  draft: ClassEditorDraft;
  existing: ClassCatalogItem | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onDraftChange: Dispatch<SetStateAction<ClassEditorDraft>>;
};

export function AdminClassEditorForm({
  draft,
  existing,
  fileInputRef,
  onDraftChange,
}: AdminClassEditorFormProps) {
  const { t } = useTranslation("admin");
  const setColor = (color: string) => {
    onDraftChange((current) => ({ ...current, color }));
  };

  return (
    <div className="admin-classes__editor">
      <aside className="admin-classes__preview-panel">
        <span className="admin-classes__preview-label">{t("classes.preview")}</span>
        <div className="admin-classes__preview-icon">
          {draft.iconMode === "image" && draft.imageFile ? (
            <LocalImagePreview file={draft.imageFile} label={draft.label || t("classes.preview")} />
          ) : (
            <ClassIcon
              item={{
                label: draft.label,
                color: draft.color,
                icon_type: draft.iconMode,
                vector_icon: draft.vectorIcon,
                icon_media_id: existing?.icon_media_id ?? null,
              }}
              size={72}
              label={draft.label || t("classes.preview")}
            />
          )}
        </div>
        <span className="admin-classes__preview-name">
          {draft.label.trim() || t("classes.untitled")}
        </span>
        <span className="admin-classes__preview-color">{draft.color.toUpperCase()}</span>
      </aside>

      <div className="admin-classes__form">
        <div className="admin-md__field">
          <Label htmlFor="class-label">{t("classes.field.label")}</Label>
          <Input
            id="class-label"
            value={draft.label}
            maxLength={80}
            onChange={(event) => {
              const { value } = event.currentTarget;
              onDraftChange((current) => ({ ...current, label: value }));
            }}
            required
          />
          <p className="admin-md__field-description">{t("classes.field.labelDescription")}</p>
        </div>

        <div className="admin-md__field admin-classes__color-field">
          <Label htmlFor="class-color-picker">{t("classes.field.color")}</Label>
          <div className="admin-classes__color-controls">
            <Input
              id="class-color-picker"
              type="color"
              className="admin-classes__color-picker"
              aria-label={t("classes.aria.pickScreenColor")}
              value={isHexColor(draft.color) ? draft.color : COLOR_SWATCHES[0]}
              onChange={(event) => setColor(event.currentTarget.value.toUpperCase())}
            />
            <Input
              type="text"
              inputMode="text"
              className="admin-classes__color-value"
              value={draft.color}
              maxLength={7}
              pattern="#[0-9A-Fa-f]{6}"
              aria-label={t("classes.field.color")}
              onChange={(event) => setColor(event.currentTarget.value)}
            />
          </div>
          <div className="admin-classes__color-swatches" role="group" aria-label={t("classes.field.color")}>
            {COLOR_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className="admin-classes__color-swatch"
                style={{ "--class-swatch": swatch } as CSSProperties}
                aria-label={swatch}
                aria-pressed={draft.color.toUpperCase() === swatch}
                onClick={() => setColor(swatch)}
              />
            ))}
          </div>
        </div>

        <div className="admin-md__field">
          <span className="admin-md__field-label">{t("classes.field.source")}</span>
          <div className="admin-classes__source-options" role="group" aria-label={t("classes.field.source")}>
            <Button
              type="button"
              variant={draft.iconMode === "vector" ? "secondary" : "outline"}
              size="sm"
              aria-pressed={draft.iconMode === "vector"}
              onClick={() => onDraftChange((current) => ({ ...current, iconMode: "vector" }))}
            >
              {t("classes.source.vector")}
            </Button>
            <Button
              type="button"
              variant={draft.iconMode === "image" ? "secondary" : "outline"}
              size="sm"
              aria-pressed={draft.iconMode === "image"}
              onClick={() => onDraftChange((current) => ({ ...current, iconMode: "image" }))}
            >
              {t("classes.source.image")}
            </Button>
          </div>
        </div>

        {draft.iconMode === "vector" ? (
          <div className="admin-classes__icon-library">
            <span className="admin-md__field-label">{t("classes.field.fallbackIcon")}</span>
            <p className="admin-md__field-description">{t("classes.field.fallbackDescription")}</p>
            <div className="admin-classes__icon-grid" role="group" aria-label={t("classes.iconLibrary")}>
              {CLASS_VECTOR_ICON_IDS.map((iconId) => {
                const selected = draft.vectorIcon === iconId;
                const iconLabel = t(`classes.icon.${iconId}`, { defaultValue: iconId });
                return (
                  <Tooltip key={iconId}>
                    <TooltipTrigger
                      render={(
                        <button
                          type="button"
                          className={`admin-classes__icon-option${selected ? " admin-classes__icon-option--selected" : ""}`}
                          aria-pressed={selected}
                          aria-label={t("classes.aria.selectIcon", { icon: iconLabel })}
                          onClick={() => onDraftChange((current) => ({ ...current, vectorIcon: iconId }))}
                        />
                      )}
                    >
                      <ClassGlyphIcon iconId={iconId} size={20} />
                    </TooltipTrigger>
                    <TooltipContent>{iconLabel}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        ) : null}

        {draft.iconMode === "image" ? (
          <div className="admin-classes__upload-box">
            <div className="admin-classes__upload-head">
              <div className="admin-classes__upload-copy">
                <span className="admin-classes__upload-title">{t("classes.upload.title")}</span>
                <span className="admin-md__muted">{t("classes.upload.description")}</span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={CLASS_ICON_FILE_ACCEPT}
                className="admin-classes__file-input"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] ?? null;
                  onDraftChange((current) => ({ ...current, imageFile: file }));
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadIcon size={16} />
                {draft.imageFile ? t("classes.upload.replace") : t("classes.upload.choose")}
              </Button>
            </div>
            {draft.imageFile ? (
              <div className="admin-classes__asset-summary">
                <LocalImagePreview
                  file={draft.imageFile}
                  label={draft.label || t("classes.preview")}
                  className="admin-classes__asset-thumb"
                />
                <div className="admin-classes__asset-copy">
                  <span className="admin-classes__asset-name">{draft.imageFile.name}</span>
                  <span className="admin-classes__asset-meta">
                    <PhotoIcon size={13} />
                    {Math.ceil(draft.imageFile.size / 1024)} KiB · {draft.imageFile.type || "image"}
                  </span>
                </div>
              </div>
            ) : existing?.icon_type === "image" ? (
              <div className="admin-classes__asset-summary">
                <ClassIcon item={existing} size={40} label={existing.label} />
                <div className="admin-classes__asset-copy">
                  <span className="admin-classes__asset-name">{t("classes.upload.currentImage")}</span>
                  <span className="admin-classes__asset-meta">
                    {t("classes.upload.assetId", { id: existing.icon_media_id })}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
