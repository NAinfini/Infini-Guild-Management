import type { CreateStorageItemPayload, Storage, StorageCategory, StorageItem, UpdateStorageItemPayload } from "@guild/shared";
import { ActionIcon, Button, Drawer, Group, Image, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { SELECTABLE_IMAGE_TYPES } from "@guild/shared";
import { useMediaQuery } from "@mantine/hooks";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PhotoOffIcon, TrashIcon, UploadIcon } from "@portal/components/icons";
import { resolveStorageMediaUrl } from "@portal/utils/media";

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
  onCreateItem: (payload: CreateStorageItemPayload) => void;
  onUpdateItem: (id: string, payload: UpdateStorageItemPayload) => void;
  onDeleteItem: (id: string) => void;
  onUploadImages: (itemId: string, files: File[]) => void;
  onDeleteImage: (itemId: string, imageId: string) => void;
};

const emptyDraft: ItemDraft = {
  category_id: null,
  name: "",
  description: "",
  allow_member_deposit: false,
  allow_member_withdraw: false,
};

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
  const isMobile = useMediaQuery("(max-width: 40em)");
  const [draft, setDraft] = useState<ItemDraft>(emptyDraft);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  /*
   * 每个物品只灌一次表单。
   *
   * 原来这里的依赖是 item 这个对象本身，只要它换了引用就整份重置。抽屉打开时
   * 先拿列表里那一行顶上，随后 /api/storage/items/:id 的结果到位，item 就换了个
   * 新对象——内容一模一样，但这一下会把用户已经敲进去的名称/描述抹掉，接着点保存
   * 提交的就是旧值。WebSocket 推来的失效重取同理。
   * 现在按物品 id 记账：换物品才重新灌，同一个物品的后续重取不再动草稿。
   */
  useEffect(() => {
    if (!opened) {
      setHydratedFor(null);
      return;
    }
    const key = item?.id ?? "__new__";
    if (hydratedFor === key) return;
    setDraft(item ? {
      category_id: item.category_id,
      name: item.name,
      description: item.description ?? "",
      allow_member_deposit: item.allow_member_deposit,
      allow_member_withdraw: item.allow_member_withdraw,
    } : emptyDraft);
    setBrokenImages(new Set());
    setHydratedFor(key);
  }, [hydratedFor, item, opened]);

  /*
   * 事件字段必须在处理函数里当场读出来。
   * setDraft 的 updater 是 React 之后才调用的，那时 event.currentTarget 已经是 null，
   * 在 updater 里读 .value/.checked 会抛 TypeError 并把整页打进错误边界。
   */
  const patchDraft = (patch: Partial<ItemDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const categoryOptions = [
    { value: "uncategorized", label: t("category.uncategorized") },
    ...categories.map((category) => ({ value: category.id, label: category.name })),
  ];

  const handleSave = () => {
    if (!selectedStorage) return;
    const payload = {
      ...draft,
      category_id: draft.category_id,
      description: draft.description.trim() || null,
    };
    if (item) {
      onUpdateItem(item.id, payload);
    } else {
      onCreateItem({ ...payload, storage_id: selectedStorage.id });
    }
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={item ? t("manageItems.editTitle") : t("manageItems.createTitle")}
      position="right"
      size={isMobile ? "100%" : 620}
      classNames={{
        content: `storage-item-editor-shell ${item ? "" : "storage-item-editor-shell--create"}`.trim(),
        header: "storage-modal-header",
        body: "storage-modal-body",
      }}
    >
      <Stack gap="md">
        {!selectedStorage ? <Text size="sm" c="dimmed">{t("empty.noStorage")}</Text> : null}
        <div className={`storage-item-editor ${item ? "" : "storage-item-editor--create"}`}>
          <Stack gap="sm">
            {selectedStorage ? (
              <div className="storage-item-editor__storage-context">
                <Text size="xs" c="dimmed">{t("field.storage")}</Text>
                <Text fw={700}>{selectedStorage.name}</Text>
              </div>
            ) : null}
            <TextInput label={t("field.itemName")} value={draft.name} onChange={(event) => patchDraft({ name: event.currentTarget.value })} disabled={!selectedStorage} />
            <Textarea autosize label={t("field.description")} minRows={3} maxRows={5} value={draft.description} onChange={(event) => patchDraft({ description: event.currentTarget.value })} disabled={!selectedStorage} />
            <Select
              label={t("field.category")}
              value={draft.category_id ?? "uncategorized"}
              data={categoryOptions}
              onChange={(value) => setDraft((current) => ({ ...current, category_id: value === "uncategorized" ? null : value }))}
              disabled={!selectedStorage}
            />
            <div className="storage-item-editor__access">
              <Text size="sm" fw={700}>{t("manageItems.memberAccess")}</Text>
              <Text size="xs" c="dimmed">{t("manageItems.memberAccessHint")}</Text>
              <Stack gap="xs" mt="sm">
                <Switch checked={draft.allow_member_deposit} label={t("field.allowDeposit")} onChange={(event) => patchDraft({ allow_member_deposit: event.currentTarget.checked })} />
                <Switch checked={draft.allow_member_withdraw} label={t("field.allowWithdraw")} onChange={(event) => patchDraft({ allow_member_withdraw: event.currentTarget.checked })} />
              </Stack>
            </div>
            {!item ? <Text size="sm" c="dimmed">{t("manageItems.noImages")}</Text> : null}
          </Stack>

          {item ? (
            <Stack gap="sm" className="storage-item-editor__media">
              <Group justify="space-between" gap="xs" wrap="nowrap" className="storage-item-editor__media-header">
                <Text fw={800}>{t("action.uploadImages")}</Text>
                <Text size="xs" c="dimmed">{item.images.length}</Text>
              </Group>
              {item.images.length ? (
                <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
                  {item.images.map((image) => (
                    <div key={image.id} className="storage-item-editor__image">
                      {brokenImages.has(image.id) ? (
                        <span className="storage-item-editor__broken-image"><PhotoOffIcon size={26} /></span>
                      ) : (
                        <Image src={resolveStorageMediaUrl(image.r2_key)} alt={item.name} fit="cover" onError={() => setBrokenImages((current) => new Set(current).add(image.id))} />
                      )}
                      <ActionIcon
                        color="red"
                        variant="filled"
                        className="storage-item-editor__delete-image"
                        aria-label={t("action.deleteImage")}
                        onClick={() => onDeleteImage(item.id, image.id)}
                      >
                        <TrashIcon size={14} />
                      </ActionIcon>
                    </div>
                  ))}
                </SimpleGrid>
              ) : (
                <div className="storage-item-editor__empty-media"><PhotoOffIcon size={32} /></div>
              )}
              <Dropzone accept={[...SELECTABLE_IMAGE_TYPES]} onDrop={(files) => onUploadImages(item.id, files)} loading={isUploading}>
                <Group justify="center" gap="sm" className="storage-item-editor__dropzone">
                  <UploadIcon size={16} />
                  <Text size="sm">{t("manageItems.uploadHint")}</Text>
                </Group>
              </Dropzone>
            </Stack>
          ) : null}
        </div>

        <Group justify={item ? "space-between" : "flex-end"} className={`storage-modal-actions ${item ? "" : "storage-modal-actions--create"}`.trim()}>
          {item ? <Button color="red" variant="light" loading={isDeleting} onClick={() => onDeleteItem(item.id)}>{t("action.deleteItem")}</Button> : null}
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>{t("common:action.cancel")}</Button>
            <Button onClick={handleSave} disabled={!selectedStorage || !draft.name.trim()} loading={isSaving}>{item ? t("action.saveItem") : t("action.createItem")}</Button>
          </Group>
        </Group>
      </Stack>
    </Drawer>
  );
}
