import type {
  CreateStorageCategoryPayload,
  CreateStoragePayload,
  Storage,
  StorageCategoryMutationResponse,
  UpdateStorageCategoryPayload,
  UpdateStoragePayload,
} from "@guild/shared";

export type CreationDraft =
  | { type: "storage" }
  | { type: "category"; storageId: string; structureRevision: number };

export type StorageStructureManagerProps = {
  storages: Storage[];
  selectedStorage: Storage | null;
  selectedCategoryId: string | null;
  onSelectStorage: (id: string) => void;
  onSelectCategory: (storageId: string, categoryId: string) => void;
  onCreateStorage: (payload: CreateStoragePayload) => Promise<Storage | null>;
  onUpdateStorage: (id: string, payload: UpdateStoragePayload) => Promise<Storage | null>;
  onDeleteStorage: (id: string, expectedStructureRevision: number) => Promise<boolean>;
  onCreateCategory: (
    storageId: string,
    payload: CreateStorageCategoryPayload,
  ) => Promise<StorageCategoryMutationResponse | null>;
  onUpdateCategory: (
    storageId: string,
    categoryId: string,
    payload: UpdateStorageCategoryPayload,
  ) => Promise<StorageCategoryMutationResponse | null>;
  onDeleteCategory: (
    storageId: string,
    categoryId: string,
    expectedStructureRevision: number,
  ) => Promise<boolean>;
};

export type StructureAction = "create" | "update" | "delete";
export type StructureResource = "storage" | "category";

export type StorageBaseline = Readonly<{
  id: string;
  name: string;
  description: string | null;
  structureRevision: number;
}>;

export type CategoryBaseline = Readonly<{
  id: string;
  name: string;
  structureRevision: number;
}>;
