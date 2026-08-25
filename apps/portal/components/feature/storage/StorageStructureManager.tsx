import type { CreateStorageCategoryPayload, CreateStoragePayload, Storage } from "@guild/shared";
import { PlusIcon, TrashIcon, XIcon } from "@portal/components/icons";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@portal/components/ui/drawer";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { Textarea } from "@portal/components/ui/textarea";
import { useKeyedPending } from "@portal/hooks/useKeyedPending";
import { useMediaQuery } from "@portal/hooks/useMediaQuery";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type CreationDraft =
  | { type: "storage" }
  | { type: "category"; storageId: string };

type StorageStructureManagerProps = {
  storages: Storage[];
  selectedStorage: Storage | null;
  selectedCategoryId: string | null;
  onSelectStorage: (id: string) => void;
  onSelectCategory: (storageId: string, categoryId: string) => void;
  onCreateStorage: (payload: CreateStoragePayload) => Promise<boolean>;
  onUpdateStorage: (id: string, payload: Partial<CreateStoragePayload>) => Promise<boolean>;
  onDeleteStorage: (id: string) => Promise<boolean>;
  onCreateCategory: (storageId: string, payload: CreateStorageCategoryPayload) => Promise<boolean>;
  onUpdateCategory: (storageId: string, categoryId: string, payload: CreateStorageCategoryPayload) => Promise<boolean>;
  onDeleteCategory: (storageId: string, categoryId: string) => Promise<boolean>;
};

type StructureAction = "create" | "update" | "delete";
type StructureResource = "storage" | "category";

const pendingKey = (action: StructureAction, resource: StructureResource, id: string) =>
  `${action}:${resource}:${id}`;

export function StorageStructureManager({
  storages,
  selectedStorage,
  selectedCategoryId,
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
  const { pendingKeys, runPending } = useKeyedPending();

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
      void runPending(pendingKey("create", "storage", "new"), async () => {
        if (await onCreateStorage(payload)) setCreationDraft(null);
      });
      return;
    }
    if (!selectedStorage) return;
    void runPending(
      pendingKey("update", "storage", selectedStorage.id),
      () => onUpdateStorage(selectedStorage.id, payload),
    );
  };

  const handleSaveCategory = () => {
    const name = editCategoryName.trim();
    if (!name) return;
    if (creationDraft?.type === "category") {
      void runPending(pendingKey("create", "category", creationDraft.storageId), async () => {
        if (await onCreateCategory(creationDraft.storageId, { name })) setCreationDraft(null);
      });
      return;
    }
    if (!selectedStorage || !selectedCategory) return;
    void runPending(
      pendingKey("update", "category", `${selectedStorage.id}/${selectedCategory.id}`),
      () => onUpdateCategory(selectedStorage.id, selectedCategory.id, { name }),
    );
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
    <nav className="storage-management-modal__tree" aria-label={labels.storageList}>
      <div className="storage-management-modal__tree-header">
        <strong>{labels.storageList}</strong>
        <Button size="xs" variant="secondary" onClick={handleBeginCreateStorage}>
          <PlusIcon size={13} />
          {labels.create}
        </Button>
      </div>

      {storages.length === 0 ? <p className="storage-muted-copy">{labels.noStorages}</p> : null}

      {storages.map((storage) => (
        <div key={storage.id} className="storage-management-modal__tree-group">
          <div className={`storage-management-modal__tree-row storage-management-modal__tree-row--storage ${selectedNodeType === "storage" && selectedStorage?.id === storage.id ? "storage-management-modal__tree-row--active" : ""}`}>
            <button type="button" className="storage-management-modal__tree-node" onClick={() => handleSelectStorage(storage.id)}>
              <span>
                <strong>{storage.name}</strong>
                <span>{storage.description || labels.emptyDescription}</span>
              </span>
              <Badge variant="secondary">{storage.categories.length}</Badge>
            </button>
            <div className="storage-management-modal__node-actions">
              <Button size="icon-sm" variant="ghost" aria-label={labels.createCategory} onClick={() => handleBeginCreateCategory(storage.id)}>
                <PlusIcon size={13} />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="storage-button--danger"
                aria-label={labels.delete}
                loading={pendingKeys.has(pendingKey("delete", "storage", storage.id))}
                onClick={() => {
                  void runPending(
                    pendingKey("delete", "storage", storage.id),
                    () => onDeleteStorage(storage.id),
                  );
                }}
              >
                <TrashIcon size={13} />
              </Button>
            </div>
          </div>

          <div className="storage-management-modal__tree-children">
            {storage.categories.length === 0 ? <p className="storage-management-modal__tree-empty">{labels.noCategories}</p> : null}
            {storage.categories.map((category) => (
              <div
                key={category.id}
                className={`storage-management-modal__tree-row storage-management-modal__tree-row--category ${selectedNodeType === "category" && selectedCategory?.id === category.id ? "storage-management-modal__tree-row--active" : ""}`}
              >
                <button type="button" className="storage-management-modal__tree-node" onClick={() => handleSelectCategory(storage.id, category.id)}>
                  <strong>{category.name}</strong>
                </button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="storage-button--danger"
                  aria-label={labels.deleteCategory}
                  loading={pendingKeys.has(pendingKey("delete", "category", `${storage.id}/${category.id}`))}
                  onClick={() => {
                    void runPending(
                      pendingKey("delete", "category", `${storage.id}/${category.id}`),
                      () => onDeleteCategory(storage.id, category.id),
                    );
                  }}
                >
                  <TrashIcon size={13} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );

  const isCategoryEditor = selectedNodeType === "category" || selectedNodeType === "new-category";

  return (
    <div className="storage-management-modal">
      {isMobile ? (
        <>
          <section className="storage-management-mobile-flow">
            <p>{labels.mobileHint}</p>
            <div className="storage-management-mobile-flow__selection">
              <span>
                <span className="storage-meta-label">{labels.selectStructure}</span>
                <strong>{selectedContextName}</strong>
              </span>
              <Button variant="outline" onClick={() => setTreeOpened(true)}>{labels.changeSelection}</Button>
            </div>
          </section>
          <Drawer open={treeOpened} onOpenChange={setTreeOpened} swipeDirection="left" showSwipeHandle>
            <DrawerContent className="storage-management-modal__mobile-drawer">
              <DrawerHeader className="storage-modal-header">
                <div className="storage-overlay-heading">
                  <DrawerTitle>{labels.selectStructure}</DrawerTitle>
                  <DrawerClose aria-label={t("common:action.close")} render={<Button size="icon-sm" variant="ghost" />}>
                    <XIcon size={16} />
                  </DrawerClose>
                </div>
              </DrawerHeader>
              <div className="storage-modal-body">{treePanel}</div>
            </DrawerContent>
          </Drawer>
        </>
      ) : treePanel}

      <div className="storage-management-modal__workspace">
        {isCategoryEditor ? (
          <section className="storage-modal-panel storage-management-modal__edit-panel">
            <div className="storage-management-modal__context">
              <div className="storage-management-modal__context-heading">
                <span>
                  <span className="storage-meta-label">{isCreatingCategory ? labels.createCategoryTitle : labels.editCategoryTitle}</span>
                  <strong>{selectedContextName}</strong>
                </span>
                <Badge variant="secondary">{labels.categoryName}</Badge>
              </div>
              <p>{selectedContextDetail}</p>
            </div>
            <div className="storage-field">
              <Label htmlFor="storage-category-name">{labels.categoryName}</Label>
              <Input
                id="storage-category-name"
                value={editCategoryName}
                onChange={(event) => setEditCategoryName(event.currentTarget.value)}
                disabled={!isCreatingCategory && !selectedCategory}
              />
            </div>
            <div className="storage-modal-actions">
              <span />
              <div>
                <Button variant="outline" onClick={handleCancel}>{labels.cancel}</Button>
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
                  loading={pendingKeys.has(pendingKey(
                    isCreatingCategory ? "create" : "update",
                    "category",
                    isCreatingCategory
                      ? creationDraft.storageId
                      : `${selectedStorage?.id}/${selectedCategory?.id}`,
                  ))}
                >
                  {isCreatingCategory ? labels.createCategory : labels.saveCategory}
                </Button>
              </div>
            </div>
          </section>
        ) : (
          <section className="storage-modal-panel storage-management-modal__edit-panel">
            <div className="storage-management-modal__context">
              <div className="storage-management-modal__context-heading">
                <span>
                  <span className="storage-meta-label">{isCreatingStorage ? labels.createTitle : labels.editTitle}</span>
                  <strong>{selectedContextName}</strong>
                </span>
                <Badge variant="secondary">{isCreatingStorage ? 0 : selectedStorage?.categories.length ?? 0}</Badge>
              </div>
              <p>{selectedContextDetail}</p>
            </div>
            <div className="storage-field">
              <Label htmlFor="storage-name">{labels.name}</Label>
              <Input
                id="storage-name"
                value={editName}
                onChange={(event) => setEditName(event.currentTarget.value)}
                disabled={!isCreatingStorage && !selectedStorage}
              />
            </div>
            <div className="storage-field">
              <Label htmlFor="storage-description">{labels.description}</Label>
              <Textarea
                id="storage-description"
                rows={3}
                value={editDescription}
                onChange={(event) => setEditDescription(event.currentTarget.value)}
                disabled={!isCreatingStorage && !selectedStorage}
              />
            </div>
            <div className="storage-modal-actions">
              <span />
              <div>
                <Button variant="outline" onClick={handleCancel}>{labels.cancel}</Button>
                <Button
                  onClick={handleSaveStorage}
                  disabled={!editName.trim() || (!isCreatingStorage && !selectedStorage)}
                  loading={pendingKeys.has(pendingKey(
                    isCreatingStorage ? "create" : "update",
                    "storage",
                    isCreatingStorage ? "new" : selectedStorage?.id ?? "",
                  ))}
                >
                  {isCreatingStorage ? labels.create : labels.save}
                </Button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
