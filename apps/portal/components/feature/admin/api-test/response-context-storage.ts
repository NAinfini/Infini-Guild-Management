import {
  type EndpointDef,
  type TestRunContext,
  firstArrayItem,
  isRecord,
  readString,
} from "./types";

function readNullableString(
  record: Record<string, unknown> | null,
  key: string,
  fallback: string | null,
): string | null {
  if (!record || !(key in record)) return fallback;
  return record[key] === null ? null : readString(record[key]) ?? fallback;
}

export function captureStorageResponseContext(
  next: TestRunContext,
  endpoint: EndpointDef,
  payload: Record<string, unknown>,
): TestRunContext | null {
  if (endpoint.path === "/api/storage") {
    if (Array.isArray(payload.data)) {
      const first = firstArrayItem(payload.data);
      next.storageId = readString(first?.id) ?? next.storageId;
      next.storageName = readString(first?.name) ?? next.storageName;
      next.storageDescription = readNullableString(first, "description", next.storageDescription);
      next.storageStructureRevision = typeof first?.structure_revision === "number"
        ? first.structure_revision
        : next.storageStructureRevision;
      const categories = Array.isArray(first?.categories) ? first.categories : [];
      const firstCategory = categories.find((item): item is Record<string, unknown> => isRecord(item));
      next.storageCategoryId = readString(firstCategory?.id) ?? next.storageCategoryId;
      next.storageCategoryName = readString(firstCategory?.name) ?? next.storageCategoryName;
    }
    return next;
  }

  const fixturelessPath = endpoint.path.replace(/\?fixture=[^&]+$/, "");

  if (fixturelessPath === "/api/storage/storages") {
    const id = readString(payload.id);
    next.storageId = id ?? next.storageId;
    next.storageName = readString(payload.name) ?? next.storageName;
    next.storageDescription = readNullableString(payload, "description", next.storageDescription);
    next.storageStructureRevision = typeof payload.structure_revision === "number"
      ? payload.structure_revision
      : next.storageStructureRevision;
    if (endpoint.method === "POST") {
      next.createdStorageId = id ?? next.createdStorageId;
    }
    return next;
  }

  if (fixturelessPath === "/api/storage/storages/:id") {
    next.storageName = readString(payload.name) ?? next.storageName;
    next.storageDescription = readNullableString(payload, "description", next.storageDescription);
    next.storageStructureRevision = typeof payload.structure_revision === "number"
      ? payload.structure_revision
      : next.storageStructureRevision;
    return next;
  }

  if (fixturelessPath === "/api/storage/storages/:storageId/categories") {
    const category = isRecord(payload.category) ? payload.category : null;
    const id = readString(category?.id);
    next.storageCategoryId = id ?? next.storageCategoryId;
    next.storageCategoryName = readString(category?.name) ?? next.storageCategoryName;
    next.storageStructureRevision = typeof payload.structure_revision === "number"
      ? payload.structure_revision
      : next.storageStructureRevision;
    if (endpoint.method === "POST") {
      next.createdStorageCategoryId = id ?? next.createdStorageCategoryId;
    }
    return next;
  }

  if (fixturelessPath === "/api/storage/storages/:storageId/categories/:id") {
    const category = isRecord(payload.category) ? payload.category : null;
    next.storageCategoryId = readString(category?.id) ?? next.storageCategoryId;
    next.storageCategoryName = readString(category?.name) ?? next.storageCategoryName;
    next.storageStructureRevision = typeof payload.structure_revision === "number"
      ? payload.structure_revision
      : next.storageStructureRevision;
    return next;
  }

  if (fixturelessPath === "/api/storage/items") {
    if (Array.isArray(payload.data)) {
      const first = firstArrayItem(payload.data);
      next.storageItemId = readString(first?.id) ?? next.storageItemId;
      next.storageItemUpdatedAt = readString(first?.updated_at) ?? next.storageItemUpdatedAt;
    } else {
      const id = readString(payload.id);
      next.storageItemId = id ?? next.storageItemId;
      next.storageItemUpdatedAt = readString(payload.updated_at) ?? next.storageItemUpdatedAt;
      if (endpoint.method === "POST") {
        next.createdStorageItemId = id ?? next.createdStorageItemId;
      }
    }
    return next;
  }

  if (endpoint.path === "/api/storage/items/:id") {
    next.storageItemId = readString(payload.id) ?? next.storageItemId;
    next.storageItemUpdatedAt = readString(payload.updated_at) ?? next.storageItemUpdatedAt;
    return next;
  }

  if (endpoint.path === "/api/storage/items/:id/images" && endpoint.method === "POST") {
    const images = Array.isArray(payload.data) ? payload.data : [];
    const firstImage = images.length > 0
      ? images.find((item): item is Record<string, unknown> => isRecord(item))
      : null;
    next.storageImageMediaId = readString(firstImage?.media_id) ?? next.storageImageMediaId;
    next.storageItemUpdatedAt = readString(payload.updated_at) ?? next.storageItemUpdatedAt;
    return next;
  }

  return null;
}
