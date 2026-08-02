import type { CreateStorageCategoryPayload, CreateStoragePayload, Storage } from "@guild/shared";
import { ActionIcon, Badge, Button, Drawer, Group, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { PlusIcon, TrashIcon } from "@portal/components/icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type CreationDraft =
  | { type: "storage" }
  | { type: "category"; storageId: string };

type StorageStructureManagerProps = {
  storages: Storage[];
  selectedStorage: Storage | null;
  selectedCategoryId: string | null;
  isSaving: boolean;
  isDeleting: boolean;
  onSelectStorage: (id: string) => void;
  onSelectCategory: (storageId: string, categoryId: string) => void;
  onCreateStorage: (payload: CreateStoragePayload, onSuccess: () => void) => void;
  onUpdateStorage: (id: string, payload: Partial<CreateStoragePayload>) => void;
  onDeleteStorage: (id: string) => void;
  onCreateCategory: (storageId: string, payload: CreateStorageCategoryPayload, onSuccess: () => void) => void;
  onUpdateCategory: (storageId: string, categoryId: string, payload: CreateStorageCategoryPayload) => void;
  onDeleteCategory: (storageId: string, categoryId: string) => void;
};

export function StorageStructureManager({
  storages,
  selectedStorage,
  selectedCategoryId,
  isSaving,
  isDeleting,
  onSelectStorage,
  onSelectCategory,
  onCreateStorage,
  onUpdateStorage,
  onDeleteStorage,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
}: StorageStructureManagerProps) {
  const { t } = useTranslation("storage");
  const labels = {
    createTitle: t("manageStorage.createTitle"),
    editTitle: t("manageStorage.editTitle"),
    storageList: t("manageStorage.storageList"),
    name: t("field.storageName"),
    description: t("field.storageDescription"),
    emptyDescription: t("empty.noDescription"),
    create: t("action.createStorage"),
    save: t("action.saveStorage"),
    delete: t("action.deleteStorage"),
    cancel: t("common:action.cancel"),
    noStorages: t("empty.noStorage"),
    categoryName: t("field.categoryName"),
    createCategoryTitle: t("manageStorage.createCategoryTitle"),
    editCategoryTitle: t("manageStorage.editCategoryTitle"),
    createCategory: t("action.createCategory"),
    saveCategory: t("action.saveCategory"),
    deleteCategory: t("action.deleteCategory"),
    noCategories: t("empty.noCategories"),
    selectStructure: t("manageStorage.selectStructure"),
    changeSelection: t("manageStorage.changeSelection"),
    mobileHint: t("manageStorage.mobileHint"),
  };
  const isMobile = useMediaQuery("(max-width: 53.74em)");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategoryName, setEditCategoryName] = useState("");
  const [creationDraft, setCreationDraft] = useState<CreationDraft | null>(null);
  const [treeOpened, setTreeOpened] = useState(false);

  const selectedCategory = selectedStorage?.categories.find((category) => category.id === selectedCategoryId) ?? null;
  const draftCategoryStorage = creationDraft?.type === "category"
    ? storages.find((storage) => storage.id === creationDraft.storageId) ?? null
    : null;
  const isCreatingStorage = creationDraft?.type === "storage";
  const isCreatingCategory = creationDraft?.type === "category";
  const selectedNodeType = isCreatingStorage
    ? "new-storage"
    : isCreatingCategory
      ? "new-category"
      : selectedCategory
        ? "category"
        : selectedStorage
          ? "storage"
          : null;
  const selectedContextName = isCreatingStorage
    ? labels.name
    : isCreatingCategory
      ? draftCategoryStorage?.name ?? labels.noStorages
      : selectedCategory?.name ?? selectedStorage?.name ?? labels.noStorages;
  const selectedContextDetail = isCreatingCategory
    ? labels.noCategories
    : selectedCategory
    ? selectedStorage?.name
    : selectedStorage?.description || labels.emptyDescription;

  useEffect(() => {
    setEditName(selectedStorage?.name ?? "");
    setEditDescription(selectedStorage?.description ?? "");
  }, [selectedStorage]);

  useEffect(() => {
    setEditCategoryName(selectedCategory?.name ?? "");
  }, [selectedCategory]);

  const handleBeginCreateStorage = () => {
    setCreationDraft({ type: "storage" });
    setEditName("");
    setEditDescription("");
    setTreeOpened(false);
  };

  const handleBeginCreateCategory = (storageId: string) => {
    setCreationDraft({ type: "category", storageId });
    setEditCategoryName("");
    onSelectStorage(storageId);
    setTreeOpened(false);
  };

  const handleSaveStorage = () => {
    const name = editName.trim();
    if (!name) return;
    const payload = { name, description: editDescription.trim() || null };
    if (isCreatingStorage) {
      onCreateStorage(payload, () => setCreationDraft(null));
      return;
    }
    if (!selectedStorage) return;
    onUpdateStorage(selectedStorage.id, payload);
  };

  const handleSaveCategory = () => {
    const name = editCategoryName.trim();
    if (!name) return;
    if (creationDraft?.type === "category") {
      onCreateCategory(creationDraft.storageId, { name }, () => setCreationDraft(null));
      return;
    }
    if (!selectedStorage || !selectedCategory) return;
    onUpdateCategory(selectedStorage.id, selectedCategory.id, { name });
  };

  const handleSelectStorage = (storageId: string) => {
    setCreationDraft(null);
    onSelectStorage(storageId);
    setTreeOpened(false);
  };

  const handleSelectCategory = (storageId: string, categoryId: string) => {
    setCreationDraft(null);
    onSelectCategory(storageId, categoryId);
    setTreeOpened(false);
  };

  const handleCancel = () => {
    setCreationDraft(null);
    setEditName(selectedStorage?.name ?? "");
    setEditDescription(selectedStorage?.description ?? "");
    setEditCategoryName(selectedCategory?.name ?? "");
  };

  const treePanel = (
    <Stack gap="xs" className="storage-management-modal__tree">
      <Group justify="space-between" gap="xs" wrap="nowrap" className="storage-management-modal__tree-header">
        <Text fw={700}>{labels.storageList}</Text>
        <Button size="compact-xs" variant="light" leftSection={<PlusIcon size={13} />} loading={isSaving} onClick={handleBeginCreateStorage}>
          {labels.create}
        </Button>
      </Group>

      {storages.length === 0 ? <Text size="sm" c="dimmed">{labels.noStorages}</Text> : null}

      {storages.map((storage) => (
        <div key={storage.id} className="storage-management-modal__tree-group">
          <div className={`storage-management-modal__tree-row storage-management-modal__tree-row--storage ${selectedNodeType === "storage" && selectedStorage?.id === storage.id ? "storage-management-modal__tree-row--active" : ""}`}>
            <button type="button" className="storage-management-modal__tree-node" onClick={() => handleSelectStorage(storage.id)}>
              <span>
                <Text fw={800} lineClamp={1}>{storage.name}</Text>
                <Text size="xs" c="dimmed" lineClamp={1}>{storage.description || labels.emptyDescription}</Text>
              </span>
              <Badge size="xs" variant="light">{storage.categories.length}</Badge>
            </button>
            <Group gap={2} wrap="nowrap" className="storage-management-modal__node-actions">
              <ActionIcon size="sm" variant="subtle" aria-label={labels.createCategory} loading={isSaving} onClick={() => handleBeginCreateCategory(storage.id)}>
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
                <button type="button" className="storage-management-modal__tree-node" onClick={() => handleSelectCategory(storage.id, category.id)}>
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
  );

  return (
    <div className="storage-management-modal">
        {isMobile ? (
          <>
            <Stack gap="sm" className="storage-management-mobile-flow">
              <Text size="sm" c="dimmed">{labels.mobileHint}</Text>
              <div className="storage-management-mobile-flow__selection">
                <span>
                  <Text size="xs" c="dimmed">{labels.selectStructure}</Text>
                  <Text fw={700} lineClamp={1}>{selectedContextName}</Text>
                </span>
                <Button variant="default" onClick={() => setTreeOpened(true)}>
                  {labels.changeSelection}
                </Button>
              </div>
            </Stack>
            <Drawer
              opened={treeOpened}
              onClose={() => setTreeOpened(false)}
              title={labels.selectStructure}
              position="left"
              size={340}
            >
              {treePanel}
            </Drawer>
          </>
        ) : treePanel}

        <div className="storage-management-modal__workspace">
          {selectedNodeType === "category" || selectedNodeType === "new-category" ? (
            <Stack gap="sm" className="storage-modal-panel storage-management-modal__edit-panel">
              <div className="storage-management-modal__context">
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <span>
                    <Text size="xs" c="dimmed">{isCreatingCategory ? labels.createCategoryTitle : labels.editCategoryTitle}</Text>
                    <Text fw={900} lineClamp={1}>{selectedContextName}</Text>
                  </span>
                  <Badge variant="light">{labels.categoryName}</Badge>
                </Group>
                <Text size="xs" c="dimmed" lineClamp={2}>{selectedContextDetail}</Text>
              </div>
              <TextInput label={labels.categoryName} value={editCategoryName} onChange={(event) => setEditCategoryName(event.currentTarget.value)} disabled={!isCreatingCategory && !selectedCategory} />
              <Group justify="flex-end" className="storage-modal-actions">
                <Group>
                  <Button variant="default" onClick={handleCancel}>{labels.cancel}</Button>
                  <Button
                    onClick={handleSaveCategory}
                    disabled={
                      !editCategoryName.trim()
                      || (!isCreatingCategory && (
                        !selectedStorage
                        || !selectedCategory
                        || editCategoryName.trim() === selectedCategory.name
                      ))
                    }
                    loading={isSaving}
                  >
                    {isCreatingCategory ? labels.createCategory : labels.saveCategory}
                  </Button>
                </Group>
              </Group>
            </Stack>
          ) : (
            <Stack gap="sm" className="storage-modal-panel storage-management-modal__edit-panel">
              <div className="storage-management-modal__context">
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <span>
                    <Text size="xs" c="dimmed">{isCreatingStorage ? labels.createTitle : labels.editTitle}</Text>
                    <Text fw={900} lineClamp={1}>{selectedContextName}</Text>
                  </span>
                  <Badge variant="light">{isCreatingStorage ? 0 : selectedStorage?.categories.length ?? 0}</Badge>
                </Group>
                <Text size="xs" c="dimmed" lineClamp={2}>{selectedContextDetail}</Text>
              </div>
              <TextInput label={labels.name} value={editName} onChange={(event) => setEditName(event.currentTarget.value)} disabled={!isCreatingStorage && !selectedStorage} />
              <Textarea label={labels.description} minRows={3} value={editDescription} onChange={(event) => setEditDescription(event.currentTarget.value)} disabled={!isCreatingStorage && !selectedStorage} />
              <Group justify="flex-end" className="storage-modal-actions">
                <Group>
                  <Button variant="default" onClick={handleCancel}>{labels.cancel}</Button>
                  <Button onClick={handleSaveStorage} disabled={!editName.trim() || (!isCreatingStorage && !selectedStorage)} loading={isSaving}>
                    {isCreatingStorage ? labels.create : labels.save}
                  </Button>
                </Group>
              </Group>
            </Stack>
          )}
        </div>
    </div>
  );
}
