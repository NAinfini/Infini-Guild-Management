import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { describe, expect, it, vi } from "vitest";
import { StorageService, type StorageItemRecord, type StorageMediaPort, type StorageStore } from "./storage-service";

const current: StorageItemRecord = {
  id: "item-1", storage_id: "storage-1", category_id: null,
  name: "Supplies", description: null, rarity: "common", unit: null, quantity: 3,
  allow_member_deposit: false, allow_member_withdraw: false,
  created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z",
};
const context = createRequestContext({
  requestId: "storage-save-request",
  now: "2026-08-30T00:00:00.000Z",
  authorization: createAuthorizationContext({
    userId: "user-1", sessionId: "session-1", roleId: "admin", roleLevel: 100,
    permissions: [PERMISSION_ID.ADMIN_STORAGE_ITEMS],
  }),
});

function fixture() {
  let committed = false;
  const saved = { ...current, name: "Updated supplies", updated_at: context.now };
  const getItem = vi.fn().mockResolvedValue(current);
  const updateItem = vi.fn(async () => {
    committed = true;
    return { status: "updated" as const, value: saved };
  });
  const listItemMediaIds = vi.fn(async () => {
    if (committed) throw new Error("post-commit media read failed");
    return new Map([[current.id, ["media-1"]]]);
  });
  const service = new StorageService(
    { getItem, updateItem } as unknown as StorageStore,
    { listItemMediaIds } as unknown as StorageMediaPort,
    { publish: vi.fn() },
    { defer: vi.fn() },
  );
  return { service, saved, getItem, updateItem, listItemMediaIds };
}

describe("StorageService save snapshots", () => {
  it("returns the committed revision and CAS-protected media without a post-commit read", async () => {
    const { service, saved, getItem, updateItem, listItemMediaIds } = fixture();
    await expect(service.updateItem(context, current.id, {
      name: saved.name, expected_updated_at: current.updated_at,
    })).resolves.toEqual({ ...saved, images: [{ media_id: "media-1" }] });
    expect(getItem).toHaveBeenCalledOnce();
    expect(listItemMediaIds).toHaveBeenCalledOnce();
    expect(updateItem).toHaveBeenCalledWith(expect.objectContaining({
      expectedUpdatedAt: current.updated_at, updatedAt: context.now,
    }));
  });

  it("does not commit if reading the media snapshot fails", async () => {
    const { service, saved, updateItem, listItemMediaIds } = fixture();
    listItemMediaIds.mockRejectedValueOnce(new Error("media unavailable"));
    await expect(service.updateItem(context, current.id, {
      name: saved.name, expected_updated_at: current.updated_at,
    })).rejects.toThrow("media unavailable");
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("rejects a stale editor before reading media or committing", async () => {
    const { service, saved, updateItem, listItemMediaIds } = fixture();
    await expect(service.updateItem(context, current.id, {
      name: saved.name, expected_updated_at: "2026-07-31T00:00:00.000Z",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(listItemMediaIds).not.toHaveBeenCalled();
    expect(updateItem).not.toHaveBeenCalled();
  });
});
