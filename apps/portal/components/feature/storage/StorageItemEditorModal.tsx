import type { CreateStorageItemPayload, Storage, StorageCategory, StorageItem, UpdateStorageItemPayload } from "@guild/shared";
import { ActionIcon, Button, Group, Image, Modal, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { Dropzone, IMAGE_MIME_TYPE } from "@mantine/dropzone";
import { useEffect, useState } from "react";
import { PhotoOffIcon, TrashIcon, UploadIcon } from "@portal/components/icons";

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
  resolveImageUrl: (key: string) => string;
  onClose: () => void;
  onCreateItem: (payload: CreateStorageItemPayload) => void;
  onUpdateItem: (id: string, payload: UpdateStorageItemPayload) => void;
  onDeleteItem: (id: string) => void;
  onUploadImages: (itemId: string, files: File[]) => void;
  onDeleteImage: (itemId: string, imageId: string) => void;
  labels: {
    createTitle: string;
    editTitle: string;
    name: string;
    description: string;
    category: string;
    allowDeposit: string;
    allowWithdraw: string;
    uncategorized: string;
    create: string;
    save: string;
    delete: string;
    uploadImages: string;
    uploadHint: string;
    noStorage: string;
    noImages: string;
  };
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
  resolveImageUrl,
  onClose,
  onCreateItem,
  onUpdateItem,
  onDeleteItem,
  onUploadImages,
  onDeleteImage,
  labels,
}: StorageItemEditorModalProps) {
  const [draft, setDraft] = useState<ItemDraft>(emptyDraft);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!opened) return;
    setDraft(item ? {
      category_id: item.category_id,
      name: item.name,
      description: item.description ?? "",
      allow_member_deposit: item.allow_member_deposit,
      allow_member_withdraw: item.allow_member_withdraw,
    } : emptyDraft);
    setBrokenImages(new Set());
  }, [item, opened]);

  const categoryOptions = [
    { value: "uncategorized", label: labels.uncategorized },
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
    <Modal
      opened={opened}
      onClose={onClose}
      title={item ? labels.editTitle : labels.createTitle}
      size={item ? "xl" : "md"}
      classNames={{
        content: `storage-modal-content storage-item-editor-shell ${item ? "" : "storage-item-editor-shell--create"}`.trim(),
        header: "storage-modal-header",
        body: "storage-modal-body",
      }}
    >
      <Stack gap="md">
        {!selectedStorage ? <Text size="sm" c="dimmed">{labels.noStorage}</Text> : null}
        <div className={`storage-item-editor ${item ? "" : "storage-item-editor--create"}`}>
          <Stack gap="sm">
            <TextInput label={labels.name} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.currentTarget.value }))} disabled={!selectedStorage} />
            <Textarea autosize label={labels.description} minRows={3} maxRows={5} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.currentTarget.value }))} disabled={!selectedStorage} />
            <Select
              label={labels.category}
              value={draft.category_id ?? "uncategorized"}
              data={categoryOptions}
              onChange={(value) => setDraft((current) => ({ ...current, category_id: value === "uncategorized" ? null : value }))}
              disabled={!selectedStorage}
            />
            <Group>
              <Switch checked={draft.allow_member_deposit} label={labels.allowDeposit} onChange={(event) => setDraft((current) => ({ ...current, allow_member_deposit: event.currentTarget.checked }))} />
              <Switch checked={draft.allow_member_withdraw} label={labels.allowWithdraw} onChange={(event) => setDraft((current) => ({ ...current, allow_member_withdraw: event.currentTarget.checked }))} />
            </Group>
            {!item ? <Text size="sm" c="dimmed">{labels.noImages}</Text> : null}
          </Stack>

          {item ? (
            <Stack gap="sm" className="storage-item-editor__media">
              <Group justify="space-between" gap="xs" wrap="nowrap" className="storage-item-editor__media-header">
                <Text fw={800}>{labels.uploadImages}</Text>
                <Text size="xs" c="dimmed">{item.images.length}</Text>
              </Group>
              {item.images.length ? (
                <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
                  {item.images.map((image) => (
                    <div key={image.id} className="storage-item-editor__image">
                      {brokenImages.has(image.id) ? (
                        <span className="storage-item-editor__broken-image"><PhotoOffIcon size={26} /></span>
                      ) : (
                        <Image src={resolveImageUrl(image.r2_key)} alt={item.name} fit="cover" onError={() => setBrokenImages((current) => new Set(current).add(image.id))} />
                      )}
                      <ActionIcon color="red" variant="filled" className="storage-item-editor__delete-image" onClick={() => onDeleteImage(item.id, image.id)}>
                        <TrashIcon size={14} />
                      </ActionIcon>
                    </div>
                  ))}
                </SimpleGrid>
              ) : (
                <div className="storage-item-editor__empty-media"><PhotoOffIcon size={32} /></div>
              )}
              <Dropzone accept={IMAGE_MIME_TYPE} onDrop={(files) => onUploadImages(item.id, files)} loading={isUploading}>
                <Group justify="center" gap="sm" className="storage-item-editor__dropzone">
                  <UploadIcon size={16} />
                  <Text size="sm">{labels.uploadHint}</Text>
                </Group>
              </Dropzone>
            </Stack>
          ) : null}
        </div>

        <Group justify={item ? "space-between" : "flex-end"} className={`storage-modal-actions ${item ? "" : "storage-modal-actions--create"}`.trim()}>
          {item ? <Button color="red" variant="light" loading={isDeleting} onClick={() => onDeleteItem(item.id)}>{labels.delete}</Button> : null}
          <Button onClick={handleSave} disabled={!selectedStorage || !draft.name.trim()} loading={isSaving}>{item ? labels.save : labels.create}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
