import type { BlobInventory, BlobMetadata, BlobStore } from "@guild/kernel";
import { describe, expect, it, vi } from "vitest";
import {
  BlobReconciliationService,
  type BlobManifestDescriptor,
  type BlobManifestStore,
} from "./blob-reconciliation.js";

const NOW = "2026-08-09T12:00:00.000Z";
const SHA = "a".repeat(64);

describe("BlobReconciliationService", () => {
  it("checks every D1 manifest with bounded blob HEADs and returns a stable checkpoint", async () => {
    const descriptors = [
      descriptor("media/a/view.webp"),
      descriptor("media/b/view.webp"),
      descriptor("media/c/view.webp"),
    ];
    const store: BlobManifestStore = {
      listPage: vi.fn().mockResolvedValue({ descriptors, nextCheckpoint: descriptors[2]!.objectKey }),
      findByObjectKeys: vi.fn(),
    };
    const head = vi.fn(async (key: string) => key === "media/a/view.webp"
      ? metadata(key)
      : key === "media/b/view.webp"
        ? null
        : metadata(key, { size: 99 }));
    const service = new BlobReconciliationService(
      store,
      { head } as Pick<BlobStore, "head">,
      { listPrefix: vi.fn() } as BlobInventory,
    );

    const page = await service.scanPage({ now: NOW, limit: 3 });

    expect(head).toHaveBeenCalledTimes(3);
    expect(page.findings.map(({ kind }) => kind)).toEqual(["missing_blob", "metadata_mismatch"]);
    expect(page.nextCheckpoint).toEqual({ phase: "manifest", checkpoint: "media/c/view.webp" });
  });

  it("reports only aged orphan candidates while reconciling inventory back to D1", async () => {
    const known = descriptor("media/known/view.webp");
    const objects = [
      metadata(known.objectKey, { size: 99 }),
      metadata("media/orphan/view.webp", { lastModified: "2026-08-07T00:00:00.000Z" }),
      metadata("media/recent/view.webp", { lastModified: "2026-08-09T11:00:00.000Z" }),
    ];
    const findByObjectKeys = vi.fn().mockResolvedValue([known]);
    const listPrefix = vi.fn().mockResolvedValue({ objects, nextCheckpoint: null });
    const service = new BlobReconciliationService(
      { listPage: vi.fn(), findByObjectKeys },
      { head: vi.fn() },
      { listPrefix },
    );

    const page = await service.scanPage({
      now: NOW,
      checkpoint: { phase: "inventory", prefix: "media/" },
    });

    expect(findByObjectKeys).toHaveBeenCalledWith(objects.map(({ key }) => key));
    expect(page.findings.map(({ kind }) => kind)).toEqual(["metadata_mismatch", "orphan_candidate"]);
    expect(page.nextCheckpoint).toEqual({ phase: "inventory", prefix: "audit/" });
  });

  it("finishes after the audit inventory page without exposing deletion", async () => {
    const service = new BlobReconciliationService(
      { listPage: vi.fn(), findByObjectKeys: vi.fn().mockResolvedValue([]) },
      { head: vi.fn() },
      { listPrefix: vi.fn().mockResolvedValue({ objects: [], nextCheckpoint: null }) },
    );

    await expect(service.scanPage({
      now: NOW,
      checkpoint: { phase: "inventory", prefix: "audit/" },
    })).resolves.toEqual({ scanned: 0, findings: [], nextCheckpoint: null });
  });
});

function descriptor(objectKey: string): BlobManifestDescriptor {
  return {
    source: "media",
    sourceId: objectKey,
    objectKey,
    byteSize: 10,
    contentType: "image/webp",
    sha256: SHA,
  };
}

function metadata(
  key: string,
  overrides: Partial<BlobMetadata> = {},
): BlobMetadata {
  return {
    key,
    size: 10,
    contentType: "image/webp",
    sha256: SHA,
    etag: "etag",
    lastModified: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}
