import {
  SELECTABLE_IMAGE_TYPES,
  type CreateStorageItemPayload,
  type Storage,
  type StorageCategory,
  type StorageItem,
  type UpdateStorageItemPayload,
} from "@guild/shared";
import { PhotoOffIcon, TrashIcon, UploadIcon, XIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@portal/components/ui/drawer";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@portal/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@portal/components/ui/sheet";
import { Switch } from "@portal/components/ui/switch";
import { Textarea } from "@portal/components/ui/textarea";
import { useBeforeUnloadPrompt } from "@portal/hooks/useBeforeUnloadPrompt";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useKeyedPending } from "@portal/hooks/useKeyedPending";
import { useMediaQuery } from "@portal/hooks/useMediaQuery";
import { resolveMediaUrl } from "@portal/utils/media";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type ItemDraft = {
  category_id: string | null;
  name: string;
  description: string;
  allow_member_deposit: boolean;
  allow_member_withdraw: boolean;
};

type StorageItemEditorModalProps = {
  opened: boolean;
  selectedStorage: Storage | null;
  categories: StorageCategory[];
  item: StorageItem | null;
  isSaving: boolean;
  isDeleting: boolean;
  isUploading: boolean;
  onClose: () => void;
  onCreateItem: (payload: CreateStorageItemPayload, onSuccess: ItemSaveSuccess) => void;
  onUpdateItem: (id: string, payload: UpdateStorageItemPayload, onSuccess: ItemSaveSuccess) => void;
  onDeleteItem: (id: string) => void;
  onUploadImages: (itemId: string, files: File[]) => void;
  onDeleteImage: (itemId: string, imageId: string) => Promise<boolean>;
};

const emptyDraft: ItemDraft = {
  category_id: null,
  name: "",
  description: "",
  allow_member_deposit: false,
  allow_member_withdraw: false,
};

type ItemSaveSuccess = (item: StorageItem) => void;

function draftFromItem(item: StorageItem | null): ItemDraft {
  return item ? {
    category_id: item.category_id,
    name: item.name,
    description: item.description ?? "",
    allow_member_deposit: item.allow_member_deposit,
    allow_member_withdraw: item.allow_member_withdraw,
  } : { ...emptyDraft };
}

function sameDraft(left: ItemDraft, right: ItemDraft): boolean {
  return left.category_id === right.category_id
    && left.name === right.name
    && left.description === right.description
    && left.allow_member_deposit === right.allow_member_deposit
    && left.allow_member_withdraw === right.allow_member_withdraw;
}

export function StorageItemEditorModal({
  opened,
  selectedStorage,
  categories,
  item,
  isSaving,
  isDeleting,
  isUploading,
  onClose,
  onCreateItem,
  onUpdateItem,
  onDeleteItem,
  onUploadImages,
  onDeleteImage,
}: StorageItemEditorModalProps) {
  const { t } = useTranslation("storage");
  const confirm = useConfirmDialog();
  const isMobile = useMediaQuery("(max-width: 40em)");
  const [draft, setDraft] = useState<ItemDraft>(emptyDraft);
  const [baseline, setBaseline] = useState<ItemDraft>(emptyDraft);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const { pendingKeys, runPending } = useKeyedPending();

  useEffect(() => {
    if (!opened) {
      setHydratedFor(null);
      return;
    }
    const key = item?.id ?? "__new__";
    if (hydratedFor === key) return;
    const nextDraft = draftFromItem(item);
    setDraft(nextDraft);
    setBaseline(nextDraft);
    setBrokenImages(new Set());
    setHydratedFor(key);
  }, [hydratedFor, item, opened]);

  const isDirty = !sameDraft(draft, baseline);
  useBeforeUnloadPrompt(opened && isDirty);

  const patchDraft = (patch: Partial<ItemDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const categoryOptions = [
    { value: "uncategorized", label: t("category.uncategorized") },
    ...categories.map((category) => ({ value: category.id, label: category.name })),
  ];

  const handleSave = () => {
    if (!selectedStorage) return;
    const submittedDraft = draft;
    const payload = {
      ...draft,
      category_id: draft.category_id,
      description: draft.description.trim() || null,
    };
    const handleSaveSuccess: ItemSaveSuccess = (savedItem) => {
      const nextBaseline = draftFromItem(savedItem);
      setBaseline(nextBaseline);
      setHydratedFor(savedItem.id);
      setDraft((current) => sameDraft(current, submittedDraft) ? nextBaseline : current);
    };
    if (item) {
      onUpdateItem(item.id, payload, handleSaveSuccess);
    } else {
      onCreateItem({ ...payload, storage_id: selectedStorage.id }, handleSaveSuccess);
    }
  };

  const requestExit = async (): Promise<boolean> => {
    if (isDirty) {
      const confirmed = await confirm({
        title: t("common:unsavedChanges.title"),
        description: t("common:unsavedChanges.message"),
        confirmLabel: t("common:action.discard"),
        cancelLabel: t("common:action.cancel"),
        intent: "danger",
      });
      if (!confirmed) return false;
    }
    onClose();
    return true;
  };

  const editorBody = (
    <div className={`storage-item-editor ${item ? "" : "storage-item-editor--create"}`}>
      <div className="storage-item-editor__fields">
        {!selectedStorage ? <p className="storage-muted-copy">{t("empty.noStorage")}</p> : null}
        {selectedStorage ? (
          <div className="storage-item-editor__storage-context">
            <span className="storage-meta-label">{t("field.storage")}</span>
            <strong>{selectedStorage.name}</strong>
          </div>
        ) : null}

        <div className="storage-field">
          <Label htmlFor="storage-item-name">{t("field.itemName")}</Label>
          <Input
            id="storage-item-name"
            value={draft.name}
            onChange={(event) => patchDraft({ name: event.currentTarget.value })}
            disabled={!selectedStorage}
          />
        </div>
        <div className="storage-field">
          <Label htmlFor="storage-item-description">{t("field.description")}</Label>
          <Textarea
            id="storage-item-description"
            rows={3}
            value={draft.description}
            onChange={(event) => patchDraft({ description: event.currentTarget.value })}
            disabled={!selectedStorage}
          />
        </div>
        <div className="storage-field">
          <Label>{t("field.category")}</Label>
          <Select
            value={draft.category_id ?? "uncategorized"}
            items={categoryOptions}
            onValueChange={(value) => patchDraft({ category_id: value === "uncategorized" ? null : value ?? null })}
            disabled={!selectedStorage}
          >
            <SelectTrigger aria-label={t("field.category")} className="storage-field__control">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categoryOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <fieldset className="storage-item-editor__access">
          <legend>{t("manageItems.memberAccess")}</legend>
          <p>{t("manageItems.memberAccessHint")}</p>
          <label className="storage-switch-field">
            <Switch
              checked={draft.allow_member_deposit}
              onCheckedChange={(checked) => patchDraft({ allow_member_deposit: checked })}
              disabled={!selectedStorage}
            />
            <span>{t("field.allowDeposit")}</span>
          </label>
          <label className="storage-switch-field">
            <Switch
              checked={draft.allow_member_withdraw}
              onCheckedChange={(checked) => patchDraft({ allow_member_withdraw: checked })}
              disabled={!selectedStorage}
            />
            <span>{t("field.allowWithdraw")}</span>
          </label>
        </fieldset>
        {!item ? <p className="storage-muted-copy">{t("manageItems.noImages")}</p> : null}
      </div>

      {item ? (
        <section className="storage-item-editor__media" aria-labelledby="storage-item-images-title">
          <div className="storage-item-editor__media-header">
            <strong id="storage-item-images-title">{t("action.uploadImages")}</strong>
            <span>{item.images.length}</span>
          </div>
          {item.images.length ? (
            <div className="storage-item-editor__image-grid">
              {item.images.map((image, imageIndex) => (
                <div key={image.media_id} className="storage-item-editor__image">
                  {brokenImages.has(image.media_id) ? (
                    <span className="storage-item-editor__broken-image"><PhotoOffIcon size={26} /></span>
                  ) : (
                    <img
                      src={resolveMediaUrl(image.media_id)}
                      alt={item.name}
                      onError={() => setBrokenImages((current) => new Set(current).add(image.media_id))}
                    />
                  )}
                  <Button
                    variant="destructive"
                    size="icon-sm"
                    className="storage-item-editor__delete-image"
                    aria-label={t("action.deleteImage", {
                      index: imageIndex + 1,
                      total: item.images.length,
                      item: item.name,
                    })}
                    loading={pendingKeys.has(`delete:image:${item.id}/${image.media_id}`)}
                    onClick={() => {
                      void runPending(
                        `delete:image:${item.id}/${image.media_id}`,
                        () => onDeleteImage(item.id, image.media_id),
                      );
                    }}
                  >
                    <TrashIcon size={14} />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="storage-item-editor__empty-media"><PhotoOffIcon size={32} /></div>
          )}
          <label className="storage-item-editor__dropzone" aria-busy={isUploading || undefined}>
            <UploadIcon size={16} aria-hidden="true" />
            <span>{t("manageItems.uploadHint")}</span>
            <Input
              className="storage-item-editor__file-input"
              type="file"
              accept={SELECTABLE_IMAGE_TYPES.join(",")}
              multiple
              disabled={isUploading}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                if (files.length > 0) onUploadImages(item.id, files);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </section>
      ) : null}

      <div className={`storage-modal-actions ${item ? "" : "storage-modal-actions--create"}`}>
        {item ? (
          <Button variant="destructive" loading={isDeleting} onClick={() => onDeleteItem(item.id)}>
            {t("action.deleteItem")}
          </Button>
        ) : <span />}
        <div>
          <Button variant="outline" onClick={() => { void requestExit(); }}>{t("common:action.cancel")}</Button>
          <Button onClick={handleSave} disabled={!selectedStorage || !draft.name.trim()} loading={isSaving}>
            {item ? t("action.saveItem") : t("action.createItem")}
          </Button>
        </div>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={opened} onOpenChange={(nextOpen) => { if (!nextOpen) void requestExit(); }} swipeDirection="down" showSwipeHandle>
        <DrawerContent className={`storage-item-editor-shell ${item ? "" : "storage-item-editor-shell--create"}`}>
          <DrawerHeader className="storage-modal-header">
            <div className="storage-overlay-heading">
              <DrawerTitle>{item ? t("manageItems.editTitle") : t("manageItems.createTitle")}</DrawerTitle>
              <Button
                aria-label={t("common:action.close")}
                size="icon-sm"
                variant="ghost"
                onClick={() => { void requestExit(); }}
              >
                <XIcon size={16} />
              </Button>
            </div>
          </DrawerHeader>
          <div className="storage-modal-body">{editorBody}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={opened} onOpenChange={(nextOpen) => { if (!nextOpen) void requestExit(); }}>
      <SheetContent side="right" className={`storage-item-editor-shell ${item ? "" : "storage-item-editor-shell--create"}`} showCloseButton={false}>
        <SheetHeader className="storage-modal-header">
          <div className="storage-overlay-heading">
            <SheetTitle>{item ? t("manageItems.editTitle") : t("manageItems.createTitle")}</SheetTitle>
            <Button
              aria-label={t("common:action.close")}
              size="icon-sm"
              variant="ghost"
              onClick={() => { void requestExit(); }}
            >
              <XIcon size={16} />
            </Button>
          </div>
        </SheetHeader>
        <div className="storage-modal-body">{editorBody}</div>
      </SheetContent>
    </Sheet>
  );
}
