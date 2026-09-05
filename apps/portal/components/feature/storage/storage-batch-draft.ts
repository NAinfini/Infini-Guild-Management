import type { StorageItem } from "@guild/shared";

export type StorageBatchDirection = "intake" | "distribute";

export type StorageBatchDraft = {
  idempotencyKey: string;
  type: StorageBatchDirection;
  quantities: Record<string, number>;
  itemSnapshots: Record<string, StorageItem>;
  recipientUserId: string | null;
  note: string;
};

export function createBatchDraft(recipientUserId: string | null): StorageBatchDraft {
  return {
    idempotencyKey: crypto.randomUUID(),
    type: "intake",
    quantities: {},
    itemSnapshots: {},
    recipientUserId,
    note: "",
  };
}

export function refreshBatchKey(
  draft: StorageBatchDraft,
  patch: Partial<Omit<StorageBatchDraft, "idempotencyKey">>,
): StorageBatchDraft {
  return { ...draft, ...patch, idempotencyKey: crypto.randomUUID() };
}
