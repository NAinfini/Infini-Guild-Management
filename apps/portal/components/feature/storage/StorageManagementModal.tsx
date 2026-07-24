import type { CreateStorageCategoryPayload, CreateStoragePayload, Storage } from "@guild/shared";
import { ActionIcon, Badge, Button, Group, Modal, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { PlusIcon, TrashIcon } from "@portal/components/icons";
import { useEffect, useState } from "react";

type StorageManagementModalProps = {
  opened: boolean;
  storages: Storage[];
  selectedStorage: Storage | null;
  selectedCategoryId: string | null;
  isSaving: boolean;
  isDeleting: boolean;
  onClose: () => void;
  onSelectStorage: (id: string) => void;
  onSelectCategory: (storageId: string, categoryId: string) => void;
  onCreateStorage: (payload: CreateStoragePayload) => void;
  onUpdateStorage: (id: string, payload: Partial<CreateStoragePayload>) => void;
  onDeleteStorage: (id: string) => void;
  onCreateCategory: (storageId: string, payload: CreateStorageCategoryPayload) => void;
  onUpdateCategory: (storageId: string, categoryId: string, payload: CreateStorageCategoryPayload) => void;
  onDeleteCategory: (storageId: string, categoryId: string) => void;
  labels: {
    title: string;
    editTitle: string;
    storageList: string;
    name: string;
    description: string;
    emptyDescription: string;
    create: string;
    save: string;
    delete: string;
    cancel: string;
    noStorages: string;
    defaultStorageName: string;
    defaultCategoryName: string;
    categoryName: string;
    editCategoryTitle: string;
    createCategory: string;
    saveCategory: string;
    deleteCategory: string;
    noCategories: string;
  };
};

export function StorageManagementModal({
  opened,
  storages,
  selectedStorage,
  selectedCategoryId,
  isSaving,
  isDeleting,
  onClose,
  onSelectStorage,
  onSelectCategory,
  onCreateStorage,
  onUpdateStorage,
  onDeleteStorage,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  labels,
}: StorageManagementModalProps) {
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategoryName, setEditCategoryName] = useState("");

  const selectedCategory = selectedStorage?.categories.find((category) => category.id === selectedCategoryId) ?? null;
  const selectedNodeType = selectedCategory ? "category" : selectedStorage ? "storage" : null;
  const selectedContextName = selectedCategory?.name ?? selectedStorage?.name ?? labels.noStorages;
  const selectedContextDetail = selectedCategory
    ? selectedStorage?.name
    : selectedStorage?.description || labels.emptyDescription;

  useEffect(() => {
    setEditName(selectedStorage?.name ?? "");
    setEditDescription(selectedStorage?.description ?? "");
  }, [selectedStorage]);

  useEffect(() => {
    setEditCategoryName(selectedCategory?.name ?? "");
  }, [selectedCategory]);

  const handleCreateStorage = () => {
    onCreateStorage({ name: labels.defaultStorageName, description: null });
  };

  const handleCreateCategory = (storageId: string) => {
    onCreateCategory(storageId, { name: labels.defaultCategoryName });
  };

  const handleUpdateStorage = () => {
    if (!selectedStorage) return;
    onUpdateStorage(selectedStorage.id, { name: editName, description: editDescription.trim() || null });
  };

  const handleUpdateCategory = () => {
    if (!selectedStorage || !selectedCategory) return;
    onUpdateCategory(selectedStorage.id, selectedCategory.id, { name: editCategoryName });
  };

  return (
    <Modal opened={opened} onClose={onClose} title={labels.title} size="xl" classNames={{ content: "storage-modal-content", header: "storage-modal-header", body: "storage-modal-body" }}>
      <div className="storage-management-modal">
        <Stack gap="xs" className="storage-management-modal__tree">
          <Group justify="space-between" gap="xs" wrap="nowrap" className="storage-management-modal__tree-header">
            <Text fw={700}>{labels.storageList}</Text>
            <Button size="compact-xs" variant="light" leftSection={<PlusIcon size={13} />} loading={isSaving} onClick={handleCreateStorage}>
              {labels.create}
            </Button>
          </Group>

          {storages.length === 0 ? <Text size="sm" c="dimmed">{labels.noStorages}</Text> : null}

          {storages.map((storage) => (
            <div key={storage.id} className="storage-management-modal__tree-group">
              <div className={`storage-management-modal__tree-row storage-management-modal__tree-row--storage ${selectedNodeType === "storage" && selectedStorage?.id === storage.id ? "storage-management-modal__tree-row--active" : ""}`}>
                <button type="button" className="storage-management-modal__tree-node" onClick={() => onSelectStorage(storage.id)}>
                  <span>
                    <Text fw={800} lineClamp={1}>{storage.name}</Text>
                    <Text size="xs" c="dimmed" lineClamp={1}>{storage.description || labels.emptyDescription}</Text>
                  </span>
                  <Badge size="xs" variant="light">{storage.categories.length}</Badge>
                </button>
                <Group gap={2} wrap="nowrap" className="storage-management-modal__node-actions">
                  <ActionIcon size="sm" variant="subtle" aria-label={labels.createCategory} loading={isSaving} onClick={() => handleCreateCategory(storage.id)}>
                    <PlusIcon size={13} />
                  </ActionIcon>
                  <ActionIcon size="sm" color="red" variant="subtle" aria-label={labels.delete} loading={isDeleting} onClick={() => onDeleteStorage(storage.id)}>
                    <TrashIcon size={13} />
                  </ActionIcon>
                </Group>
              </div>

              <div className="storage-management-modal__tree-children">
                {storage.categories.length === 0 ? <Text size="xs" c="dimmed" className="storage-management-modal__tree-empty">{labels.noCategories}</Text> : null}
                {storage.categories.map((category) => (
                  <div
                    key={category.id}
                    className={`storage-management-modal__tree-row storage-management-modal__tree-row--category ${selectedNodeType === "category" && selectedCategory?.id === category.id ? "storage-management-modal__tree-row--active" : ""}`}
                  >
                    <button type="button" className="storage-management-modal__tree-node" onClick={() => onSelectCategory(storage.id, category.id)}>
                      <Text size="sm" fw={700} lineClamp={1}>{category.name}</Text>
                    </button>
                    <ActionIcon size="sm" color="red" variant="subtle" aria-label={labels.deleteCategory} loading={isDeleting} onClick={() => onDeleteCategory(storage.id, category.id)}>
                      <TrashIcon size={13} />
                    </ActionIcon>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Stack>

        <div className="storage-management-modal__workspace">
          {selectedNodeType === "category" ? (
            <Stack gap="sm" className="storage-modal-panel storage-management-modal__edit-panel">
              <div className="storage-management-modal__context">
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <span>
                    <Text size="xs" c="dimmed">{labels.editCategoryTitle}</Text>
                    <Text fw={900} lineClamp={1}>{selectedContextName}</Text>
                  </span>
                  <Badge variant="light">{labels.categoryName}</Badge>
                </Group>
                <Text size="xs" c="dimmed" lineClamp={2}>{selectedContextDetail}</Text>
              </div>
              <TextInput label={labels.categoryName} value={editCategoryName} onChange={(event) => setEditCategoryName(event.currentTarget.value)} disabled={!selectedCategory} />
              <Group justify="flex-end" className="storage-modal-actions">
                <Group>
                  <Button variant="default" onClick={onClose}>{labels.cancel}</Button>
                  <Button onClick={handleUpdateCategory} disabled={!selectedStorage || !selectedCategory || !editCategoryName.trim() || editCategoryName.trim() === selectedCategory.name} loading={isSaving}>{labels.saveCategory}</Button>
                </Group>
              </Group>
            </Stack>
          ) : (
            <Stack gap="sm" className="storage-modal-panel storage-management-modal__edit-panel">
              <div className="storage-management-modal__context">
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <span>
                    <Text size="xs" c="dimmed">{labels.editTitle}</Text>
                    <Text fw={900} lineClamp={1}>{selectedContextName}</Text>
                  </span>
                  <Badge variant="light">{selectedStorage?.categories.length ?? 0}</Badge>
                </Group>
                <Text size="xs" c="dimmed" lineClamp={2}>{selectedContextDetail}</Text>
              </div>
              <TextInput label={labels.name} value={editName} onChange={(event) => setEditName(event.currentTarget.value)} disabled={!selectedStorage} />
              <Textarea label={labels.description} minRows={3} value={editDescription} onChange={(event) => setEditDescription(event.currentTarget.value)} disabled={!selectedStorage} />
              <Group justify="flex-end" className="storage-modal-actions">
                <Group>
                  <Button variant="default" onClick={onClose}>{labels.cancel}</Button>
                  <Button onClick={handleUpdateStorage} disabled={!selectedStorage || !editName.trim()} loading={isSaving}>{labels.save}</Button>
                </Group>
              </Group>
            </Stack>
          )}
        </div>
      </div>
    </Modal>
  );
}
